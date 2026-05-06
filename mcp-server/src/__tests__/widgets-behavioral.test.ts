/**
 * Behavioral smoke tests for the 6 manager-facing tools shipped with the
 * "DA Visual Upgrade". Each tool must:
 *   - be listed by ListTools
 *   - return a structured widget response (mimeType text/html+skybridge)
 *   - return non-empty structuredContent
 *
 * SNOW + EOL clients are mocked so the tests run offline. The server module's
 * sibling `./index.js` is mocked too so importing it does not start express.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// ── Mock express bootstrap so importing mcp-server.ts does not start the listener ──
vi.mock('../index.js', () => ({
  getPublicServerUrl: () => 'http://localhost:3978',
}));

// ── Mock SNOW client ──
vi.mock('../snow-client.js', () => {
  const sampleCi = (sys_id: string, name: string, os = 'Windows Server', osVer = '2012') => ({
    sys_id, name, os, os_version: osVer,
    sys_class_name: 'cmdb_ci_win_server',
    environment: 'Production', used_for: 'Production',
    last_discovered: '2025-01-15 09:00:00',
  });
  return {
    getIncidents: vi.fn(async () => [
      { sys_id: 'i1', number: 'INC0010001', short_description: 'API down', priority: '1', state: '2', cmdb_ci: { value: 'ci1', display_value: 'web-01' }, opened_at: '2025-02-12 09:00:00', resolved_at: null },
      { sys_id: 'i2', number: 'INC0010002', short_description: 'Slow login', priority: '3', state: '2', cmdb_ci: { value: 'ci2', display_value: 'auth-01' }, opened_at: '2025-02-12 10:00:00' },
    ]),
    getAllIncidents: vi.fn(async () => [
      { sys_id: 'i1', number: 'INC0010001', short_description: 'API down', priority: '1', state: '6',
        cmdb_ci: { value: 'ci1', display_value: 'web-01' },
        assigned_to: { display_value: 'Pat Lee' },
        assignment_group: { display_value: 'Platform Ops' },
        opened_at: '2025-02-12 09:00:00', resolved_at: '2025-02-12 09:42:00',
        close_notes: 'Restarted the API gateway and validated traffic. SLA met.',
        category: 'Network', description: 'API gateway 503s' },
    ]),
    getOpenChangeRequests: vi.fn(async () => [
      { sys_id: 'c1', number: 'CHG0030001', short_description: 'DB patch', state: '-2',
        cmdb_ci: { value: 'ci-db', display_value: 'db-01' },
        start_date: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
        end_date: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        type: 'normal', impact: '2', risk: '3',
        requested_by: { display_value: 'A. Engineer' },
        assignment_group: { display_value: 'DBA' },
        backout_plan: 'Restore from backup', test_plan: 'UAT validation' },
      { sys_id: 'c2', number: 'CHG0030002', short_description: 'DB index rebuild', state: '-2',
        cmdb_ci: { value: 'ci-db', display_value: 'db-01' },
        start_date: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
        end_date: new Date(Date.now() + 7 * 3600 * 1000).toISOString(),
        type: 'normal', impact: '2', risk: '2',
        requested_by: { display_value: 'B. Engineer' },
        assignment_group: { display_value: 'DBA' } },
    ]),
    getProblems: vi.fn(async () => [
      { sys_id: 'p1', number: 'PRB0040001' },
    ]),
    getTaskSLAs: vi.fn(async () => [
      { sys_id: 's1', has_breached: false, business_percentage: '20' },
      { sys_id: 's2', has_breached: false, business_percentage: '85' },
      { sys_id: 's3', has_breached: true,  business_percentage: '110' },
    ]),
    getCmdbCiList: vi.fn(async (table?: string) => {
      if (!table || table === 'cmdb_ci_win_server') return [sampleCi('ci1', 'web-01'), sampleCi('ci-db', 'db-01', 'Windows Server', '2008')];
      return [];
    }),
  };
});

// ── Mock EOL client ──
vi.mock('../eol-client.js', () => ({
  normalizeProductName: (s: string) => String(s || '').toLowerCase().replace(/\s/g, '-'),
  extractVersion: (_os: string, ver: string) => ver,
  checkEolStatus: vi.fn(async (_p: string, ver: string) => ({
    _riskClassification: {
      status: ver === '2008' ? 'non-compliant' : 'supported',
      eolDate: ver === '2008' ? '2020-01-14' : '2027-10-10',
      daysToEol: ver === '2008' ? -2000 : 900,
    },
  })),
}));

// ── Mock Azure Monitor + Search + Purview (transitively imported) ──
vi.mock('../azure-monitor.js', () => ({}));
vi.mock('../search-client.js', () => ({ initSearchClient: vi.fn() }));
vi.mock('../purview-dlp.js', () => ({
  classifyRecord: () => ({}),
  isOperationAllowed: () => true,
  redactPii: (s: string) => s,
  getDlpStatus: () => ({}),
  applyDlpWriteCheck: () => ({ allowed: true }),
}));

// Import lazily so mocks apply first
let createChangeServer: () => any;
beforeAll(async () => {
  ({ createChangeServer } = await import('../mcp-server.js'));
});

async function dispatch(server: any, method: string, params: any) {
  const handlers: Map<string, any> = (server as any)._requestHandlers;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`No handler for ${method} (registered: ${[...handlers.keys()].join(', ')})`);
  return handler({ method, params }, { signal: new AbortController().signal });
}

const NEW_TOOLS = [
  { name: 'show-command-bridge', args: {} },
  { name: 'show-estate-heatmap', args: {} },
  { name: 'show-time-travel', args: { months: 6 } },
  { name: 'show-change-collisions', args: { days: 14 } },
  { name: 'show-cab-pack', args: {} },
  { name: 'show-outcome-story', args: { incident_number: 'INC0010001' } },
];

describe('Manager-facing tools — behavioural smoke test', () => {
  it('lists all 6 new tools', async () => {
    const server = createChangeServer();
    const result: any = await dispatch(server, 'tools/list', {});
    const names: string[] = result.tools.map((t: any) => t.name);
    for (const { name } of NEW_TOOLS) {
      expect(names).toContain(name);
    }
  });

  for (const { name, args } of NEW_TOOLS) {
    it(`${name} returns a widget response`, async () => {
      const server = createChangeServer();
      const result: any = await dispatch(server, 'tools/call', { name, arguments: args });
      expect(result).toBeTruthy();
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content.length).toBeGreaterThan(0);
      const html = result.content[0];
      expect(html.type).toBe('text');
      expect(typeof html.text).toBe('string');
      expect(html.text.length).toBeGreaterThan(500);
      expect(html.text).toMatch(/<!DOCTYPE html>/i);
      // structuredContent is the data envelope used by the widget JS
      expect(result.structuredContent).toBeTruthy();
      // outputTemplate URI must be on the response _meta envelope
      expect(result._meta?.['openai/outputTemplate']).toMatch(/^ui:\/\/widget\//);
    });
  }
});
