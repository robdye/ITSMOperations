// ITSM Operations — SNOW preflight gate
//
// Refuses to run a workflow when the originating signal lacks the SNOW
// record the workflow expects to act on. Customer requirement: "no workflows
// should happen without us having inserted the correct data into SNOW."
//
// Two failure modes this catches:
//   1. Signal references a SNOW record (sys_id / number) that doesn't
//      exist or isn't readable.
//   2. Signal carries NO SNOW reference at all for a workflow that
//      always needs one (major-incident-response, change-lifecycle,
//      incident-to-problem, knowledge-harvest, sla-breach-escalation,
//      vulnerability-to-change).
//
// Bypass: enrichment-driven workflows can carry origin='predicted' or
// 'observed' from a non-SNOW source (KEV, MSRC, Azure Status). Those are
// allowed through ONLY when the originating signal has `payload.cve` or
// `payload.advisoryId` (i.e. the workflow has external grounding even
// though SNOW doesn't yet have a record).

import type { Signal } from './signal-router';
import { getIncident } from './snow-client';
import { logAuditEntry } from './audit-trail';

export type PreflightVerdict =
  | { ok: true }
  | { ok: false; reason: string; missingRef: 'no-sys-id' | 'record-not-found' | 'no-snow-context' };

/** Workflows that ALWAYS expect a SNOW record on the originating signal. */
const STRICT_SNOW_WORKFLOWS = new Set<string>([
  'major-incident-response',
  'major-incident-response-dag',
  'change-lifecycle',
  'incident-to-problem',
  'knowledge-harvest',
  'sla-breach-escalation',
]);

/**
 * Workflows that may legitimately fire from external enrichment (KEV / MSRC /
 * Azure Status). They still need *some* grounding — either a SNOW sys_id OR
 * an enrichment payload with a CVE/advisory id — but a missing SNOW record
 * isn't fatal because the workflow's first step is usually to CREATE that
 * record in SNOW.
 */
const ENRICHMENT_TOLERANT_WORKFLOWS = new Set<string>([
  'vulnerability-to-change',
]);

interface SnowRef {
  sysId?: string;
  number?: string;
}

function extractSnowRef(signal: Signal): SnowRef {
  const p = signal.payload as
    | { sys_id?: string; id?: string; number?: string; record?: { sys_id?: string; number?: string } }
    | undefined;
  return {
    sysId: p?.sys_id || p?.id || p?.record?.sys_id,
    number: p?.number || p?.record?.number,
  };
}

function hasEnrichmentGrounding(signal: Signal): boolean {
  const p = signal.payload as
    | { cve?: string; cveId?: string; advisoryId?: string; kev?: { cveId?: string } }
    | undefined;
  return Boolean(p?.cve || p?.cveId || p?.advisoryId || p?.kev?.cveId);
}

/**
 * Verify a SNOW record exists for the workflow's originating signal.
 *
 * Returns { ok: true } when the workflow may proceed. Returns
 * { ok: false, reason, missingRef } when the workflow must be blocked.
 *
 * Always succeeds for workflows not in the strict/enrichment-tolerant
 * lists (e.g. cognition-tag workflows). Never throws.
 */
export async function assertSnowPrecondition(
  workflowId: string,
  signal: Signal,
): Promise<PreflightVerdict> {
  const isStrict = STRICT_SNOW_WORKFLOWS.has(workflowId);
  const isEnrichmentTolerant = ENRICHMENT_TOLERANT_WORKFLOWS.has(workflowId);
  if (!isStrict && !isEnrichmentTolerant) {
    return { ok: true };
  }

  const ref = extractSnowRef(signal);

  // Strict workflows: must have a sys_id AND it must resolve in SNOW.
  if (isStrict) {
    if (!ref.sysId) {
      return {
        ok: false,
        missingRef: 'no-sys-id',
        reason: `${workflowId} requires a ServiceNow sys_id on the originating signal but none was supplied.`,
      };
    }
    try {
      const r = await getIncident(ref.sysId);
      if (!r.ok || !r.record) {
        return {
          ok: false,
          missingRef: 'record-not-found',
          reason: `${workflowId} signal references ServiceNow sys_id ${ref.sysId}, but that record could not be read.`,
        };
      }
    } catch (err) {
      // Network / auth error — be strict and block. Customer would rather
      // see "blocked: SNOW unreachable" than a half-run workflow.
      return {
        ok: false,
        missingRef: 'record-not-found',
        reason:
          `${workflowId} could not verify SNOW sys_id ${ref.sysId} — ${(err as Error).message}.`,
      };
    }
    return { ok: true };
  }

  // Enrichment-tolerant workflows: either a SNOW ref OR enrichment grounding
  // is enough. The workflow is expected to write the SNOW record on its
  // first step.
  if (isEnrichmentTolerant) {
    if (ref.sysId || hasEnrichmentGrounding(signal)) {
      return { ok: true };
    }
    return {
      ok: false,
      missingRef: 'no-snow-context',
      reason:
        `${workflowId} requires either a SNOW sys_id or a CVE/advisory id ` +
        `on the originating signal, but neither was present. Refusing to ` +
        `synthesize an RFC without a verifiable source.`,
    };
  }

  return { ok: true };
}

/**
 * Audit + log when a workflow was blocked because SNOW didn't have what it
 * needs. Centralised so every blocked workflow leaves the same trail in
 * mission-control feed and audit ring.
 */
export async function auditSnowBlocked(
  workflowId: string,
  signal: Signal,
  verdict: Extract<PreflightVerdict, { ok: false }>,
): Promise<void> {
  console.warn(
    `[SnowPreflight] BLOCK ${workflowId} signal=${signal.id} reason="${verdict.reason}"`,
  );
  await logAuditEntry({
    workerId: 'workflow-subscriptions',
    workerName: 'Workflow Subscriptions',
    toolName: `preflight.snow-blocked`,
    riskLevel: 'notify',
    triggeredBy: signal.source,
    triggerType: 'escalation',
    parameters: JSON.stringify({
      workflowId,
      signalId: signal.id,
      missingRef: verdict.missingRef,
      severity: signal.severity,
      type: signal.type,
    }),
    resultSummary: verdict.reason,
    requiredConfirmation: false,
    durationMs: 0,
  }).catch(() => {});
}
