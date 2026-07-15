// ITSM Operations — Enrichment MCP Bridge (Phase E)
//
// Hard rule #1 (Phase E): "MCP-only — no direct HTTP clients in
// `digital-worker/src/` for any of the 5 sources." This file is the ONLY
// place inside the worker that talks to the enrichment MCP server. No
// other module imports `cisa.gov`, `nvd.nist.gov`, `msrc.microsoft.com`,
// `azure.status.microsoft`, `graph.microsoft.com/.../serviceAnnouncement`,
// or `date.nager.at`.
//
// Auth:
//   - Outbound `Authorization: Bearer <obo-token>` is forwarded from the
//     caller's TurnContext via the existing OBO scope used for the rest of
//     the platform.
//   - `x-ms-tenant-id` carries the tenant id (gateway contract).
//   - `x-itsm-profile` is always `prod` outside test-only calls.
//   - `x-caller-agent-id` lets the audit trail attribute the call.
//
// Transport: MCP StreamableHTTP. We use the SDK's low-level Client so the
// tool catalogue stays in lock-step with the server.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { TurnContext } from '@microsoft/agents-hosting';

/* ── Config ────────────────────────────────────────────────────────────── */

const ENRICHMENT_ENDPOINT =
  process.env.MCP_ENRICHMENT_ENDPOINT?.replace(/\/+$/, '') || 'http://localhost:3010';
const ENRICHMENT_PATH = '/enrichment/mcp';

/* ── Types — re-exported from the server's public surface for typing. ── */

export interface EnvelopeProvenance {
  source: string;
  fetchedAt: string;
  fixtureUsed: boolean;
  cacheHit: boolean;
  sourceUrl: string;
  ttlMs: number;
  riskLevel: 'read';
}

export interface EnrichmentEnvelope<T> {
  data: T;
  provenance: EnvelopeProvenance;
  safety: {
    ok: boolean;
    contentSafety: 'pass' | 'flagged' | 'unavailable';
    purview: 'pass' | 'redacted' | 'unavailable';
    reasons: string[];
  };
}

export interface KevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse?: string;
}

export interface CveSummary {
  cveId: string;
  published: string;
  lastModified: string;
  status?: string;
  description: string;
  cvss?: { version: string; vector: string; baseScore: number; severity: string };
  references: string[];
}

export interface MsrcAdvisory {
  cveId: string;
  title: string;
  threat: string;
  baseScore?: number;
  vector?: string;
  severity?: 'Critical' | 'Important' | 'Moderate' | 'Low' | 'Unknown';
  yearMonth: string;
  url: string;
}

export interface AzureIncident {
  guid: string;
  title: string;
  pubDate: string;
  link: string;
  description: string;
  regions: string[];
  status: string;
}

export interface PublicHoliday {
  date: string;
  localName: string;
  name: string;
  countryCode: string;
  global?: boolean;
}

/* ── OBO + headers ─────────────────────────────────────────────────────── */

interface OutboundContext {
  /** OBO bearer token. */
  token: string;
  /** Tenant id. */
  tenantId: string;
  /** Tests may inject `demo`; runtime resolution always returns `prod`. */
  profile: 'demo' | 'prod';
  /** Caller worker id (e.g. `incident-manager`). */
  callerAgentId: string;
}

async function resolveOutboundContext(
  callerAgentId: string,
  context?: TurnContext,
): Promise<OutboundContext | null> {
  const tenantId = process.env.AZURE_TENANT_ID || process.env.TEAMS_TENANT_ID || '';
  const profile = 'prod' as const;
  if (!tenantId) {
    return null;
  }

  // OBO resolution: prefer the agent's TurnContext-driven flow used elsewhere.
  // Tests and local development may opt into a synthetic token. Production
  // always requires a real OBO context.
  if (context) {
    try {
      const { AgenticAuthenticationService } = await import('@microsoft/agents-a365-runtime');
      const authMod = (await import('./agent')) as {
        agentApplication?: { authorization?: unknown };
      };
      const authorization = authMod.agentApplication?.authorization;
      if (authorization) {
        const handlerName = process.env.agentic_connectionName ?? 'AgenticAuthConnection';
        const token = await AgenticAuthenticationService.GetAgenticUserToken(
          authorization as Parameters<
            typeof AgenticAuthenticationService.GetAgenticUserToken
          >[0],
          handlerName,
          context,
        );
        if (token) {
          return { token, tenantId, profile, callerAgentId };
        }
      }
    } catch (err) {
      console.warn(
        `[enrichment-bridge] OBO acquisition failed: ${(err as Error).message}`,
      );
    }
  }

  if (process.env.NODE_ENV !== 'production' && process.env.ENRICHMENT_DEV_MODE === '1') {
    return { token: 'dev-mode-token', tenantId, profile, callerAgentId };
  }

  return null;
}

/* ── MCP client plumbing ──────────────────────────────────────────────── */

export interface EnrichmentBridgeOptions {
  endpoint?: string;
  /** Override the OBO context. Tests inject a synthetic one. */
  outbound?: OutboundContext;
  /** Override the transport (used by tests to feed an in-process server). */
  transport?: ConstructorParameters<typeof Client>[0] extends infer _ ? unknown : never;
}

async function callTool<T>(
  toolName: string,
  args: Record<string, unknown>,
  callerAgentId: string,
  context?: TurnContext,
  opts: EnrichmentBridgeOptions = {},
): Promise<EnrichmentEnvelope<T>> {
  const out = opts.outbound ?? (await resolveOutboundContext(callerAgentId, context));
  if (!out) {
    throw new Error(
      `[enrichment-bridge] OBO context unavailable for ${callerAgentId} — refusing to call ${toolName}`,
    );
  }
  const endpoint = (opts.endpoint ?? ENRICHMENT_ENDPOINT).replace(/\/+$/, '');
  const url = new URL(endpoint + ENRICHMENT_PATH);

  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${out.token}`,
        'x-ms-tenant-id': out.tenantId,
        'x-itsm-profile': out.profile,
        'x-caller-agent-id': out.callerAgentId,
      },
    },
  });

  const client = new Client(
    { name: `enrichment-bridge:${callerAgentId}`, version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const res = await client.callTool({ name: toolName, arguments: args });
    if (res.isError) {
      const text = (res.content as Array<{ text?: string }>)[0]?.text ?? 'unknown error';
      throw new Error(`enrichment tool ${toolName} failed: ${text}`);
    }
    const text = (res.content as Array<{ text?: string }>)[0]?.text ?? '';
    return JSON.parse(text) as EnrichmentEnvelope<T>;
  } finally {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}

/* ── Public typed wrappers (intent-led) ─────────────────────────────── */

export async function lookupKev(
  args: { productOrVendor: string },
  callerAgentId: string,
  context?: TurnContext,
  opts?: EnrichmentBridgeOptions,
): Promise<EnrichmentEnvelope<{ matches: KevEntry[]; needle: string }>> {
  return callTool('enrichment.kev.lookup', args, callerAgentId, context, opts);
}

export async function recentKev(
  args: { hours: number },
  callerAgentId: string,
  context?: TurnContext,
  opts?: EnrichmentBridgeOptions,
): Promise<EnrichmentEnvelope<{ since: string; entries: KevEntry[] }>> {
  return callTool('enrichment.kev.recent', args, callerAgentId, context, opts);
}

export async function cveDetail(
  args: { cveId: string },
  callerAgentId: string,
  context?: TurnContext,
  opts?: EnrichmentBridgeOptions,
): Promise<EnrichmentEnvelope<{ cve: CveSummary | null }>> {
  return callTool('enrichment.cve.detail', args, callerAgentId, context, opts);
}

export async function cveByProduct(
  args: { cpeOrProduct: string },
  callerAgentId: string,
  context?: TurnContext,
  opts?: EnrichmentBridgeOptions,
): Promise<EnrichmentEnvelope<{ matches: CveSummary[]; needle: string }>> {
  return callTool('enrichment.cve.byProduct', args, callerAgentId, context, opts);
}

export async function msrcMonthly(
  args: { yearMonth: string },
  callerAgentId: string,
  context?: TurnContext,
  opts?: EnrichmentBridgeOptions,
): Promise<EnrichmentEnvelope<{ yearMonth: string; advisories: MsrcAdvisory[]; criticalCount: number }>> {
  return callTool('enrichment.msrc.monthly', args, callerAgentId, context, opts);
}

export async function azureStatus(
  args: { region?: string },
  callerAgentId: string,
  context?: TurnContext,
  opts?: EnrichmentBridgeOptions,
): Promise<EnrichmentEnvelope<{ region: string | null; incidents: AzureIncident[]; degraded: boolean }>> {
  return callTool('enrichment.cloud.azure.status', args, callerAgentId, context, opts);
}

export async function m365Health(
  callerAgentId: string,
  context?: TurnContext,
  opts?: EnrichmentBridgeOptions,
): Promise<
  EnrichmentEnvelope<{
    fetchedAt: string;
    services: Array<{ service: string; status: string; activeIssues: number }>;
    degradedCount: number;
  }>
> {
  return callTool('enrichment.cloud.m365.health', {}, callerAgentId, context, opts);
}

export async function holidaysByCountry(
  args: { year: number; country: string },
  callerAgentId: string,
  context?: TurnContext,
  opts?: EnrichmentBridgeOptions,
): Promise<EnrichmentEnvelope<{ year: number; country: string; holidays: PublicHoliday[] }>> {
  return callTool('enrichment.holidays.byCountry', args, callerAgentId, context, opts);
}

export async function isHolidayOn(
  args: { country: string; date: string },
  callerAgentId: string,
  context?: TurnContext,
  opts?: EnrichmentBridgeOptions,
): Promise<
  EnrichmentEnvelope<{
    country: string;
    date: string;
    isHoliday: boolean;
    holiday?: PublicHoliday;
  }>
> {
  return callTool('enrichment.holidays.isHolidayOn', args, callerAgentId, context, opts);
}

export const enrichmentBridge = {
  lookupKev,
  recentKev,
  cveDetail,
  cveByProduct,
  msrcMonthly,
  azureStatus,
  m365Health,
  holidaysByCountry,
  isHolidayOn,
};
