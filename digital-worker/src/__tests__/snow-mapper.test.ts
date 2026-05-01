import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import {
  computeSignalId,
  mapSnowPayloadToSignal,
  verifySnowSignature,
  type SnowBusinessRulePayload,
} from '../snow-signal-mapper';
import { MockServiceNow, signPayload, type BusinessRuleEvent } from '../demo/mock-snow';

const samplePayload: SnowBusinessRulePayload = {
  table: 'incident',
  action: 'insert',
  sys_id: 'abc123',
  sys_updated_on: '2026-05-01T10:00:00Z',
  current: { number: 'INC0001', priority: '1', short_description: 'Outage' },
};

describe('snow-signal-mapper', () => {
  it('produces a stable signal id for identical payloads', () => {
    expect(computeSignalId(samplePayload)).toBe(computeSignalId(samplePayload));
  });

  it('changes the signal id when sys_updated_on changes', () => {
    const a = computeSignalId(samplePayload);
    const b = computeSignalId({ ...samplePayload, sys_updated_on: '2026-05-01T10:00:01Z' });
    expect(a).not.toBe(b);
  });

  it('maps priority 1 to severity critical', () => {
    const signal = mapSnowPayloadToSignal(samplePayload);
    expect(signal.severity).toBe('critical');
    expect(signal.source).toBe('servicenow');
    expect(signal.type).toBe('incident.insert');
    expect(signal.origin).toBe('observed');
  });

  it('marks demo records as scripted via u_demo_run', () => {
    const signal = mapSnowPayloadToSignal({
      ...samplePayload,
      current: { ...samplePayload.current, u_demo_run: 'run-42' },
    });
    expect(signal.origin).toBe('scripted');
  });

  it('verifies HMAC signatures with constant-time comparison', () => {
    const body = JSON.stringify(samplePayload);
    const secret = 'shhh';
    const sig = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(verifySnowSignature(body, sig, secret)).toBe(true);
    expect(verifySnowSignature(body, 'a'.repeat(sig.length), secret)).toBe(false);
    expect(verifySnowSignature(body, '', secret)).toBe(false);
    expect(verifySnowSignature(body, sig, '')).toBe(false);
  });
});

describe('MockServiceNow round-trip', () => {
  let mock: MockServiceNow;
  let baseUrl: string;
  const secret = 'mock-roundtrip-secret';
  const received: BusinessRuleEvent[] = [];

  beforeEach(async () => {
    received.length = 0;
  });

  it('emits a Business-Rule webhook on insert and rejects bad signatures', async () => {
    // Stand up an HTTP capture endpoint to receive Business Rule events.
    const captureServer = (await import('http')).createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const sig = req.headers['x-snow-signature'] as string;
        const expected = signPayload(body, secret);
        if (sig === expected) {
          received.push(JSON.parse(body));
          res.statusCode = 202;
        } else {
          res.statusCode = 401;
        }
        res.end();
      });
    });
    await new Promise<void>((r) => captureServer.listen(0, '127.0.0.1', r));
    const captureAddr = captureServer.address();
    const capturePort = typeof captureAddr === 'object' && captureAddr ? captureAddr.port : 0;
    const captureUrl = `http://127.0.0.1:${capturePort}/`;

    mock = new MockServiceNow({ webhookSecret: secret, webhookUrl: captureUrl });
    const started = await mock.start();
    baseUrl = started.baseUrl;

    const insertRes = await fetch(`${baseUrl}/api/now/table/incident`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic bW9jazptb2Nr',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ short_description: 'Edge router down', priority: '1' }),
    });
    expect(insertRes.status).toBe(201);

    // Allow time for the async emit to complete.
    await new Promise((r) => setTimeout(r, 20));
    expect(received.length).toBe(1);
    expect(received[0].action).toBe('insert');
    expect(received[0].current.priority).toBe('1');

    await mock.stop();
    await new Promise<void>((r) => captureServer.close(() => r()));
  });
});
