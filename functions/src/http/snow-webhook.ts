/**
 * snow-webhook
 *
 * Inbound HTTP trigger for ServiceNow Business Rule callbacks. Verifies the
 * shared HMAC secret, applies replay protection, maps the SNOW payload to the
 * internal `Signal` shape, and forwards to the digital worker's
 * `POST /api/signals` endpoint.
 *
 * The payload-to-Signal mapping intentionally lives in the digital-worker
 * module (`snow-signal-mapper.ts`) so the same code path is exercised by the
 * webhook in production and by the demo-director / unit tests in CI.
 */

import { app, HttpRequest, HttpResponse, InvocationContext } from '@azure/functions';
import crypto from 'crypto';

const REPLAY_WINDOW_MS = 10 * 60 * 1000;
const recent = new Map<string, number>();

interface SnowPayload {
  table?: string;
  action?: string;
  sys_id?: string;
  sys_updated_on?: string;
  current?: Record<string, unknown>;
  previous?: Record<string, unknown>;
}

const PRIORITY_TO_SEVERITY: Record<string, string> = {
  '1': 'critical',
  '2': 'high',
  '3': 'medium',
  '4': 'low',
  '5': 'info',
};

function severityFrom(record: Record<string, unknown> | undefined): string {
  if (!record) return 'medium';
  const priority = String(record.priority ?? record.urgency ?? '');
  return PRIORITY_TO_SEVERITY[priority] ?? 'medium';
}

function computeSignalId(payload: SnowPayload): string {
  const seed = `${payload.table}|${payload.action}|${payload.sys_id}|${payload.sys_updated_on}`;
  return `snow:${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
}

function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isReplay(replayKey: string): boolean {
  const now = Date.now();
  for (const [key, expires] of recent) {
    if (expires < now) recent.delete(key);
  }
  return recent.has(replayKey);
}

function recordReplay(replayKey: string): void {
  recent.set(replayKey, Date.now() + REPLAY_WINDOW_MS);
}

app.http('snowWebhook', {
  methods: ['POST'],
  route: 'snow/webhook',
  authLevel: 'function',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponse> => {
    const secret = process.env.SNOW_WEBHOOK_SECRET || '';
    if (!secret) {
      context.error('[snow-webhook] SNOW_WEBHOOK_SECRET is not configured');
      return new HttpResponse({ status: 500, jsonBody: { error: 'webhook-not-configured' } });
    }

    const rawBody = await request.text();
    const signature = request.headers.get('x-snow-signature');
    if (!verifySignature(rawBody, signature, secret)) {
      context.warn('[snow-webhook] HMAC signature mismatch');
      return new HttpResponse({ status: 401, jsonBody: { error: 'invalid-signature' } });
    }

    let payload: SnowPayload;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return new HttpResponse({ status: 400, jsonBody: { error: 'invalid-json' } });
    }

    if (!payload.table || !payload.action || !payload.sys_id || !payload.sys_updated_on) {
      return new HttpResponse({ status: 400, jsonBody: { error: 'missing-required-fields' } });
    }

    const replayKey = `${payload.sys_id}:${payload.sys_updated_on}`;
    if (isReplay(replayKey)) {
      return new HttpResponse({ status: 202, jsonBody: { status: 'duplicate' } });
    }
    recordReplay(replayKey);

    const isDemo = !!payload.current?.['u_demo_run'];
    const signal = {
      id: computeSignalId(payload),
      source: 'servicenow',
      type: `${payload.table}.${payload.action}`,
      severity: severityFrom(payload.current),
      asset: (payload.current?.cmdb_ci as string | undefined) || undefined,
      payload: {
        sys_id: payload.sys_id,
        number: payload.current?.number,
        record: payload.current,
        previous: payload.previous,
      },
      occurredAt: payload.sys_updated_on,
      correlationId: (payload.current?.correlation_id as string | undefined) || undefined,
      confidence: 1,
      predicted: false,
      origin: isDemo ? 'scripted' : 'observed',
    };

    const workerUrl = process.env.DIGITAL_WORKER_URL || '';
    const workerSecret = process.env.WORKER_SCHEDULED_SECRET || process.env.SCHEDULED_SECRET || '';
    if (!workerUrl || !workerSecret) {
      context.error('[snow-webhook] DIGITAL_WORKER_URL or WORKER_SCHEDULED_SECRET is missing');
      return new HttpResponse({ status: 502, jsonBody: { error: 'worker-not-configured' } });
    }

    try {
      const res = await fetch(`${workerUrl.replace(/\/+$/, '')}/api/signals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-scheduled-secret': workerSecret,
        },
        body: JSON.stringify({ signal }),
      });
      const text = await res.text().catch(() => '');
      return new HttpResponse({
        status: res.ok ? 202 : 502,
        jsonBody: {
          status: res.ok ? 'accepted' : 'worker-error',
          workerStatus: res.status,
          workerBody: text.slice(0, 512),
          signalId: signal.id,
        },
      });
    } catch (err) {
      context.error('[snow-webhook] Worker call failed:', err);
      return new HttpResponse({ status: 502, jsonBody: { error: (err as Error).message } });
    }
  },
});
