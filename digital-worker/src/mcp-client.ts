// ITSM Operations Digital Worker — MCP Client for connecting to the ITSM MCP server

import { configDotenv } from 'dotenv';
configDotenv();

/**
 * Direct HTTP client for calling ITSM Operations MCP server.
 * Uses proper MCP JSON-RPC protocol with session initialization.
 */
export class ItsmMcpClient {
  public changeEndpoint: string;

  constructor() {
    this.changeEndpoint = process.env.MCP_CHANGE_ENDPOINT || '';
  }

  /**
   * Call an MCP tool with proper session lifecycle:
   * 1. Send initialize request → get session ID
   * 2. Send initialized notification
   * 3. Send tools/call with session ID
   */
  public async callTool(toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const endpoint = this.changeEndpoint;
    const ACCEPT = 'application/json, text/event-stream';
    const TIMEOUT_MS = 30000;

    function fetchWithTimeout(url: string, opts: RequestInit): Promise<globalThis.Response> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
    }

    // Step 1: Initialize
    const initRes = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: ACCEPT },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'itsm-digital-worker', version: '1.0.0' } },
      }),
    });
    if (!initRes.ok) throw new Error(`MCP init failed: ${initRes.status}`);
    const sessionId = initRes.headers.get('mcp-session-id') || '';

    // Step 2: Initialized notification
    await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: ACCEPT, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });

    // Step 3: Call tool
    const callRes = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: ACCEPT, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: args } }),
    });
    if (!callRes.ok) throw new Error(`MCP call ${toolName} failed: ${callRes.status}`);

    const json = await callRes.json() as any;
    if (json.error) throw new Error(`MCP error: ${json.error.message}`);

    const content = json.result?.content;
    if (content && content.length > 0 && content[0].text) {
      try { return JSON.parse(content[0].text); } catch { return content[0].text; }
    }
    return json.result;
  }

  // ── Incident Management ──
  async getIncidents(filters?: Record<string, unknown>) { return this.callTool('get-incidents', filters || {}); }
  async getIncidentDashboard() { return this.callTool('show-incident-dashboard', {}); }
  async getIncidentsForCi(ciName: string) { return this.callTool('get-incidents-for-ci', { ci_name: ciName }); }
  async createIncident(data: Record<string, unknown>) { return this.callTool('create-incident', { data: JSON.stringify(data) }); }
  async updateIncident(sysId: string, fields: Record<string, unknown>) { return this.callTool('update-incident', { sys_id: sysId, fields: JSON.stringify(fields) }); }

  // ── Problem Management ──
  async getProblems() { return this.callTool('show-problem-dashboard', {}); }
  async createProblem(data: Record<string, unknown>) { return this.callTool('create-problem', { data: JSON.stringify(data) }); }
  async updateProblem(sysId: string, fields: Record<string, unknown>) { return this.callTool('update-problem', { sys_id: sysId, fields: JSON.stringify(fields) }); }

  // ── Change Management ──
  async getChangeDashboard() { return this.callTool('show-change-dashboard', {}); }
  async getChangeRequest(number: string) { return this.callTool('show-change-request', { number }); }
  async getBlastRadius(ciName: string) { return this.callTool('show-blast-radius', { ci_name: ciName }); }
  async getChangeMetrics() { return this.callTool('show-change-metrics', {}); }
  async getChangeBriefing() { return this.callTool('show-change-briefing', {}); }
  async generateCabAgenda() { return this.callTool('generate-cab-agenda', {}); }
  async detectCollisions() { return this.callTool('detect-change-collisions', {}); }
  async getChangeHistory(ciName?: string, category?: string) { return this.callTool('get-change-history', { ci_name: ciName, category }); }
  async postImplementationReview(number: string) { return this.callTool('post-implementation-review', { number }); }

  // ── SLA Management ──
  async getSlaDashboard() { return this.callTool('show-sla-dashboard', {}); }

  // ── CMDB ──
  async getCmdbCi(name: string) { return this.callTool('get-cmdb-ci', { name }); }
  async getCiRelationships(ciSysId: string) { return this.callTool('get-ci-relationships', { ci_sys_id: ciSysId }); }

  // ── Knowledge ──
  async searchKnowledge(query: string) { return this.callTool('search-knowledge', { query }); }
  async updateKnowledgeArticle(sysId: string, fields: Record<string, unknown>) { return this.callTool('update-knowledge-article', { sys_id: sysId, fields: JSON.stringify(fields) }); }

  // ── Assets ──
  async getAssets(filters?: Record<string, unknown>) { return this.callTool('get-assets', filters || {}); }
  async getExpiredWarranties() { return this.callTool('get-expired-warranties', {}); }
  async createAsset(data: Record<string, unknown>) { return this.callTool('create-asset', { data: JSON.stringify(data) }); }
  async updateAsset(sysId: string, fields: Record<string, unknown>) { return this.callTool('update-asset', { sys_id: sysId, fields: JSON.stringify(fields) }); }

  // ── EOL ──
  async checkEolStatus(product: string, version: string) { return this.callTool('check-eol-status', { product, version }); }

  // ── ITSM Briefing ──
  async getItsmBriefing() { return this.callTool('show-itsm-briefing', {}); }

  // ── Asset Lifecycle ──
  async getAssetLifecycle() { return this.callTool('show-asset-lifecycle', {}); }
}
