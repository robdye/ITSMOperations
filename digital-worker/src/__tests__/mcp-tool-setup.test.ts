// Test suite for src/mcp-tool-setup.ts (Cassidy-pattern Agent 365 MCP layer).
//
// Modelled after Cassidy's `cassidy/src/tools/mcpToolSetup.test.ts` — we mock
// every external SDK dependency (tooling gateway, runtime auth, MCP transport)
// before importing the module so the unit tests run with zero network IO.
//
// We focus on the public contract:
//   - getLiveMcpTools() returns [] when there is no TurnContext (autonomous path)
//   - getLiveMcpTools() returns [] when discovery throws
//   - hasMcpToolServer() reflects the tools discovered in the previous turn
//   - invokeMcpTool() throws when discovery has not run for the tool name
//   - invalidateMcpCache() clears state
//   - getMcpStatus() reports counts based on discovered tools
//
// Discovery happiness paths are intentionally light — the SDK clients are deep
// vendor surfaces that change often; testing the wiring (filter, header
// merge, server-name allowlist) is more durable than re-implementing them.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the SDK surfaces BEFORE importing the module under test ───────────
// vi.mock() is hoisted to the top of the file, so any helpers it captures
// must be declared inside vi.hoisted() to be available at hoist time.

const {
  listToolServersMock,
  getMcpClientToolsMock,
  getAgenticUserTokenMock,
  clientConnectMock,
  clientCloseMock,
  clientCallToolMock,
} = vi.hoisted(() => ({
  // Loose `any` typing on these mocks: vi.fn() infers return types from the
  // default impl, but tests override with .mockResolvedValueOnce() returning
  // arbitrary shapes (server lists, tool arrays, callTool payloads). Keeping
  // them un-typed lets test cases use shape variants without fighting tsc.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listToolServersMock: vi.fn() as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMcpClientToolsMock: vi.fn() as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAgenticUserTokenMock: vi.fn(async () => 'fake-obo-token') as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientConnectMock: vi.fn(async () => undefined) as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientCloseMock: vi.fn(async () => undefined) as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientCallToolMock: vi.fn(async () => ({ result: 'ok' })) as ReturnType<typeof vi.fn> & any,
}));

vi.mock('@microsoft/agents-a365-tooling', () => ({
  McpToolServerConfigurationService: class {
    listToolServers = listToolServersMock;
    getMcpClientTools = getMcpClientToolsMock;
  },
  Utility: {
    GetToolRequestHeaders: vi.fn(() => ({
      Authorization: 'Bearer fake-obo-token',
      'x-ms-agentid': 'agent-id-fake',
    })),
  },
}));

vi.mock('@microsoft/agents-a365-runtime', () => ({
  AgenticAuthenticationService: {
    GetAgenticUserToken: getAgenticUserTokenMock,
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = clientConnectMock;
    close = clientCloseMock;
    callTool = clientCallToolMock;
  },
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(public url: URL, public opts?: unknown) {}
  },
}));

vi.mock('@microsoft/agents-hosting', () => ({
  TurnContext: class {},
}));

// agentApplication.authorization handle is required by the OBO path.
// The module loads it via lazy require('./agent') so we shim the relative path.
vi.mock('../agent', () => ({
  agentApplication: { authorization: { mock: 'authorization' } },
}));

import {
  getLiveMcpTools,
  hasMcpToolServer,
  invokeMcpTool,
  invalidateMcpCache,
  getMcpStatus,
} from '../mcp-tool-setup';

// Minimal TurnContext stub the module's normalizeServerConfig reads.
function makeContext(tenantId = 'tenant-123') {
  return {
    activity: { conversation: { tenantId } },
  } as unknown as import('@microsoft/agents-hosting').TurnContext;
}

describe('mcp-tool-setup — autonomous (no TurnContext) path', () => {
  beforeEach(() => {
    invalidateMcpCache();
    vi.clearAllMocks();
  });

  it('getLiveMcpTools returns [] when no context is supplied', async () => {
    const tools = await getLiveMcpTools(undefined);
    expect(tools).toEqual([]);
    // Discovery must NOT be attempted when there is no user session.
    expect(listToolServersMock).not.toHaveBeenCalled();
    expect(getAgenticUserTokenMock).not.toHaveBeenCalled();
  });

  it('getMcpStatus reports unavailable in autonomous mode', async () => {
    const status = await getMcpStatus(undefined);
    expect(status).toEqual({
      available: false,
      serverCount: 0,
      toolCount: 0,
      servers: [],
    });
  });

  it('hasMcpToolServer is false for any tool name before discovery', () => {
    expect(hasMcpToolServer('mcp_MailTools_sendMail')).toBe(false);
    expect(hasMcpToolServer('createEvent')).toBe(false);
  });

  it('invokeMcpTool throws when no server is registered for the tool', async () => {
    await expect(invokeMcpTool('mcp_MailTools_sendMail', {})).rejects.toThrow(
      /No server registered for tool/,
    );
  });
});

describe('mcp-tool-setup — discovery (with TurnContext)', () => {
  beforeEach(() => {
    invalidateMcpCache();
    vi.clearAllMocks();
  });

  it('returns [] and does not throw when discovery fails', async () => {
    listToolServersMock.mockRejectedValueOnce(new Error('OBO token rejected'));
    const tools = await getLiveMcpTools(makeContext());
    expect(tools).toEqual([]);
  });

  it('filters out servers not in the configured allowlist', async () => {
    listToolServersMock.mockResolvedValueOnce([
      { mcpServerName: 'mcp_MailTools', url: 'https://gw.test/mail', headers: {} },
      { mcpServerName: 'mcp_PreviewCanary', url: 'https://gw.test/canary', headers: {} },
    ]);
    getMcpClientToolsMock.mockImplementation(async (name: string) => [
      { name: `${name}_aTool`, description: 'd', inputSchema: { type: 'object' } },
    ]);

    const tools = await getLiveMcpTools(makeContext());

    // Only the allow-listed server's tool surfaces; canary is dropped.
    expect(tools).toHaveLength(1);
    expect(tools[0].serverName).toBe('mcp_MailTools');
    expect(tools[0].name).toBe('mcp_MailTools_aTool');

    // Discovery only invoked getMcpClientTools for the kept server.
    const calledNames = getMcpClientToolsMock.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(calledNames).toEqual(['mcp_MailTools']);
  });

  it('records each tool in the server map so hasMcpToolServer / invokeMcpTool work', async () => {
    listToolServersMock.mockResolvedValueOnce([
      { mcpServerName: 'mcp_TeamsServer', url: 'https://gw.test/teams', headers: {} },
    ]);
    getMcpClientToolsMock.mockResolvedValueOnce([
      { name: 'mcp_TeamsServer_sendChannelMessage', description: 'send', inputSchema: { type: 'object' } },
      { name: 'mcp_TeamsServer_listChannels', description: 'list', inputSchema: { type: 'object' } },
    ]);

    const tools = await getLiveMcpTools(makeContext());
    expect(tools.map((t) => t.name)).toEqual([
      'mcp_TeamsServer_sendChannelMessage',
      'mcp_TeamsServer_listChannels',
    ]);

    expect(hasMcpToolServer('mcp_TeamsServer_sendChannelMessage')).toBe(true);
    expect(hasMcpToolServer('mcp_TeamsServer_listChannels')).toBe(true);
    expect(hasMcpToolServer('mcp_MailTools_sendMail')).toBe(false);
  });

  it('invokeMcpTool delegates to the SDK Client.callTool and closes the transport', async () => {
    listToolServersMock.mockResolvedValueOnce([
      { mcpServerName: 'mcp_CalendarTools', url: 'https://gw.test/cal', headers: { 'x-ms-tenant-id': 'tenant-123' } },
    ]);
    getMcpClientToolsMock.mockResolvedValueOnce([
      { name: 'mcp_CalendarTools_createEvent', description: 'create', inputSchema: { type: 'object' } },
    ]);
    clientCallToolMock.mockResolvedValueOnce({ eventId: 'evt-1', joinUrl: 'https://teams/join' });

    await getLiveMcpTools(makeContext());
    const result = await invokeMcpTool<{ eventId: string; joinUrl: string }>(
      'mcp_CalendarTools_createEvent',
      { title: 'Bridge' },
    );

    expect(result.eventId).toBe('evt-1');
    expect(clientConnectMock).toHaveBeenCalledTimes(1);
    expect(clientCallToolMock).toHaveBeenCalledWith({
      name: 'mcp_CalendarTools_createEvent',
      arguments: { title: 'Bridge' },
    });
    expect(clientCloseMock).toHaveBeenCalledTimes(1);
  });

  it('caches discovery results — second call within TTL does not re-discover', async () => {
    listToolServersMock.mockResolvedValueOnce([
      { mcpServerName: 'mcp_MailTools', url: 'https://gw.test/mail', headers: {} },
    ]);
    getMcpClientToolsMock.mockResolvedValueOnce([
      { name: 'sendMail', description: 'send', inputSchema: { type: 'object' } },
    ]);

    const first = await getLiveMcpTools(makeContext());
    const second = await getLiveMcpTools(makeContext());

    expect(first).toEqual(second);
    expect(listToolServersMock).toHaveBeenCalledTimes(1);
    expect(getMcpClientToolsMock).toHaveBeenCalledTimes(1);
  });

  it('invalidateMcpCache forces a fresh discovery on the next call', async () => {
    listToolServersMock.mockResolvedValue([
      { mcpServerName: 'mcp_MailTools', url: 'https://gw.test/mail', headers: {} },
    ]);
    getMcpClientToolsMock.mockResolvedValue([
      { name: 'sendMail', description: 'send', inputSchema: { type: 'object' } },
    ]);

    await getLiveMcpTools(makeContext());
    invalidateMcpCache();
    await getLiveMcpTools(makeContext());

    expect(listToolServersMock).toHaveBeenCalledTimes(2);
  });
});

describe('mcp-tool-setup — getMcpStatus', () => {
  beforeEach(() => {
    invalidateMcpCache();
    vi.clearAllMocks();
  });

  it('reports server and tool counts after a successful discovery', async () => {
    listToolServersMock.mockResolvedValueOnce([
      { mcpServerName: 'mcp_MailTools', url: 'https://gw.test/mail', headers: {} },
      { mcpServerName: 'mcp_TeamsServer', url: 'https://gw.test/teams', headers: {} },
    ]);
    getMcpClientToolsMock
      .mockResolvedValueOnce([
        { name: 'sendMail', description: 's', inputSchema: { type: 'object' } },
        { name: 'listMail', description: 'l', inputSchema: { type: 'object' } },
      ])
      .mockResolvedValueOnce([
        { name: 'sendChannelMessage', description: 'sc', inputSchema: { type: 'object' } },
      ]);

    const status = await getMcpStatus(makeContext());
    expect(status.available).toBe(true);
    expect(status.serverCount).toBe(2);
    expect(status.toolCount).toBe(3);
    expect(status.servers.sort()).toEqual(['mcp_MailTools', 'mcp_TeamsServer']);
  });
});
