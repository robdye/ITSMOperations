// ITSM Operations — Role Policy (Pattern 3)
//
// Pure decision matrix that maps {actor, roles, action, risk, mode, governance}
// to one of three decisions: ALLOW | REQUIRE_HITL | DENY. Pure functions only —
// no I/O, no side effects, no env reads. Composed by `autonomy-gate.ts` on top
// of existing kill-switch / change-freeze / budget checks.
//
// Roles are coarse-grained in this iteration:
//   - incident-responder    : routine read/triage + ack-class writes
//   - change-manager        : create/update change_request
//   - problem-manager       : create/update problem
//   - security-officer      : security-class writes (kill/freeze)
//   - operations-manager    : write everything + governance toggles
//   - sre-lead              : write incidents/changes; not governance
//   - system                : autonomous worker default

export type ActionRisk = 'low' | 'medium' | 'high';
export type RolePolicyMode = 'auto' | 'propose' | 'notify' | 'monitor';
export type RolePolicyDecision = 'ALLOW' | 'REQUIRE_HITL' | 'DENY';

export interface RolePolicyGovernance {
  killSwitchEngaged?: boolean;
  changeFreezeActive?: boolean;
  /** Is this a write-class tool name? Filled by `inferActionRisk` if omitted. */
  writeClass?: boolean;
  /** Is this a change-class tool name? Filled by `inferActionRisk` if omitted. */
  changeClass?: boolean;
  /** Optional emergency override route — bypasses change-freeze for change-class. */
  emergencyChangeRoute?: boolean;
  /** Did the operator explicitly set `forceMode: 'auto'`? */
  forceModeAuto?: boolean;
}

export interface RolePolicyInputs {
  actor: string;
  roles: string[];
  toolName: string;
  /** Optional explicit override; otherwise inferred from toolName. */
  actionRisk?: ActionRisk;
  /** Optional explicit override; otherwise defaults to 'propose'. */
  mode?: RolePolicyMode;
  governance?: RolePolicyGovernance;
}

export interface RolePolicyResult {
  decision: RolePolicyDecision;
  reason: string;
  /** Roles that would have satisfied the action — surfaced to the operator. */
  requiredRoles: string[];
  /** The risk we ultimately evaluated against. */
  actionRisk: ActionRisk;
  /** Was the actor's role considered a match? */
  roleMatch: boolean;
  /** Was an autonomy/governance lever (kill, freeze, forceMode) involved? */
  leverEngaged?: 'kill-switch' | 'change-freeze' | 'force-mode-auto';
}

/** Maps tool-name patterns → risk level + required-role set. */
const TOOL_RISK_TABLE: Array<{
  match: RegExp;
  risk: ActionRisk;
  requiredRoles: string[];
  isChangeClass?: boolean;
  isWriteClass?: boolean;
}> = [
  // Governance levers — operations-manager + security-officer only.
  {
    match: /engage_kill_switch|disengage_kill_switch|governance\.(kill|freeze)/i,
    risk: 'high',
    requiredRoles: ['operations-manager', 'security-officer'],
    isWriteClass: true,
  },
  // Destructive ops.
  {
    match: /^delete_|^purge_|^drop_|^wipe_/i,
    risk: 'high',
    requiredRoles: ['operations-manager'],
    isWriteClass: true,
  },
  // Change-class tools.
  {
    match: /change_request|create_change|update_change|approve_change|schedule_change/i,
    risk: 'medium',
    requiredRoles: ['change-manager', 'operations-manager', 'sre-lead'],
    isChangeClass: true,
    isWriteClass: true,
  },
  // Problem-class tools.
  {
    match: /problem(_record)?|create_problem|update_problem/i,
    risk: 'medium',
    requiredRoles: ['problem-manager', 'operations-manager'],
    isWriteClass: true,
  },
  // Incident write-class tools.
  {
    match: /create_incident|update_incident|resolve_incident|close_incident|assign_incident|escalate_incident/i,
    risk: 'medium',
    requiredRoles: ['incident-responder', 'sre-lead', 'operations-manager'],
    isWriteClass: true,
  },
  // Notification class (medium because external comms).
  {
    match: /^send_(email|teams|chat)|post_message|notify_|alert_/i,
    risk: 'medium',
    requiredRoles: ['incident-responder', 'sre-lead', 'operations-manager'],
    isWriteClass: true,
  },
  // Reads — anything matching common read prefixes.
  {
    match: /^(get_|list_|search_|query_|fetch_|lookup_)|dashboard|briefing|metrics|status/i,
    risk: 'low',
    requiredRoles: [],
  },
];

const DEFAULT_RISK: ActionRisk = 'medium';
const SYSTEM_ROLE = 'system';

/**
 * Map a tool name + worker definition hint to an {actionRisk, requiredRoles}.
 * Pure — no env, no I/O. Centralizes the inference so all callers agree.
 */
export function inferActionRisk(
  toolName: string,
  hints: { blastRadius?: 'low' | 'medium' | 'high' } = {},
): { risk: ActionRisk; requiredRoles: string[]; writeClass: boolean; changeClass: boolean } {
  for (const row of TOOL_RISK_TABLE) {
    if (row.match.test(toolName)) {
      // Worker-level blast-radius can upgrade (never downgrade) the inferred risk.
      const upgraded =
        hints.blastRadius === 'high' && row.risk !== 'high'
          ? 'high'
          : hints.blastRadius === 'medium' && row.risk === 'low'
            ? 'medium'
            : row.risk;
      return {
        risk: upgraded,
        requiredRoles: [...row.requiredRoles],
        writeClass: !!row.isWriteClass,
        changeClass: !!row.isChangeClass,
      };
    }
  }
  // No match → default to medium for safety. Treat unknown tools as write-class
  // unless the name starts with a clear read prefix.
  const looksLikeRead = /^(get|list|read|search)_/i.test(toolName);
  return {
    risk: looksLikeRead ? 'low' : DEFAULT_RISK,
    requiredRoles: looksLikeRead ? [] : ['operations-manager'],
    writeClass: !looksLikeRead,
    changeClass: false,
  };
}

/**
 * Evaluate the live-role policy. Pure function — no I/O. Caller is responsible
 * for resolving live roles (live-role-resolver.ts) and reading current
 * governance state (governance.ts).
 */
export function evaluateRolePolicy(inputs: RolePolicyInputs): RolePolicyResult {
  const inferred = inferActionRisk(inputs.toolName);
  const actionRisk: ActionRisk = inputs.actionRisk ?? inferred.risk;
  const requiredRoles = inferred.requiredRoles;
  const governance = inputs.governance ?? {};
  const writeClass = governance.writeClass ?? inferred.writeClass;
  const changeClass = governance.changeClass ?? inferred.changeClass;
  const mode: RolePolicyMode = inputs.mode ?? 'propose';

  // System role always counts as matching for autonomous-only safe risks.
  const isSystem = inputs.roles.includes(SYSTEM_ROLE);
  const roleMatch =
    requiredRoles.length === 0 ||
    inputs.roles.some((r) => requiredRoles.includes(r)) ||
    // ops-manager is universal.
    inputs.roles.includes('operations-manager');

  // 1) Kill-switch on a write-class action → DENY.
  if (writeClass && governance.killSwitchEngaged) {
    return {
      decision: 'DENY',
      reason: `kill-switch engaged blocks write-class tool '${inputs.toolName}'`,
      requiredRoles,
      actionRisk,
      roleMatch,
      leverEngaged: 'kill-switch',
    };
  }

  // 2) Change-freeze on a change-class action.
  if (changeClass && governance.changeFreezeActive) {
    if (governance.emergencyChangeRoute && roleMatch) {
      return {
        decision: 'REQUIRE_HITL',
        reason: `change-freeze active — emergency route requires explicit approval for '${inputs.toolName}'`,
        requiredRoles,
        actionRisk,
        roleMatch,
        leverEngaged: 'change-freeze',
      };
    }
    return {
      decision: 'DENY',
      reason: `change-freeze active blocks change-class tool '${inputs.toolName}'`,
      requiredRoles,
      actionRisk,
      roleMatch,
      leverEngaged: 'change-freeze',
    };
  }

  // 3) forceMode='auto' against a high-risk action without role match → DENY.
  // (Same role-match check still applies; force-mode never bypasses authorization.)
  if (governance.forceModeAuto && actionRisk === 'high' && !roleMatch) {
    return {
      decision: 'DENY',
      reason: `force-mode auto rejected: actor lacks required role for high-risk '${inputs.toolName}'`,
      requiredRoles,
      actionRisk,
      roleMatch,
      leverEngaged: 'force-mode-auto',
    };
  }

  // 4) Low risk → ALLOW (reads etc).
  if (actionRisk === 'low') {
    return {
      decision: 'ALLOW',
      reason: `low-risk read-class action`,
      requiredRoles,
      actionRisk,
      roleMatch: true,
    };
  }

  // 5) High risk → always REQUIRE_HITL with match, DENY without.
  if (actionRisk === 'high') {
    if (!roleMatch) {
      return {
        decision: 'DENY',
        reason: `high-risk '${inputs.toolName}' requires one of: ${requiredRoles.join(', ') || '(operations-manager)'}; actor has [${inputs.roles.join(', ') || 'none'}]`,
        requiredRoles,
        actionRisk,
        roleMatch,
      };
    }
    return {
      decision: 'REQUIRE_HITL',
      reason: `high-risk '${inputs.toolName}' — role match but always requires confirmation`,
      requiredRoles,
      actionRisk,
      roleMatch,
    };
  }

  // 6) Medium risk:
  //    - match + mode=auto       → ALLOW
  //    - match + mode!=auto      → REQUIRE_HITL
  //    - mismatch + system actor → REQUIRE_HITL (autonomous needs a human)
  //    - mismatch                → REQUIRE_HITL
  if (roleMatch) {
    if (mode === 'auto') {
      return {
        decision: 'ALLOW',
        reason: `medium-risk auto-allowed (role match, mode=auto)`,
        requiredRoles,
        actionRisk,
        roleMatch,
      };
    }
    return {
      decision: 'REQUIRE_HITL',
      reason: `medium-risk action (mode=${mode}) — confirm before running`,
      requiredRoles,
      actionRisk,
      roleMatch,
    };
  }

  // Mismatch on medium risk: always HITL (never silently deny — operator wants
  // to see the proposed action and decide).
  return {
    decision: 'REQUIRE_HITL',
    reason: `medium-risk '${inputs.toolName}' — actor lacks required role, needs approval${isSystem ? ' (autonomous actor)' : ''}`,
    requiredRoles,
    actionRisk,
    roleMatch,
  };
}

export const POLICY_VERSION = '2026.05.15-p3-v1';
