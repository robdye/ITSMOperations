#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

function requiredUrl(name, value) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  const url = new URL(value);
  return url.toString().replace(/\/+$/, '');
}

async function fetchResponse(name, url, attempts, timeoutMs) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json, text/html' },
        signal: controller.signal,
      });
      if (response.ok) {
        return response;
      }
      lastError = new Error(`${name} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error(`${name} failed after ${attempts} attempts: ${String(lastError)}`);
}

async function fetchJson(name, url, options) {
  const response = await fetchResponse(name, url, options.attempts, options.timeoutMs);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${name} did not return valid JSON: ${String(error)}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export async function validateLiveDeployment(config) {
  const workerUrl = requiredUrl('ITSM_WORKER_URL', config.workerUrl);
  const mcpUrl = requiredUrl('ITSM_MCP_URL', config.mcpUrl);
  const enrichmentUrl = requiredUrl('ITSM_ENRICHMENT_URL', config.enrichmentUrl);
  const options = {
    attempts: config.attempts ?? 5,
    timeoutMs: config.timeoutMs ?? 10000,
  };

  const results = [];
  const workerHealth = await fetchJson('Digital Worker health', `${workerUrl}/api/health`, options);
  assert(workerHealth.status === 'healthy' && workerHealth.ready === true, 'Digital Worker is not ready');
  if (config.expectedCommitSha) {
    assert(
      workerHealth.build?.sha === config.expectedCommitSha,
      `Digital Worker build ${workerHealth.build?.sha ?? 'unknown'} does not match ${config.expectedCommitSha}`,
    );
  }
  results.push({ check: 'digital-worker-health', status: 'pass', buildSha: workerHealth.build?.sha });

  const sourceStatus = await fetchJson('Live source status', `${workerUrl}/api/source-status`, options);
  assert(sourceStatus.sourceMode === 'live-servicenow', `Source mode is ${sourceStatus.sourceMode}`);
  assert(sourceStatus.fallbackActive === false, 'A fallback data source is active');
  assert(sourceStatus.serviceNow?.status === 'ok', `ServiceNow status is ${sourceStatus.serviceNow?.status}`);
  assert(sourceStatus.mcp?.status === 'ok', `MCP status is ${sourceStatus.mcp?.status}`);
  results.push({ check: 'live-servicenow', status: 'pass', sourceMode: sourceStatus.sourceMode });

  const platformStatus = await fetchJson('Platform status', `${workerUrl}/api/platform-status`, options);
  assert(
    platformStatus.services?.serviceBus?.enabled === true
      && platformStatus.services?.serviceBus?.connected === true,
    'Service Bus is not connected',
  );
  assert(platformStatus.services?.email?.enabled === true, 'Graph email service is not configured');
  assert(platformStatus.services?.graphMail?.enabled === true, 'Graph mail sender is not configured');
  results.push({ check: 'platform-integrations', status: 'pass' });

  const mcpHealth = await fetchJson('Change MCP health', `${mcpUrl}/health`, options);
  assert(mcpHealth.status === 'ok', `Change MCP status is ${mcpHealth.status}`);
  results.push({ check: 'change-mcp-health', status: 'pass' });

  const enrichmentHealth = await fetchJson('Enrichment MCP health', `${enrichmentUrl}/health`, options);
  assert(enrichmentHealth.status === 'ok', `Enrichment MCP status is ${enrichmentHealth.status}`);
  results.push({ check: 'enrichment-mcp-health', status: 'pass' });

  const missionControl = await fetchResponse(
    'Mission Control',
    `${workerUrl}/mission-control`,
    options.attempts,
    options.timeoutMs,
  );
  const missionControlHtml = await missionControl.text();
  assert(/ITSM|Mission Control/i.test(missionControlHtml), 'Mission Control returned unexpected content');
  results.push({ check: 'mission-control-ui', status: 'pass' });

  return {
    verdict: 'customer-demo-ready',
    checkedAt: new Date().toISOString(),
    workerUrl,
    mcpUrl,
    enrichmentUrl,
    results,
  };
}

async function main() {
  const result = await validateLiveDeployment({
    workerUrl: process.env.ITSM_WORKER_URL,
    mcpUrl: process.env.ITSM_MCP_URL,
    enrichmentUrl: process.env.ITSM_ENRICHMENT_URL,
    expectedCommitSha: process.env.EXPECTED_COMMIT_SHA,
  });
  console.log(JSON.stringify(result, null, 2));
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`[live-readiness] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
