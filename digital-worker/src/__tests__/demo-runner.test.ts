import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { signalRouter, when, type Signal } from '../signal-router';
import {
  mapSnowPayloadToSignal,
  verifySnowSignature,
  type SnowBusinessRulePayload,
} from '../snow-signal-mapper';
import { MockServiceNow, signPayload } from '../demo/mock-snow';
import { DemoDirector, DemoTargetNotAllowedError } from '../demo/demo-director';
import { _resetTenantProfileCache } from '../demo/tenant-profile';

const SECRET = 'e2e-secret';

interface ReceivedSignal {
  decisions: { workflowId: string; matched: boolean }[];
  signal: Signal;
}

describe('demo-director end-to-end (mock SNOW)', () => {
  let mock: MockServiceNow;
  let webhook: http.Server;
  let webhookUrl: string;
  let baseUrl: string;
  const received: ReceivedSignal[] = [];

  beforeEach(async () => {
    received.length = 0;
    signalRouter.reset();
    _resetTenantProfileCache();

    // Wire one workflow subscription so the scenario assertion has something
    // to find. We don't run the real ITIL workflow in this test; we only
    // verify the routing contract.
    signalRouter.subscribe({
      workflowId: 'major-incident-response',
      predicate: when.all(when.source('servicenow'), (s) => s.type.startsWith('incident.')),
    });

    // Stand up a webhook receiver that mimics the Azure Function: verifies
    // HMAC, maps payload, publishes to signal-router.
    webhook = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        const sig = req.headers['x-snow-signature'] as string;
        if (!verifySnowSignature(body, sig, SECRET)) {
          res.statusCode = 401;
          res.end();
          return;
        }
        const payload = JSON.parse(body) as SnowBusinessRulePayload;
        const signal = mapSnowPayloadToSignal(payload);
        const decisions = await signalRouter.publish(signal);
        received.push({ decisions, signal });
        res.statusCode = 202;
        res.end();
      });
    });
    await new Promise<void>((r) => webhook.listen(0, '127.0.0.1', r));
    const addr = webhook.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    webhookUrl = `http://127.0.0.1:${port}/`;

    mock = new MockServiceNow({ webhookSecret: SECRET, webhookUrl });
    const started = await mock.start();
    baseUrl = started.baseUrl;
  });

  afterEach(async () => {
    await mock.stop();
    await new Promise<void>((r) => webhook.close(() => r()));
  });

  it('runs the snow-incident-storm scenario and routes signals to the workflow', async () => {
    process.env.TENANT_ID = 'demo-tenant';
    const director = new DemoDirector({
      tenantId: 'demo-tenant',
      instanceUrl: baseUrl,
      authHeader: 'Basic bW9jazptb2Nr',
    });

    const report = await director.run('snow-incident-storm');

    // Allow async webhook deliveries from mock-snow to settle.
    const deadline = Date.now() + 2000;
    while (
      received.filter((r) => r.signal.type === 'incident.insert').length < 3 &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(report.passed).toBe(true);
    // 3 incident inserts → 3 routed decisions for major-incident-response.
    const routedToMajor = received.filter((r) => r.signal.type === 'incident.insert');
    expect(routedToMajor.length).toBeGreaterThanOrEqual(3);
    for (const entry of routedToMajor) {
      expect(entry.signal.origin).toBe('scripted');
      expect(entry.decisions.some((d) => d.workflowId === 'major-incident-response' && d.matched)).toBe(
        true,
      );
    }
    // Records exist in mock-snow with the demo-run tag.
    const tagged = mock.listRecords('incident').filter((r) => r['u_demo_run']);
    expect(tagged.length).toBeGreaterThanOrEqual(3);
    expect(tagged.every((r) => String(r.work_notes ?? '').startsWith('[demo:run:'))).toBe(true);
  });

  it('refuses scenarios when tenant lacks allowDemoDirector', () => {
    expect(
      () =>
        new DemoDirector({
          tenantId: 'unknown-tenant',
          instanceUrl: baseUrl,
          authHeader: 'Basic bW9jazptb2Nr',
        }),
    ).toThrow(DemoTargetNotAllowedError);
  });

  it('refuses non-allow-listed SNOW hosts even when tenant flag is on', () => {
    process.env.TENANT_ID = 'demo-tenant';
    expect(
      () =>
        new DemoDirector({
          tenantId: 'demo-tenant',
          instanceUrl: 'https://hostile.example.com',
          authHeader: 'Basic bW9jazptb2Nr',
        }),
    ).toThrow(DemoTargetNotAllowedError);
  });

  // Helper to silence unused-import warnings for signPayload (it's useful
  // documentation of the mock's contract).
  void [signPayload];
});
