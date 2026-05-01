// ITSM Operations — Autonomy Tuner (Pillar 6 of the Anticipatory-Alex architecture)
//
// Lightweight contextual bandit (ε-greedy with rolling reward) that adjusts
// per-(workflow, signalType) `autoThreshold` and `proposeThreshold` based on
// labeled outcomes from the outcome-verifier. The intent is to *raise*
// thresholds when failures are observed and *lower* them when sustained
// success is seen — keeping the worker safe by default and only earning the
// right to act more autonomously over time.
//
// Inputs:  outcome-verifier feeds rolling success rate.
// Outputs: getTunedThresholds(workflowId, signalType) used by the autonomy
//          gate and (optionally) by trigger-policy's `config.autoThreshold`.

import { DEFAULT_POLICY_CONFIG } from './trigger-policy';
import { getRollingSuccessRate } from './outcome-verifier';
import {
  ANTICIPATORY_TABLES,
  loadRecent,
  upsertEntry,
  getBackend,
} from './anticipatory-store';

export interface TunedThresholds {
  autoThreshold: number;
  proposeThreshold: number;
  attempts: number;
  successes: number;
  rate: number;
  /** True when the tuner has enough evidence to deviate from defaults. */
  warmedUp: boolean;
}

export interface TunerConfig {
  /** Minimum attempts before the tuner deviates from defaults. Default 5. */
  minAttempts: number;
  /** Cap on how far thresholds can drift from defaults. Default ±0.15. */
  maxDelta: number;
  /** Step taken per failure. Default 0.03. */
  failurePenalty: number;
  /** Step taken per sustained-success batch. Default 0.02. */
  successReward: number;
}

const DEFAULT_TUNER: TunerConfig = {
  minAttempts: 5,
  maxDelta: 0.15,
  failurePenalty: 0.03,
  successReward: 0.02,
};

let tuner: TunerConfig = { ...DEFAULT_TUNER };

const overrides = new Map<string, { autoDelta: number; proposeDelta: number }>();
let backfilled = false;

function key(workflowId: string, signalType?: string): string {
  return `${workflowId}::${signalType ?? '*'}`;
}

/** Cold-start backfill: load tuner overrides from Table Storage. */
export async function backfillTuner(): Promise<number> {
  if (backfilled) return overrides.size;
  backfilled = true;
  try {
    const stored = await loadRecent<{ autoDelta: number; proposeDelta: number }>(
      ANTICIPATORY_TABLES.tuner,
      { limit: 500 },
    );
    for (const s of stored) {
      // RowKey encoded as `${workflowId}::${signalType}` so partition+row reconstructs the key.
      overrides.set(s.rowKey, s.payload);
    }
    if (stored.length > 0) {
      console.log(`[AutonomyTuner] Restored ${stored.length} threshold overrides from Table Storage`);
    }
  } catch (err: any) {
    console.warn('[AutonomyTuner] backfill failed:', err?.message);
  }
  return overrides.size;
}

export function getTunerBackend(): 'azure-table' | 'memory' {
  return getBackend(ANTICIPATORY_TABLES.tuner);
}

export function configureTuner(config: Partial<TunerConfig>): void {
  tuner = { ...tuner, ...config };
}

export function _resetTuner(): void {
  tuner = { ...DEFAULT_TUNER };
  overrides.clear();
  backfilled = false;
}

/** Apply a small step toward stricter thresholds for this key. */
export function recordTunerSignal(
  workflowId: string,
  signalType: string | undefined,
  label: 'success' | 'partial' | 'failure' | 'inconclusive'
): void {
  const k = key(workflowId, signalType);
  const cur = overrides.get(k) ?? { autoDelta: 0, proposeDelta: 0 };
  if (label === 'failure') {
    cur.autoDelta = Math.min(tuner.maxDelta, cur.autoDelta + tuner.failurePenalty);
    cur.proposeDelta = Math.min(tuner.maxDelta, cur.proposeDelta + tuner.failurePenalty);
  } else if (label === 'success') {
    cur.autoDelta = Math.max(-tuner.maxDelta, cur.autoDelta - tuner.successReward);
    cur.proposeDelta = Math.max(-tuner.maxDelta, cur.proposeDelta - tuner.successReward);
  }
  overrides.set(k, cur);
  // Write-through so the bandit retains learning across restarts.
  void upsertEntry(
    ANTICIPATORY_TABLES.tuner,
    workflowId,
    k,
    cur,
  ).catch((err) => console.warn('[AutonomyTuner] persist failed:', (err as Error)?.message));
}

export function getTunedThresholds(
  workflowId: string,
  signalType?: string
): TunedThresholds {
  const stats = getRollingSuccessRate(workflowId, signalType);
  const k = key(workflowId, signalType);
  const drift = overrides.get(k) ?? { autoDelta: 0, proposeDelta: 0 };
  const warmedUp = stats.attempts >= tuner.minAttempts;
  const autoThreshold = clamp(
    DEFAULT_POLICY_CONFIG.autoThreshold + (warmedUp ? drift.autoDelta : 0),
    DEFAULT_POLICY_CONFIG.proposeThreshold,
    0.99
  );
  const proposeThreshold = clamp(
    DEFAULT_POLICY_CONFIG.proposeThreshold + (warmedUp ? drift.proposeDelta : 0),
    DEFAULT_POLICY_CONFIG.notifyThreshold,
    autoThreshold - 0.05
  );
  return {
    autoThreshold,
    proposeThreshold,
    attempts: stats.attempts,
    successes: stats.successes,
    rate: stats.rate,
    warmedUp,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
