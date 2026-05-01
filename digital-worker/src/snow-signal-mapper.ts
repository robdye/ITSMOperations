// ITSM Operations — Inbound ServiceNow signal mapping.
// Converts Business-Rule webhook payloads (or any SNOW table event) into
// the internal `Signal` shape consumed by the signal-router.
//
// Co-located with snow-client so both directions live in one module group.

import crypto from 'crypto';
import type { Signal, SignalSeverity } from './signal-router';

export interface SnowBusinessRulePayload {
  table: string;
  action: 'insert' | 'update' | string;
  sys_id: string;
  sys_updated_on: string;
  current?: Record<string, unknown>;
  previous?: Record<string, unknown>;
}

const PRIORITY_TO_SEVERITY: Record<string, SignalSeverity> = {
  '1': 'critical',
  '2': 'high',
  '3': 'medium',
  '4': 'low',
  '5': 'info',
};

function severityFrom(record: Record<string, unknown> | undefined): SignalSeverity {
  if (!record) return 'medium';
  const priority = String(record.priority ?? record.urgency ?? '');
  return PRIORITY_TO_SEVERITY[priority] ?? 'medium';
}

/** Stable signal id derived from the SNOW record + action + update timestamp. */
export function computeSignalId(payload: SnowBusinessRulePayload): string {
  const seed = `${payload.table}|${payload.action}|${payload.sys_id}|${payload.sys_updated_on}`;
  return `snow:${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
}

export function mapSnowPayloadToSignal(payload: SnowBusinessRulePayload): Signal {
  const severity = severityFrom(payload.current);
  const isDemo = !!payload.current?.['u_demo_run'];
  return {
    id: computeSignalId(payload),
    source: 'servicenow',
    type: `${payload.table}.${payload.action}`,
    severity,
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
}

/** Constant-time HMAC validation. */
export function verifySnowSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
