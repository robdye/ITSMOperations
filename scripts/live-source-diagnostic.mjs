#!/usr/bin/env node
const base = process.env.ITSM_WORKER_URL || 'https://itsm-operations-worker.jollysand-88b78b02.eastus.azurecontainerapps.io';
const mcp = process.env.ITSM_MCP_URL || 'https://itsm-mcp-server.graycoast-8df9ee76.eastus.azurecontainerapps.io';
const token = process.env.ITSM_AUTH_TOKEN || '';
const headers = token ? { Authorization: `Bearer ${token}` } : {};
async function probe(name, url, init = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, headers: { ...headers, ...(init.headers || {}) } });
    const text = await res.text();
    return { name, url, status: res.status, ok: res.ok, ms: Date.now() - started, body: text.slice(0, 500) };
  } catch (err) {
    return { name, url, ok: false, error: String(err), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
const checks = [
  ['worker-health', `${base}/api/health`],
  ['mission-control', `${base}/mission-control`],
  ['worker-source-status', `${base}/api/source-status`],
  ['worker-incidents', `${base}/api/incidents`],
  ['worker-changes', `${base}/api/changes`],
  ['worker-briefing', `${base}/api/briefing`],
  ['worker-governance', `${base}/api/governance`],
  ['worker-workers', `${base}/api/workers`],
  ['mcp-health', `${mcp}/health`],
  ['mcp-endpoint', `${mcp}/mcp`, { headers: { Accept: 'application/json, text/event-stream' } }]
];
const results = [];
for (const [name, url, init] of checks) results.push(await probe(name, url, init || {}));
const summary = {
  generatedAt: new Date().toISOString(),
  authTokenProvided: Boolean(token),
  workerUrl: base,
  mcpUrl: mcp,
  results,
  verdict: results.some(r => r.name.includes('incidents') && r.status === 200) ? 'live-operational-read-proven' : 'live-operational-read-not-proven'
};
console.log(JSON.stringify(summary, null, 2));
