import { APIRequestContext, expect } from '@playwright/test';

/**
 * MCP JSON-RPC helper functions for Playwright E2E tests.
 * Handles session initialization, tool listing, and tool invocation
 * across both ITSM and Alex MCP servers.
 */

export async function mcpInitialize(
  request: APIRequestContext,
  endpoint: string,
): Promise<string | undefined> {
  const initRes = await request.post(endpoint, {
    data: {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'playwright-test', version: '1.0.0' },
      },
      id: 0,
    },
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    timeout: 30_000,
  });
  const sessionId = initRes.headers()['mcp-session-id'];

  // Send initialized notification
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  await request.post(endpoint, {
    data: { jsonrpc: '2.0', method: 'notifications/initialized' },
    headers,
    timeout: 10_000,
  });

  return sessionId;
}

export async function mcpListTools(
  request: APIRequestContext,
  endpoint: string,
  sessionId?: string,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await request.post(endpoint, {
    data: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
    headers,
    timeout: 30_000,
  });
  return res;
}

export async function mcpCallTool(
  request: APIRequestContext,
  endpoint: string,
  toolName: string,
  args: Record<string, unknown> = {},
  sessionId?: string,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const res = await request.post(endpoint, {
    data: {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: args },
      id: 1,
    },
    headers,
    timeout: 60_000,
  });
  return res;
}

/**
 * Initialize an MCP session and return sessionId, or undefined if not needed.
 * Tries initialize → initialized handshake; swallows errors if server doesn't require it.
 */
export async function mcpSessionOrSkip(
  request: APIRequestContext,
  endpoint: string,
): Promise<string | undefined> {
  try {
    return await mcpInitialize(request, endpoint);
  } catch {
    return undefined;
  }
}

/**
 * Parse an MCP JSON-RPC response body. Handles both plain JSON and SSE text/event-stream responses.
 */
export async function parseMcpResponse(res: { text: () => Promise<string> }): Promise<any> {
  const raw = await res.text();

  // SSE format: lines starting with "data: "
  if (raw.includes('data: ')) {
    const lines = raw.split('\n').filter(l => l.startsWith('data: '));
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line.slice(6));
        if (parsed.result || parsed.error) return parsed;
      } catch { /* skip non-JSON data lines */ }
    }
  }

  // Plain JSON
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

/**
 * Extract text content from an MCP tool call result.
 */
export function extractContent(result: any): string {
  if (!result?.result?.content) return '';
  return result.result.content
    .map((c: any) => c.text || c.data || '')
    .join('\n');
}

/**
 * Assert an MCP tool call succeeded and returned content.
 */
export function expectToolSuccess(body: any) {
  expect(body).toHaveProperty('result');
  expect(body.result).toHaveProperty('content');
  expect(body.result.content.length).toBeGreaterThan(0);
}
