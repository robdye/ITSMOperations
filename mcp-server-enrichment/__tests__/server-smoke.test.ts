import { describe, it, expect, afterAll } from 'vitest';
import { startEnrichmentServer } from '../src/index.js';

const handle = await startEnrichmentServer(0);
const baseUrl = `http://localhost:${handle.port}`;

afterAll(async () => {
  await handle.close();
});

describe('enrichment MCP smoke', () => {
  it('exposes /health without auth', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; server: string; sources: string[] };
    expect(body.status).toBe('ok');
    expect(body.server).toBe('enrichment-mcp');
    expect(body.sources).toContain('cisa-kev');
    expect(body.sources).toContain('nager-holidays');
  });

  it('rejects /enrichment/mcp without OBO bearer + tenant headers', async () => {
    const res = await fetch(`${baseUrl}/enrichment/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/OBO bearer/);
    expect(body.error.message).toMatch(/x-ms-tenant-id/);
  });

  it('rejects when only the bearer is present (missing tenant)', async () => {
    const res = await fetch(`${baseUrl}/enrichment/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer fake.jwt.token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects when only the tenant is present (missing bearer)', async () => {
    const res = await fetch(`${baseUrl}/enrichment/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ms-tenant-id': 'tenant-123',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
  });

  it('lists 9 enrichment tools when OBO + tenant headers are present (demo profile)', async () => {
    const res = await fetch(`${baseUrl}/enrichment/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer fake.jwt.token',
        'x-ms-tenant-id': 'tenant-test-001',
        'x-itsm-profile': 'demo',
        'x-caller-agent-id': 'incident-manager',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain('enrichment.kev.lookup');
    expect(names).toContain('enrichment.kev.recent');
    expect(names).toContain('enrichment.cve.detail');
    expect(names).toContain('enrichment.cve.byProduct');
    expect(names).toContain('enrichment.msrc.monthly');
    expect(names).toContain('enrichment.cloud.azure.status');
    expect(names).toContain('enrichment.cloud.m365.health');
    expect(names).toContain('enrichment.holidays.byCountry');
    expect(names).toContain('enrichment.holidays.isHolidayOn');
    expect(names).toHaveLength(9);
  });
});
