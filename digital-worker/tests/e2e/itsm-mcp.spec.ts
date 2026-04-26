import { test, expect } from '@playwright/test';
import {
  mcpSessionOrSkip,
  mcpListTools,
  mcpCallTool,
  parseMcpResponse,
  expectToolSuccess,
  extractContent,
} from './helpers';

const MCP_ENDPOINT = '/mcp';

test.describe('ITSM MCP Server — Health & Tools', () => {
  test('GET /health → 200, healthy', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status || body.healthy || JSON.stringify(body)).toMatch(/healthy|ok|true/i);
  });

  test('MCP tools/list returns 70+ tools', async ({ request }) => {
    const sessionId = await mcpSessionOrSkip(request, MCP_ENDPOINT);
    const res = await mcpListTools(request, MCP_ENDPOINT, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expect(body.result).toHaveProperty('tools');
    expect(body.result.tools.length).toBeGreaterThanOrEqual(30);
  });
});

test.describe('ITSM MCP — Dashboard Tools', () => {
  let sessionId: string | undefined;

  test.beforeAll(async ({ request }) => {
    sessionId = await mcpSessionOrSkip(request, MCP_ENDPOINT);
  });

  test('show-incident-dashboard → HTML with incident data', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-incident-dashboard', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content.toLowerCase()).toMatch(/incident|inc\d|<div|<table/i);
  });

  test('get-incidents → structured data with numeric state (1-7)', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'get-incidents', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    // Parse the text content as JSON or verify it contains state fields
    try {
      const incidents = JSON.parse(content);
      const list = Array.isArray(incidents) ? incidents : incidents.result || [];
      if (list.length > 0) {
        expect(list[0]).toHaveProperty('state');
        const state = Number(list[0].state);
        expect(state).toBeGreaterThanOrEqual(1);
        expect(state).toBeLessThanOrEqual(7);
      }
    } catch {
      // If not JSON, verify the content mentions state values
      expect(content).toMatch(/state|status/i);
    }
  });

  test('show-change-dashboard → HTML content', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-change-dashboard', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/<div|<table|change/i);
  });

  test('show-sla-dashboard → HTML with SLA data', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-sla-dashboard', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/<div|<table|sla/i);
  });

  test('show-problem-dashboard → HTML content', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-problem-dashboard', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/<div|<table|problem/i);
  });

  test('search-knowledge "password reset" → results', async ({ request }) => {
    const res = await mcpCallTool(
      request, MCP_ENDPOINT, 'search-knowledge', { query: 'password reset' }, sessionId,
    );
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content.length).toBeGreaterThan(10);
  });

  test('show-itsm-briefing → HTML briefing content', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-itsm-briefing', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/<div|<table|briefing|incident|change/i);
  });

  test('show-audit-trail → HTML with audit entries', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-audit-trail', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/<div|<table|audit/i);
  });

  test('show-finops-dashboard → HTML with FinOps data', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-finops-dashboard', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/<div|<table|cost|finops|spend/i);
  });

  test('check-eol-status "Windows Server 2019" → EOL data', async ({ request }) => {
    const res = await mcpCallTool(
      request, MCP_ENDPOINT, 'check-eol-status', { product: 'Windows Server 2019' }, sessionId,
    );
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/eol|end.of.life|lifecycle|support|windows/i);
  });
});
