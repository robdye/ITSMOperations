// ITSM Operations — Outcome Verifier (Pillar 4 of the Anticipatory-Alex architecture)
//
// After an autonomous workflow runs, verify the expected outcome via a probe
// (a small, side-effect-free assertion). Record the labeled outcome
// (success | partial | failure | inconclusive) so it can be:
//   1) shown in Mission Control,
//   2) fed into the autonomy-tuner (Pillar 6),
//   3) used to trigger an automatic rollback workflow when registered.
//
// Probes are pluggable per workflowId. A probe returns a
// VerifierProbeResult; rollback handlers are similarly pluggable.

import type { WorkflowResult } from './workflow-engine';
import type { Signal } from './signal-router';
import {
  ANTICIPATORY_TABLES,
  loadRecent,
  upsertEntry,
  getBackend,
} from './anticipatory-store';

// ── Types ──

export type OutcomeLabel = 'success' | 'partial' | 'failure' | 'inconclusive';

export interface VerifierProbeResult {
  label: OutcomeLabel;
  /** Free-form notes for audit. */
  notes?: string;
  /** Optional metric snapshot. */
  metrics?: Record<string, number>;
}

export type VerifierProbe = (ctx: VerifierContext) => Promise<VerifierProbeResult>;
export type RollbackHandler = (ctx: VerifierContext) => Promise<void>;

export interface VerifierContext {
  workflowId: string;
  executionId: string;
  signal?: Signal;
  workflowResult: WorkflowResult;
}

export interface OutcomeRecord {
  workflowId: string;
  executionId: string;
  signalType?: string;
  label: OutcomeLabel;
  notes?: string;
  metrics?: Record<string, number>;
  rolledBack: boolean;
  rolledBackAt?: string;
  observedAt: string;
}

// ── Registry ──

const probes = new Map<string, VerifierProbe>();
const rollbacks = new Map<string, RollbackHandler>();

export function registerProbe(workflowId: string, probe: VerifierProbe): void {
  probes.set(workflowId, probe);
}

export function registerRollback(workflowId: string, handler: RollbackHandler): void {
  rollbacks.set(workflowId, handler);
}

export function _resetVerifier(): void {
  probes.clear();
  rollbacks.clear();
  outcomes.length = 0;
  successByKey.clear();
  attemptsByKey.clear();
  backfilled = false;
}

// ── Outcome history ──

const MAX_OUTCOMES = 300;
const outcomes: OutcomeRecord[] = [];
let backfilled = false;

export function getRecentOutcomes(limit = 50): OutcomeRecord[] {
  return outcomes.slice(-limit).reverse();
}

export function getOutcomeBackend(): 'azure-table' | 'memory' {
  return getBackend(ANTICIPATORY_TABLES.outcomes);
}

/**
 * Cold-start backfill: rebuild the in-memory outcome history and rolling-stat
 * maps from Table Storage so the autonomy-tuner can reach `warmedUp:true`
 * across restarts. Called once on startup.
 */
export async function backfillOutcomes(limit = MAX_OUTCOMES): Promise<number> {
  if (backfilled) return outcomes.length;
  backfilled = true;
  try {
    const stored = await loadRecent<OutcomeRecord>(ANTICIPATORY_TABLES.outcomes, { limit });
    const ordered = stored.reverse(); // oldest first so chronological order is preserved
    for (const s of ordered) {
      outcomes.push(s.payload);
      if (outcomes.length > MAX_OUTCOMES) outcomes.shift();
      bumpRollingStats(s.payload.workflowId, s.payload.signalType, s.payload.label);
    }
    if (stored.length > 0) {
      console.log(`[OutcomeVerifier] Restored ${stored.length} outcomes from Table Storage`);
    }
  } catch (err: any) {
    console.warn('[OutcomeVerifier] backfill failed:', err?.message);
  }
  return outcomes.length;
}

// ── Rolling success rate (used by autonomy-tuner) ──

const successByKey = new Map<string, number>();
const attemptsByKey = new Map<string, number>();

function bumpRollingStats(workflowId: string, signalType: string | undefined, label: OutcomeLabel) {
  const key = `${workflowId}::${signalType ?? '*'}`;
  attemptsByKey.set(key, (attemptsByKey.get(key) ?? 0) + 1);
  if (label === 'success') {
    successByKey.set(key, (successByKey.get(key) ?? 0) + 1);
  }
}

export function getRollingSuccessRate(
  workflowId: string,
  signalType?: string
): { successes: number; attempts: number; rate: number } {
  const key = `${workflowId}::${signalType ?? '*'}`;
  const attempts = attemptsByKey.get(key) ?? 0;
  const successes = successByKey.get(key) ?? 0;
  return { attempts, successes, rate: attempts === 0 ? 0 : successes / attempts };
}

// ── Default probe ──

const defaultProbe: VerifierProbe = async (ctx) => {
  const wf = ctx.workflowResult;
  if (wf.status === 'completed') return { label: 'success', notes: 'workflow completed' };
  if (wf.status === 'paused') return { label: 'partial', notes: 'workflow paused (HITL)' };
  return { label: 'failure', notes: `workflow status=${wf.status}` };
};

// ── Public API ──

export interface VerifyOptions {
  /** When true, automatically run any registered rollback on label='failure'. */
  autoRollback?: boolean;
  /** Override the probe (used by tests). */
  probe?: VerifierProbe;
  /** Use the LLM judge for this verification call (overrides registered probe). */
  useLLMJudge?: boolean;
}

/**
 * Register the LLM judge as the probe for a specific workflow id.
 * No-op when no API key is configured — the default probe is used instead.
 */
export async function registerLLMJudgeFor(workflowId: string): Promise<boolean> {
  const { llmJudgeAvailable, buildLLMJudgeProbe } = await import('./outcome-judge');
  if (!llmJudgeAvailable()) return false;
  registerProbe(workflowId, buildLLMJudgeProbe());
  console.log(`[OutcomeVerifier] LLM judge registered for ${workflowId}`);
  return true;
}

export async function verifyWorkflowOutcome(
  ctx: VerifierContext,
  opts: VerifyOptions = {}
): Promise<OutcomeRecord> {
  let probe: VerifierProbe;
  if (opts.probe) {
    probe = opts.probe;
  } else if (opts.useLLMJudge) {
    const { llmJudgeAvailable, buildLLMJudgeProbe } = await import('./outcome-judge');
    probe = llmJudgeAvailable() ? buildLLMJudgeProbe() : (probes.get(ctx.workflowId) ?? defaultProbe);
  } else {
    probe = probes.get(ctx.workflowId) ?? defaultProbe;
  }
  let probeResult: VerifierProbeResult;
  try {
    probeResult = await probe(ctx);
  } catch (err) {
    probeResult = {
      label: 'inconclusive',
      notes: `probe threw: ${(err as Error).message}`,
    };
  }
  let rolledBack = false;
  let rolledBackAt: string | undefined;
  if (opts.autoRollback && probeResult.label === 'failure') {
    const handler = rollbacks.get(ctx.workflowId);
    if (handler) {
      try {
        await handler(ctx);
        rolledBack = true;
        rolledBackAt = new Date().toISOString();
      } catch (err) {
        console.error(`[OutcomeVerifier] rollback for ${ctx.workflowId} failed:`, err);
      }
    }
  }
  const record: OutcomeRecord = {
    workflowId: ctx.workflowId,
    executionId: ctx.executionId,
    signalType: ctx.signal?.type,
    label: probeResult.label,
    notes: probeResult.notes,
    metrics: probeResult.metrics,
    rolledBack,
    rolledBackAt,
    observedAt: new Date().toISOString(),
  };
  outcomes.push(record);
  if (outcomes.length > MAX_OUTCOMES) outcomes.shift();
  bumpRollingStats(ctx.workflowId, ctx.signal?.type, record.label);
  // Write-through to Table Storage so the tuner survives restart.
  void upsertEntry(
    ANTICIPATORY_TABLES.outcomes,
    `${ctx.workflowId}::${ctx.signal?.type ?? '*'}`,
    `${ctx.executionId}-${Date.now()}`,
    record,
  ).catch((err) => console.warn('[OutcomeVerifier] persist failed:', (err as Error)?.message));
  // Phase 9.4 — record incident fingerprint for experiential lookup.
  if (ctx.signal) {
    void import('./experiential-memory')
      .then(({ recordExperience }) => recordExperience(ctx.signal!, record.label))
      .catch(() => undefined);
  }
  // Phase 9.3 — broadcast failures and rollbacks to Service Bus + telemetry.
  if (record.label === 'failure' || record.rolledBack) {
    void import('./anticipatory-broadcaster')
      .then(({ broadcastOutcomeFailure }) => broadcastOutcomeFailure(record, ctx.signal))
      .catch((err) => console.warn('[OutcomeVerifier] broadcast failed:', (err as Error)?.message));
  }
  console.log(
    `[OutcomeVerifier] ${ctx.workflowId} ${ctx.executionId} → ${record.label}${
      record.rolledBack ? ' (rolled back)' : ''
    }`
  );
  return record;
}
