// ITSM Operations — Trigger Policy
// Confidence-gated autonomy. Given a workflow + the signal that fired it,
// decide whether to run automatically, propose, dry-run, notify only, or
// suppress. Inputs include signal confidence, the worker's blast radius,
// the worker's allowAutonomous flag, an in-memory action budget, and a
// change-freeze stub.
//
// Pillar 2 of the Anticipatory-Alex architecture (MVP slice).

import type { Signal } from './signal-router';
import type { WorkerDefinition } from './agent-harness';

// ── Types ──

export type TriggerMode = 'auto' | 'dry-run' | 'propose' | 'notify-only' | 'suppress';

export interface ApprovalPolicy {
  /** Whether the workflow must collect human approval before any side-effect step. */
  requireApproval: boolean;
  /** Suggested approver group (mapped to Teams approvals downstream). */
  approverGroup?: string;
}

export interface TriggerDecision {
  workflowId: string;
  mode: TriggerMode;
  /** Effective confidence after damping by blast radius. */
  effectiveConfidence: number;
  reason: string;
  approvalPolicy: ApprovalPolicy;
}

export interface TriggerPolicyConfig {
  /** auto when effectiveConfidence ≥ this. Default 0.85. */
  autoThreshold: number;
  /** propose / dry-run when effectiveConfidence ≥ this. Default 0.6. */
  proposeThreshold: number;
  /** notify-only when effectiveConfidence ≥ this. Below this → suppress. Default 0.3. */
  notifyThreshold: number;
  /** Max autonomous actions per tenant per hour. Default 30. */
  hourlyAutoBudget: number;
}

export interface TriggerPolicyInputs {
  workflowId: string;
  signal: Signal;
  worker?: WorkerDefinition;
  /** Tenant id used for budget bookkeeping. Defaults to 'default'. */
  tenantId?: string;
  /** Optional override of the default config (used by tests). */
  config?: Partial<TriggerPolicyConfig>;
  /** Optional change-freeze override (used by tests). */
  isChangeFreeze?: () => boolean;
  /** Optional clock override (used by tests). */
  now?: () => number;
}

// ── Defaults ──
//
// Operators can override any of the four knobs at deploy time via env vars
// without rebuilding. Useful for demos that need to push live workflows past
// the conservative production thresholds.
//
//   TRIGGER_AUTO_THRESHOLD       — auto when effectiveConfidence ≥ this   (default 0.85)
//   TRIGGER_PROPOSE_THRESHOLD    — propose / dry-run when ≥ this           (default 0.6)
//   TRIGGER_NOTIFY_THRESHOLD     — notify-only when ≥ this; below = drop  (default 0.3)
//   TRIGGER_HOURLY_AUTO_BUDGET   — max autonomous actions/hour/tenant      (default 30)

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const DEFAULT_POLICY_CONFIG: TriggerPolicyConfig = {
  autoThreshold: envFloat('TRIGGER_AUTO_THRESHOLD', 0.85),
  proposeThreshold: envFloat('TRIGGER_PROPOSE_THRESHOLD', 0.6),
  notifyThreshold: envFloat('TRIGGER_NOTIFY_THRESHOLD', 0.3),
  hourlyAutoBudget: envInt('TRIGGER_HOURLY_AUTO_BUDGET', 30),
};

// ── Action budget bookkeeping (in-memory; per-tenant) ──

const HOUR_MS = 60 * 60 * 1000;
const autoActionStamps = new Map<string, number[]>();

function recordAutoAction(tenantId: string, now: number): void {
  const stamps = autoActionStamps.get(tenantId) ?? [];
  stamps.push(now);
  autoActionStamps.set(tenantId, stamps);
}

function autoActionsInLastHour(tenantId: string, now: number): number {
  const stamps = autoActionStamps.get(tenantId) ?? [];
  const cutoff = now - HOUR_MS;
  const fresh = stamps.filter((t) => t >= cutoff);
  if (fresh.length !== stamps.length) {
    autoActionStamps.set(tenantId, fresh);
  }
  return fresh.length;
}

/** Test-only: clears the in-memory budget store. */
export function _resetTriggerPolicyState(): void {
  autoActionStamps.clear();
}

// ── Core ──

function defaultIsChangeFreeze(): boolean {
  // Change-freeze stub. Real integration with change-manager lives in a
  // later phase. For MVP we honour an env flag so demos can show it firing.
  const raw = process.env.CHANGE_FREEZE;
  if (!raw) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/**
 * Evaluate the trigger decision for a (workflow, signal) pair.
 *
 * Effective confidence = baseConfidence * (1 - 0.5 * blastRadius)
 *   where baseConfidence defaults to 1.0 for observed signals and to the
 *   signal's `confidence` field otherwise, and blastRadius is in [0, 1]
 *   (0 = harmless, 1 = wide impact, irreversible).
 */
export function evaluateTrigger(inputs: TriggerPolicyInputs): TriggerDecision {
  const config = { ...DEFAULT_POLICY_CONFIG, ...(inputs.config ?? {}) };
  const tenantId = inputs.tenantId ?? 'default';
  const isFreeze = inputs.isChangeFreeze ?? defaultIsChangeFreeze;
  const now = (inputs.now ?? Date.now)();

  const baseConfidence =
    typeof inputs.signal.confidence === 'number'
      ? Math.max(0, Math.min(1, inputs.signal.confidence))
      : inputs.signal.predicted
        ? 0.6
        : 1.0;
  const blastRadius = Math.max(0, Math.min(1, inputs.worker?.blastRadius ?? 0.5));
  const effectiveConfidence = baseConfidence * (1 - 0.5 * blastRadius);

  const approvalPolicy: ApprovalPolicy = {
    requireApproval: blastRadius >= 0.5,
    approverGroup: inputs.worker?.id ? `${inputs.worker.id}-approvers` : undefined,
  };

  // ── forceMode bypass ─────────────────────────────────────────────
  // Demo / scripted signals can carry `forceMode` to short-circuit the
  // confidence math entirely. This is the lever the Mission-Control storm
  // button uses to push every signal straight to `auto` so workflows run
  // live instead of in dry-run. Hard gates (change-freeze + worker
  // allowAutonomous=false) still take precedence below.
  if (inputs.signal.forceMode) {
    const m = inputs.signal.forceMode;
    if (m === 'auto') {
      // Still respect the per-tenant budget so a runaway demo can't
      // exhaust the production action allowance.
      const used = autoActionsInLastHour(tenantId, now);
      if (used < config.hourlyAutoBudget) {
        recordAutoAction(tenantId, now);
        return {
          workflowId: inputs.workflowId,
          mode: 'auto',
          effectiveConfidence,
          reason: `forceMode=auto (signal ${inputs.signal.id}) — bypassing confidence math.`,
          approvalPolicy: { ...approvalPolicy, requireApproval: false },
        };
      }
      // Budget exhausted: fall through to normal evaluation.
    } else if (m === 'propose' || m === 'dry-run' || m === 'notify-only') {
      return {
        workflowId: inputs.workflowId,
        mode: m,
        effectiveConfidence,
        reason: `forceMode=${m} (signal ${inputs.signal.id}) — bypassing confidence math.`,
        approvalPolicy: { ...approvalPolicy, requireApproval: m === 'propose' },
      };
    }
  }

  // Hard gates first ────────────────────────────────────────────────
  if (isFreeze()) {
    return {
      workflowId: inputs.workflowId,
      mode: 'propose',
      effectiveConfidence,
      reason: 'Change freeze active — autonomy downgraded to propose.',
      approvalPolicy: { ...approvalPolicy, requireApproval: true },
    };
  }

  if (inputs.worker && inputs.worker.allowAutonomous === false) {
    if (effectiveConfidence >= config.notifyThreshold) {
      return {
        workflowId: inputs.workflowId,
        mode: 'propose',
        effectiveConfidence,
        reason: `Worker '${inputs.worker.id}' has allowAutonomous=false — proposing for approval.`,
        approvalPolicy: { ...approvalPolicy, requireApproval: true },
      };
    }
    return {
      workflowId: inputs.workflowId,
      mode: 'notify-only',
      effectiveConfidence,
      reason: `Worker '${inputs.worker.id}' has allowAutonomous=false and confidence ${effectiveConfidence.toFixed(
        2
      )} too low — notify-only.`,
      approvalPolicy,
    };
  }

  // Confidence-gated decision ──────────────────────────────────────
  if (effectiveConfidence >= config.autoThreshold) {
    const used = autoActionsInLastHour(tenantId, now);
    if (used >= config.hourlyAutoBudget) {
      return {
        workflowId: inputs.workflowId,
        mode: 'propose',
        effectiveConfidence,
        reason: `Action budget exhausted (${used}/${config.hourlyAutoBudget} this hour) — proposing instead of auto-running.`,
        approvalPolicy: { ...approvalPolicy, requireApproval: true },
      };
    }
    recordAutoAction(tenantId, now);
    return {
      workflowId: inputs.workflowId,
      mode: 'auto',
      effectiveConfidence,
      reason: `Effective confidence ${effectiveConfidence.toFixed(2)} ≥ auto threshold ${config.autoThreshold}.`,
      approvalPolicy,
    };
  }

  if (effectiveConfidence >= config.proposeThreshold) {
    const mode: TriggerMode = blastRadius >= 0.7 ? 'propose' : 'dry-run';
    return {
      workflowId: inputs.workflowId,
      mode,
      effectiveConfidence,
      reason: `Effective confidence ${effectiveConfidence.toFixed(2)} between propose (${config.proposeThreshold}) and auto (${config.autoThreshold}) — ${mode}.`,
      approvalPolicy: { ...approvalPolicy, requireApproval: mode === 'propose' },
    };
  }

  if (effectiveConfidence >= config.notifyThreshold) {
    return {
      workflowId: inputs.workflowId,
      mode: 'notify-only',
      effectiveConfidence,
      reason: `Effective confidence ${effectiveConfidence.toFixed(2)} below propose threshold (${config.proposeThreshold}) — notify only.`,
      approvalPolicy,
    };
  }

  return {
    workflowId: inputs.workflowId,
    mode: 'suppress',
    effectiveConfidence,
    reason: `Effective confidence ${effectiveConfidence.toFixed(2)} below notify threshold (${config.notifyThreshold}) — suppressed.`,
    approvalPolicy,
  };
}
