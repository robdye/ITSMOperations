// ITSM Operations — Agent 365 MCP Tool Setup (Cassidy-pattern port)
//
// Discovers the live MCP tool catalogue from the Microsoft Agent 365 tooling
// gateway via OBO (delegated user token), then invokes individual tools using
// the StreamableHTTP transport. Mirrors Cassidy's mcpToolSetup.ts:
//   https://github.com/ITSpecialist111/Cassidy-Enterprise-Operations-Manager
//
// Key auth details (matching ITSMOps blueprint registration):
//   - Agent blueprint:     871592dc-ffa9-42d0-aa31-46a679817d26
//   - Tooling audience:    api://05879165-0320-489e-b644-f72b33f3edf0
//   - OBO scope:           api://05879165-0320-489e-b644-f72b33f3edf0/.default
//   - Connection name:     AgenticAuthConnection (env: agentic_connectionName)
//
// Autonomous (non-TurnContext) paths return [] gracefully — agentic apps cannot
// use client_credentials grant against the platform (AADSTS82001), so the
// caller must fall back to direct Graph for those scenarios.

import { TurnContext } from '@microsoft/agents-hosting';
import {
  McpToolServerConfigurationService,
  Utility as ToolingUtility,
} from '@microsoft/agents-a365-tooling';
import type {
  MCPServerConfig,
  McpClientTool,
  ToolOptions,
} from '@microsoft/agents-a365-tooling';
import { AgenticAuthenticationService } from '@microsoft/agents-a365-runtime';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** OBO scope for the ITSMOps Agent 365 MCP tooling gateway. */
const MCP_PLATFORM_SCOPE = 'api://05879165-0320-489e-b644-f72b33f3edf0/.default';

/** Per-tool invocation timeout. */
const MCP_TOOL_TIMEOUT_MS = Number(process.env.MCP_TOOL_TIMEOUT_MS || 30_000);

/** Discovery cache TTL. */
const SERVER_CONFIG_TTL_MS = 5 * 60 * 1000;

/**
 * Servers we expect to consume — the gateway may return canary/preview entries
 * we want to skip. Keep aligned with `digital-worker/ToolingManifest.json`.
 */
const CONFIGURED_SERVERS = new Set<string>([
  'mcp_MailTools',
  'mcp_TeamsServer',
  'mcp_CalendarTools',
  'mcp_PlannerTools',
  'mcp_KnowledgeTools',
  'mcp_SharePointRemoteServer',
  'mcp_SharePointListsTools',
  'mcp_OneDriveRemoteServer',
  'mcp_ODSPRemoteServer',
  'mcp_WordServer',
  'mcp_ExcelServer',
  // mcp_PowerPointServer is declared but disabled in the manifest.
]);

// ---------------------------------------------------------------------------
// Singletons + caches
// ---------------------------------------------------------------------------

const mcpService = new McpToolServerConfigurationService();

let _serverConfigCache: MCPServerConfig[] | null = null;
let _serverConfigExpiry = 0;

interface CachedServerConfig {
  config: MCPServerConfig;
  /** Tool names this server exposed at last discovery. */
  toolNames: string[];
}

/** name → server config (used by invokeMcpTool to route by tool name). */
const _toolServerMap: Map<string, CachedServerConfig> = new Map();

/** Discovered tool definitions (raw MCP shape, for OpenAI tool conversion). */
let _toolDefinitionCache: McpToolDefinition[] | null = null;

export interface McpToolDefinition {
  name: string;
  description: string;
  serverName: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAuthHandlerName(): string {
  return process.env.agentic_connectionName ?? 'AgenticAuthConnection';
}

function getToolOptions(): ToolOptions | undefined {
  const orchestratorName =
    process.env.AGENTIC_ORCHESTRATOR_NAME ??
    process.env.WEBSITE_SITE_NAME ??
    process.env.CONTAINER_APP_NAME;
  return orchestratorName ? { orchestratorName } : undefined;
}

/**
 * Inject the tenant id into config headers when the gateway omits it. The MCP
 * servers all require x-ms-tenant-id and the tooling gateway sometimes returns
 * configs without it.
 */
function normalizeServerConfig(
  config: MCPServerConfig,
  context?: TurnContext,
): MCPServerConfig {
  const tenantId =
    context?.activity?.conversation?.tenantId ??
    process.env.connections__service_connection__settings__tenantId ??
    process.env.MicrosoftAppTenantId;

  if (!tenantId) return config;

  const headers: Record<string, string> = { ...(config.headers ?? {}) };
  const tenantHeaderKeys = ['x-ms-tenant-id', 'x-tenant-id', 'tenant-id', 'tenantId'];

  let hasTenantHeader = false;
  for (const key of tenantHeaderKeys) {
    if (Object.prototype.hasOwnProperty.call(headers, key)) {
      hasTenantHeader = true;
      const value = headers[key]?.trim();
      if (!value) headers[key] = tenantId;
    }
  }
  if (!hasTenantHeader) headers['x-ms-tenant-id'] = tenantId;

  return { ...config, headers };
}

/**
 * Lazily resolve the agentApplication's authorization handle so this module
 * does not import agent.ts at load time (avoids circular imports).
 *
 * Uses dynamic `import()` (not `require()`) so that test runners which
 * intercept module loading at the ESM layer (vitest, jest with ESM) can
 * substitute mocks via the standard module-mock path.
 */
async function getAuthorization(): Promise<unknown> {
  const mod = (await import('./agent')) as {
    agentApplication?: { authorization?: unknown };
  };
  return mod.agentApplication?.authorization;
}

/**
 * OBO token exchange + tooling header construction (Cassidy parity).
 */
async function getOboToolHeaders(
  context: TurnContext,
): Promise<Record<string, string>> {
  try {
    const authorization = await getAuthorization();
    if (!authorization) {
      console.warn('[MCP] agentApplication.authorization unavailable — cannot mint OBO');
      return {};
    }

    const token = await AgenticAuthenticationService.GetAgenticUserToken(
      authorization as Parameters<typeof AgenticAuthenticationService.GetAgenticUserToken>[0],
      getAuthHandlerName(),
      context,
      [MCP_PLATFORM_SCOPE],
    );
    if (!token) {
      console.warn('[MCP] OBO token exchange returned empty token');
      return {};
    }
    return ToolingUtility.GetToolRequestHeaders(token, context, getToolOptions());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[MCP] OBO header construction failed: ${msg}`);
    return {};
  }
}

/**
 * Discover tool servers via the Agent 365 tooling gateway using the active
 * user's TurnContext. This is the only path that works for an agentic app —
 * client_credentials is rejected by the platform (AADSTS82001).
 */
async function getServerConfigs(
  context?: TurnContext,
): Promise<MCPServerConfig[]> {
  const now = Date.now();
  if (_serverConfigCache && now < _serverConfigExpiry) return _serverConfigCache;

  if (!context) {
    // Autonomous path — no user session, no MCP. Caller must fall back.
    return [];
  }

  try {
    const authorization = await getAuthorization();
    if (!authorization) {
      console.warn('[MCP] No authorization handle — skipping discovery');
      return [];
    }

    const discovered = await mcpService.listToolServers(
      context,
      authorization as Parameters<typeof mcpService.listToolServers>[1],
      getAuthHandlerName(),
      undefined,
      getToolOptions(),
    );
    _serverConfigCache = discovered;
    _serverConfigExpiry = now + SERVER_CONFIG_TTL_MS;
    console.log(`[MCP] OBO discovered ${discovered.length} server(s) from tooling gateway`);
    return _serverConfigCache;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[MCP] OBO discovery failed: ${msg}`);
    // Do NOT cache failure — next turn should retry freshly.
    _serverConfigCache = null;
    _serverConfigExpiry = 0;
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the live MCP tool catalogue for this turn. Returns raw MCP definitions;
 * callers convert these into @openai/agents `tool()` instances.
 */
export async function getLiveMcpTools(
  context?: TurnContext,
): Promise<McpToolDefinition[]> {
  if (!context) return [];

  // Reuse cache when populated (per-process, 5-minute TTL).
  if (_toolDefinitionCache && _toolDefinitionCache.length > 0) {
    return _toolDefinitionCache;
  }

  const configs = await getServerConfigs(context);
  if (configs.length === 0) return [];

  const oboHeaders = await getOboToolHeaders(context);
  if (Object.keys(oboHeaders).length === 0) {
    console.warn('[MCP] No OBO tool headers — MCP servers may reject requests');
  } else {
    console.log(`[MCP] OBO tool headers: [${Object.keys(oboHeaders).join(', ')}]`);
  }

  const filteredConfigs = configs.filter(c => CONFIGURED_SERVERS.has(c.mcpServerName));
  if (filteredConfigs.length < configs.length) {
    const skipped = configs
      .filter(c => !CONFIGURED_SERVERS.has(c.mcpServerName))
      .map(c => c.mcpServerName);
    console.log(`[MCP] Skipping unconfigured server(s): ${skipped.join(', ')}`);
  }

  const definitions: McpToolDefinition[] = [];
  _toolServerMap.clear();

  for (const config of filteredConfigs) {
    try {
      const mergedHeaders: Record<string, string> = { ...oboHeaders };
      for (const [k, v] of Object.entries(config.headers ?? {})) {
        if (typeof v === 'string' && v.trim()) mergedHeaders[k] = v;
      }
      const enrichedConfig: MCPServerConfig = { ...config, headers: mergedHeaders };
      const normalizedConfig = normalizeServerConfig(enrichedConfig, context);

      console.log(
        `[MCP] Connecting ${normalizedConfig.mcpServerName} headers=[${Object.keys(
          normalizedConfig.headers ?? {},
        ).join(', ')}]`,
      );

      const mcpTools: McpClientTool[] = await mcpService.getMcpClientTools(
        normalizedConfig.mcpServerName,
        normalizedConfig,
      );
      const toolNames: string[] = [];

      for (const t of mcpTools) {
        const def: McpToolDefinition = {
          name: t.name,
          description: t.description ?? `${normalizedConfig.mcpServerName} tool: ${t.name}`,
          serverName: normalizedConfig.mcpServerName,
          inputSchema: {
            type: t.inputSchema?.type ?? 'object',
            properties: t.inputSchema?.properties ?? {},
            required: t.inputSchema?.required ?? [],
          },
        };
        definitions.push(def);
        toolNames.push(t.name);
        _toolServerMap.set(t.name, { config: normalizedConfig, toolNames: [t.name] });
      }
      console.log(`[MCP] Loaded ${mcpTools.length} tool(s) from ${normalizedConfig.mcpServerName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[MCP] Failed to load tools from ${config.mcpServerName}: ${msg}`);
    }
  }

  _toolDefinitionCache = definitions;
  return definitions;
}

/**
 * Whether a given tool name is provided by an MCP server we discovered.
 * Prefer this over swallowing errors at call sites.
 */
export function hasMcpToolServer(toolName: string): boolean {
  return _toolServerMap.has(toolName);
}

/**
 * Read-only snapshot of every tool name discovered in the current cache.
 * Intended for diagnostics and the fuzzy `findMcpTool` helper below.
 */
export function getDiscoveredToolNames(): string[] {
  return Array.from(_toolServerMap.keys());
}

/**
 * Normalise a tool name for fuzzy matching: lowercase, strip the
 * `mcp_*Tools_` / `mcp_*Server_` prefix, drop underscores. So
 *   `mcp_CalendarTools_createEvent`
 *   `Calendar_create_event`
 *   `createEvent`
 * all collapse to `createevent`.
 */
function normaliseToolName(name: string): string {
  return name
    .replace(/^mcp_[A-Za-z]+(Tools|Server)_/i, '')
    .replace(/^mcp_/i, '')
    .replace(/_/g, '')
    .toLowerCase();
}

/**
 * Find the first discovered MCP tool that matches one of the supplied
 * candidate names. Tries exact match first, then falls back to
 * normalised-name matching so the tooling gateway can rename / re-prefix
 * tools without breaking the wrappers.
 */
export function findMcpTool(candidates: string[]): string | null {
  // Pass 1 — exact match (preserves prior behaviour).
  for (const name of candidates) {
    if (_toolServerMap.has(name)) return name;
  }
  if (_toolServerMap.size === 0) return null;

  // Pass 2 — fuzzy match by normalised suffix.
  const wanted = candidates.map(normaliseToolName);
  for (const discovered of _toolServerMap.keys()) {
    const norm = normaliseToolName(discovered);
    if (wanted.includes(norm)) return discovered;
  }

  // Pass 3 — substring match (last resort, for "createMeeting"/"createEvent" drift).
  for (const discovered of _toolServerMap.keys()) {
    const norm = normaliseToolName(discovered);
    if (wanted.some(w => norm.includes(w) || w.includes(norm))) return discovered;
  }
  return null;
}

/**
 * Invoke an MCP tool via StreamableHTTP. Caller must have called
 * getLiveMcpTools(context) first in the same process so the server map is
 * populated.
 */
export async function invokeMcpTool<T = unknown>(
  toolName: string,
  params: Record<string, unknown>,
): Promise<T> {
  const cached = _toolServerMap.get(toolName);
  if (!cached) {
    throw new Error(`[MCP] No server registered for tool "${toolName}" — discovery may not have run`);
  }

  const client = new Client({ name: 'itsm-operations-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(cached.config.url), {
    requestInit: { headers: cached.config.headers ?? {} },
  });

  try {
    await client.connect(transport);
    const result = await Promise.race([
      client.callTool({ name: toolName, arguments: params }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`[MCP] Tool "${toolName}" timeout after ${MCP_TOOL_TIMEOUT_MS / 1000}s`)),
          MCP_TOOL_TIMEOUT_MS,
        ),
      ),
    ]);
    return result as T;
  } finally {
    try {
      await client.close();
    } catch (closeErr) {
      console.debug('[MCP] Client close error (non-blocking):', closeErr);
    }
  }
}

/**
 * Force-invalidate caches. Useful after token refresh failures or when
 * smoke-testing.
 */
export function invalidateMcpCache(): void {
  _serverConfigCache = null;
  _serverConfigExpiry = 0;
  _toolDefinitionCache = null;
  _toolServerMap.clear();
  console.log('[MCP] Cache invalidated');
}

/**
 * Lightweight status report for diagnostics endpoints.
 */
export interface McpStatus {
  available: boolean;
  serverCount: number;
  toolCount: number;
  servers: string[];
}

export async function getMcpStatus(context?: TurnContext): Promise<McpStatus> {
  const tools = await getLiveMcpTools(context);
  const servers = new Set(tools.map(t => t.serverName));
  return {
    available: tools.length > 0,
    serverCount: servers.size,
    toolCount: tools.length,
    servers: Array.from(servers),
  };
}
