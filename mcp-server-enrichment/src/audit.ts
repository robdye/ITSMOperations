/**
 * Audit emitter for enrichment tool calls.
 *
 * Hard rule #9 (Phase E): every enrichment call must be attributed in the
 * audit trail with `tool: "enrichment:<source>"` and `triggeredBy:
 * <callerAgentId>`.
 *
 * Two paths:
 *   1. Local (always on) — write a structured JSON line to stdout. The
 *      Container Apps log pipeline picks this up and surfaces it in
 *      Application Insights via the existing customDimensions schema.
 *   2. Remote (best-effort) — when `AUDIT_TRAIL_ENDPOINT` is configured,
 *      POST the same record to digital-worker's `/api/audit/enrichment`
 *      endpoint so it lands in the same Cosmos / Table store as the
 *      worker-emitted entries.
 *
 * Failures NEVER throw — auditing is observability, not control. Callers
 * always proceed.
 */

import type { EnrichmentAuthContext } from './auth.js';
import type { SafetyVerdict } from './safety.js';

export type EnrichmentRiskLevel = 'read' | 'write' | 'notify' | 'block';

export interface EnrichmentAuditEntry {
  ts: string;
  tool: string; // e.g. "enrichment:cisa-kev"
  source: string; // e.g. "cisa-kev"
  callerAgentId: string;
  tenantId: string;
  profile: 'demo' | 'prod';
  riskLevel: EnrichmentRiskLevel;
  triggerType: 'a2a';
  parameters: string;
  resultSummary: string;
  cacheHit: boolean;
  fixtureUsed: boolean;
  durationMs: number;
  contentSafety?: SafetyVerdict['contentSafety'];
  purview?: SafetyVerdict['purview'];
  correlationId?: string;
}

const AUDIT_ENDPOINT = process.env.AUDIT_TRAIL_ENDPOINT || '';
const AUDIT_KEY = process.env.AUDIT_TRAIL_KEY || '';

const LOG_PREFIX = '[audit-enrichment]';

const ringBuffer: EnrichmentAuditEntry[] = [];
const RING_MAX = 200;

export function getRecentAuditEntries(limit = 100): EnrichmentAuditEntry[] {
  return ringBuffer.slice(-Math.max(0, Math.min(limit, RING_MAX)));
}

export async function emitEnrichmentAudit(entry: EnrichmentAuditEntry): Promise<void> {
  ringBuffer.push(entry);
  if (ringBuffer.length > RING_MAX) ringBuffer.splice(0, ringBuffer.length - RING_MAX);

  // 1. Always log locally (structured JSON line).
  try {
    console.log(`${LOG_PREFIX} ${JSON.stringify(entry)}`);
  } catch {
    /* noop */
  }

  // 2. Optionally POST to the digital-worker audit endpoint.
  if (!AUDIT_ENDPOINT) return;
  try {
    await fetch(`${AUDIT_ENDPOINT.replace(/\/+$/, '')}/api/audit/enrichment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(AUDIT_KEY ? { 'x-audit-key': AUDIT_KEY } : {}),
      },
      body: JSON.stringify(entry),
    });
  } catch (err) {
    console.warn(`${LOG_PREFIX} remote audit emit failed: ${(err as Error).message}`);
  }
}

/**
 * Helper to build + emit an audit entry from a tool invocation.
 */
export function buildAuditEntry(args: {
  source: string;
  ctx: EnrichmentAuthContext;
  parameters: Record<string, unknown>;
  resultSummary: string;
  cacheHit: boolean;
  fixtureUsed: boolean;
  durationMs: number;
  riskLevel?: EnrichmentRiskLevel;
  verdict?: SafetyVerdict;
}): EnrichmentAuditEntry {
  return {
    ts: new Date().toISOString(),
    tool: `enrichment:${args.source}`,
    source: args.source,
    callerAgentId: args.ctx.callerAgentId,
    tenantId: args.ctx.tenantId,
    profile: args.ctx.profile,
    riskLevel: args.riskLevel ?? 'read',
    triggerType: 'a2a',
    parameters: JSON.stringify(args.parameters).slice(0, 4_000),
    resultSummary: args.resultSummary.slice(0, 1_000),
    cacheHit: args.cacheHit,
    fixtureUsed: args.fixtureUsed,
    durationMs: args.durationMs,
    contentSafety: args.verdict?.contentSafety,
    purview: args.verdict?.purview,
    correlationId: args.ctx.correlationId,
  };
}
