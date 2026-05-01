// ITSM Operations — Autonomy Gate (Pillar 6 hook + Pillar 7 plumbing)
//
// Single inline check called by the workflow-engine (and any direct
// autonomous code path) before a side-effecting step or tool call. Combines:
//   - global kill-switch
//   - change-freeze calendar
//   - per-tenant action budget
//   - worker.allowAutonomous flag
//   - tuned thresholds from autonomy-tuner
//   - the active TriggerDecision from trigger-policy
//
// Returns `allow=true` only when every guardrail agrees. Otherwise the caller
// must fall back to its existing HITL approval path (status quo).

import {
  isKillSwitchEngaged,
  isChangeFreezeActive,
  getBudgetSnapshot,
  recordAction,
} from './governance';
import type { TriggerDecision } from './trigger-policy';
import type { WorkerDefinition } from './agent-harness';
import { getTunedThresholds } from './autonomy-tuner';

export interface AutonomyGateInputs {
  workflowId: string;
  signalType?: string;
  worker?: WorkerDefinition;
  decision?: TriggerDecision;
  tenantId?: string;
  /** Optional override of the action-budget cap. */
  hourlyAutoBudget?: number;
  now?: number;
}

export interface AutonomyGateResult {
  allow: boolean;
  reason: string;
  /** Effective auto threshold actually applied (after tuner adjustment). */
  effectiveAutoThreshold: number;
}

export function autonomyGate(inputs: AutonomyGateInputs): AutonomyGateResult {
  const tenantId = inputs.tenantId ?? 'default';
  const now = inputs.now ?? Date.now();
  const tuned = getTunedThresholds(inputs.workflowId, inputs.signalType);

  if (isKillSwitchEngaged()) {
    return {
      allow: false,
      reason: 'global kill-switch engaged',
      effectiveAutoThreshold: tuned.autoThreshold,
    };
  }
  if (isChangeFreezeActive(now)) {
    return {
      allow: false,
      reason: 'change-freeze active',
      effectiveAutoThreshold: tuned.autoThreshold,
    };
  }
  if (inputs.worker && inputs.worker.allowAutonomous === false) {
    return {
      allow: false,
      reason: `worker '${inputs.worker.id}' has allowAutonomous=false`,
      effectiveAutoThreshold: tuned.autoThreshold,
    };
  }
  if (inputs.decision && inputs.decision.mode !== 'auto') {
    return {
      allow: false,
      reason: `trigger-policy mode=${inputs.decision.mode}`,
      effectiveAutoThreshold: tuned.autoThreshold,
    };
  }
  if (inputs.decision && inputs.decision.effectiveConfidence < tuned.autoThreshold) {
    return {
      allow: false,
      reason: `effective confidence ${inputs.decision.effectiveConfidence.toFixed(
        2
      )} below tuned auto threshold ${tuned.autoThreshold.toFixed(2)}`,
      effectiveAutoThreshold: tuned.autoThreshold,
    };
  }
  const cap = inputs.hourlyAutoBudget ?? 30;
  const budget = getBudgetSnapshot(tenantId, cap, 60 * 60 * 1000, now);
  if (budget.remaining <= 0) {
    return {
      allow: false,
      reason: `action budget exhausted (${budget.used}/${budget.limit})`,
      effectiveAutoThreshold: tuned.autoThreshold,
    };
  }
  recordAction(tenantId, now);
  return {
    allow: true,
    reason: `auto-allowed at confidence ${(inputs.decision?.effectiveConfidence ?? 1).toFixed(
      2
    )} ≥ ${tuned.autoThreshold.toFixed(2)}; budget ${budget.used + 1}/${budget.limit}`,
    effectiveAutoThreshold: tuned.autoThreshold,
  };
}
