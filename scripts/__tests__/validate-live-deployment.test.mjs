import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';

import { validateLiveDeployment } from '../validate-live-deployment.mjs';

const expectedCommitSha = '0123456789abcdef';
let server;
let baseUrl;
let sourceMode = 'live-servicenow';

before(async () => {
  server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/health') {
      response.end(JSON.stringify({ status: 'healthy', ready: true, build: { sha: expectedCommitSha } }));
      return;
    }
    if (request.url === '/api/source-status') {
      response.end(JSON.stringify({
        sourceMode,
        fallbackActive: sourceMode !== 'live-servicenow',
        serviceNow: { status: 'ok' },
        mcp: { status: 'ok' },
      }));
      return;
    }
    if (request.url === '/api/platform-status') {
      response.end(JSON.stringify({
        services: {
          serviceBus: { enabled: true, connected: true },
          email: { enabled: true },
          graphMail: { enabled: true },
        },
      }));
      return;
    }
    if (request.url === '/health') {
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (request.url === '/mission-control') {
      response.setHeader('content-type', 'text/html');
      response.end('<html><title>ITSM Mission Control</title></html>');
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not-found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test('accepts a healthy deployment backed by live ServiceNow', async () => {
  sourceMode = 'live-servicenow';
  const result = await validateLiveDeployment({
    workerUrl: baseUrl,
    mcpUrl: baseUrl,
    enrichmentUrl: baseUrl,
    expectedCommitSha,
    attempts: 1,
  });
  assert.equal(result.verdict, 'customer-demo-ready');
  assert.equal(result.results.length, 6);
});

test('rejects cached or fallback source modes', async () => {
  sourceMode = 'cached';
  await assert.rejects(
    validateLiveDeployment({
      workerUrl: baseUrl,
      mcpUrl: baseUrl,
      enrichmentUrl: baseUrl,
      expectedCommitSha,
      attempts: 1,
    }),
    /Source mode is cached/,
  );
});

test('rejects a mismatched deployed commit', async () => {
  sourceMode = 'live-servicenow';
  await assert.rejects(
    validateLiveDeployment({
      workerUrl: baseUrl,
      mcpUrl: baseUrl,
      enrichmentUrl: baseUrl,
      expectedCommitSha: 'different-commit',
      attempts: 1,
    }),
    /does not match/,
  );
});
