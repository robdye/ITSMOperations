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

export const DEFAULT_POLICY_CONFIG: TriggerPolicyConfig = {
  autoThreshold: 0.85,
  proposeThreshold: 0.6,
  notifyThreshold: 0.3,
  hourlyAutoBudget: 30,
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
