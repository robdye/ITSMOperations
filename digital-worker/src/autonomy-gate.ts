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
import {
  evaluateRolePolicy,
  type RolePolicyDecision,
  type RolePolicyResult,
  type ActionRisk,
  type RolePolicyMode,
} from './role-policy';

export interface AutonomyGateInputs {
  workflowId: string;
  signalType?: string;
  worker?: WorkerDefinition;
  decision?: TriggerDecision;
  tenantId?: string;
  /** Optional override of the action-budget cap. */
  hourlyAutoBudget?: number;
  now?: number;
  /** Pattern 3 — actor identity, live roles, and inferred risk. Optional for
   *  back-compat. When omitted, the gate falls back to pre-Pattern-3 behavior. */
  actor?: string;
  actorRoles?: string[];
  actionRisk?: ActionRisk;
  toolName?: string;
  /** Pattern 3 — explicit emergency change route flag. */
  emergencyChangeRoute?: boolean;
  /** Pattern 3 — operator-set force-mode override (already honored elsewhere). */
  forceModeAuto?: boolean;
}

export interface AutonomyGateResult {
  /** Back-compat: `true` only when decision === 'ALLOW'. Existing callers
   *  that check `allow` keep working untouched. */
  allow: boolean;
  reason: string;
  /** Effective auto threshold actually applied (after tuner adjustment). */
  effectiveAutoThreshold: number;
  /** Pattern 3 — tri-state. Defaults to 'ALLOW' when role policy is skipped. */
  decision: RolePolicyDecision;
  /** Pattern 3 — surfaced for evidence pack + operator messaging. */
  rolePolicy?: RolePolicyResult;
}

export function autonomyGate(inputs: AutonomyGateInputs): AutonomyGateResult {
  const tenantId = inputs.tenantId ?? 'default';
  const now = inputs.now ?? Date.now();
  const tuned = getTunedThresholds(inputs.workflowId, inputs.signalType);

  if (isKillSwitchEngaged()) {
    return {
      allow: false,
      decision: 'DENY',
      reason: 'global kill-switch engaged',
      effectiveAutoThreshold: tuned.autoThreshold,
    };
  }
  if (isChangeFreezeActive(now)) {
    return {
      allow: false,
      decision: 'DENY',
      reason: 'change-freeze active',
      effectiveAutoThreshold: tuned.autoThreshold,
    };
  }
  if (inputs.worker && inputs.worker.allowAutonomous === false) {
    return {
      allow: false,
      decision: 'REQUIRE_HITL',
      reason: `worker '${inputs.worker.id}' has allowAutonomous=false`,
      effectiveAutoThreshold: tuned.autoThreshold,
    };
  }
  if (inputs.decision && inputs.decision.mode !== 'auto') {
    return {
      allow: false,
      decision: 'REQUIRE_HITL',
      reason: `trigger-policy mode=${inputs.decision.mode}`,
      effectiveAutoThreshold: tuned.autoThreshold,
    };
  }
  if (inputs.decision && inputs.decision.effectiveConfidence < tuned.autoThreshold) {
    return {
      allow: false,
      decision: 'REQUIRE_HITL',
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
      decision: 'REQUIRE_HITL',
      reason: `action budget exhausted (${budget.used}/${budget.limit})`,
      effectiveAutoThreshold: tuned.autoThreshold,
    };
  }

  // Pattern 3 — live-role policy. Only consulted when callers pass `toolName`
  // (interactive path + autonomous-workday). Legacy callers (existing
  // workflow-engine / signal-router that haven't opted in yet) skip this and
  // keep their pre-Pattern-3 behavior.
  let rolePolicy: RolePolicyResult | undefined;
  if (inputs.toolName) {
    const mode: RolePolicyMode = (inputs.decision?.mode as RolePolicyMode) ?? 'propose';
    rolePolicy = evaluateRolePolicy({
      actor: inputs.actor ?? 'system',
      roles: inputs.actorRoles ?? ['system'],
      toolName: inputs.toolName,
      actionRisk: inputs.actionRisk,
      mode,
      governance: {
        killSwitchEngaged: false, // already handled above
        changeFreezeActive: false, // already handled above
        emergencyChangeRoute: inputs.emergencyChangeRoute,
        forceModeAuto: inputs.forceModeAuto,
      },
    });
    if (rolePolicy.decision === 'DENY') {
      return {
        allow: false,
        decision: 'DENY',
        reason: rolePolicy.reason,
        effectiveAutoThreshold: tuned.autoThreshold,
        rolePolicy,
      };
    }
    if (rolePolicy.decision === 'REQUIRE_HITL') {
      return {
        allow: false,
        decision: 'REQUIRE_HITL',
        reason: rolePolicy.reason,
        effectiveAutoThreshold: tuned.autoThreshold,
        rolePolicy,
      };
    }
    // rolePolicy.decision === 'ALLOW' → fall through to budget+allow path.
  }

  recordAction(tenantId, now);
  return {
    allow: true,
    decision: 'ALLOW',
    reason: `auto-allowed at confidence ${(inputs.decision?.effectiveConfidence ?? 1).toFixed(
      2
    )} ≥ ${tuned.autoThreshold.toFixed(2)}; budget ${budget.used + 1}/${budget.limit}`,
    effectiveAutoThreshold: tuned.autoThreshold,
    rolePolicy,
  };
}
