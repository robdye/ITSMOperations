import { test, expect } from '@playwright/test';
import {
  mcpSessionOrSkip,
  mcpCallTool,
  parseMcpResponse,
  expectToolSuccess,
  extractContent,
} from './helpers';

const MCP_URL = 'https://change-mgmt-mcp.jollysand-88b78b02.eastus.azurecontainerapps.io';
test.use({ baseURL: MCP_URL });

const MCP_ENDPOINT = '/mcp';

test.describe('ITSM Demo Script — Full Scenario Validation', () => {
  let sessionId: string | undefined;

  test.beforeAll(async ({ request }) => {
    sessionId = await mcpSessionOrSkip(request, MCP_ENDPOINT);
  });

  test('Operations briefing → show-itsm-briefing', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-itsm-briefing', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/<div|incident|change|problem|briefing/i);
    expect(content.length).toBeGreaterThan(100);
  });

  test('Incident dashboard → show-incident-dashboard', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-incident-dashboard', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/incident|INC|<table|<div/i);
  });

  test('SLA compliance → show-sla-dashboard', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-sla-dashboard', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/sla|compliance|breach|%|<div/i);
  });

  test('Change dashboard → show-change-dashboard', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-change-dashboard', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/change|CHG|<div/i);
  });

  test('Change KPIs → show-change-metrics', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-change-metrics', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/metric|kpi|success|rate|<div/i);
  });

  test('Change risk briefing → show-change-briefing', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-change-briefing', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/change|risk|briefing|<div/i);
  });

  test('Blast radius → show-blast-radius', async ({ request }) => {
    const res = await mcpCallTool(
      request, MCP_ENDPOINT, 'show-blast-radius', { ci_name: 'SAP ERP' }, sessionId,
    );
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    // Tool is functional if it returns blast radius data OR a "not found" message
    expect(content).toMatch(/blast|radius|impact|dependency|not found|<div/i);
  });

  test('Knowledge search → search-knowledge', async ({ request }) => {
    const res = await mcpCallTool(
      request, MCP_ENDPOINT, 'search-knowledge', { query: 'VPN connectivity' }, sessionId,
    );
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content.length).toBeGreaterThan(10);
  });

  test('EOL check → check-eol-status', async ({ request }) => {
    const res = await mcpCallTool(
      request, MCP_ENDPOINT, 'check-eol-status', { product: 'Windows Server 2019' }, sessionId,
    );
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/eol|end.of.life|lifecycle|support|windows/i);
  });

  test('FinOps dashboard → show-finops-dashboard', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-finops-dashboard', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/finops|cost|spend|budget|<div/i);
  });

  test('Shadow agents → scan-shadow-agents', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'scan-shadow-agents', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/agent|shadow|scan|found|<div/i);
  });

  test('Shift handover → generate-shift-handover', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'generate-shift-handover', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/handover|shift|summary|incident|<div/i);
  });

  test('Audit trail → show-audit-trail', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-audit-trail', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/audit|trail|action|<div/i);
  });

  test('Scheduled routines → show-scheduled-jobs', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'show-scheduled-jobs', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/schedule|routine|job|cron|<div/i);
  });

  test('Vendor contracts → get-expiring-contracts', async ({ request }) => {
    const res = await mcpCallTool(request, MCP_ENDPOINT, 'get-expiring-contracts', {}, sessionId);
    expect(res.status()).toBe(200);
    const body = await parseMcpResponse(res);
    expectToolSuccess(body);
    const content = extractContent(body);
    expect(content).toMatch(/contract|vendor|expir|renewal|<div/i);
  });
});
