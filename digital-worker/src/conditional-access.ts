/**
 * Conditional Access — Application-level policy enforcement for ITSM agent actions.
 * Implements CA-style checks within the digital worker to gate high-risk operations.
 * These are application-level policies, not Entra CA policies (which require portal config).
 */

import { classifyTool, formatConfirmationRequest } from './hitl';

// ── Types ──

export interface ActionContext {
  userId: string;
  userPrincipalName: string;
  deviceCompliant: boolean;
  mfaCompleted: boolean;
  tenantId: string;
  homeTenantId: string;
  ipAddress?: string;
  timestamp: Date;
  workerAction: string;
  riskLevel?: 'low' | 'medium' | 'high';
}

export interface PolicyResult {
  allowed: boolean;
  policyName: string;
  reason: string;
  requiredAction?: 'mfa_stepup' | 'approval_required' | 'blocked';
  hitlPrompt?: string;
}

export interface ChangeWindow {
  dayOfWeek: number; // 0=Sunday, 6=Saturday
  startHour: number; // 0-23 UTC
  endHour: number;   // 0-23 UTC
}

export interface ConditionalAccessPolicy {
  name: string;
  description: string;
  enabled: boolean;
  evaluate: (ctx: ActionContext) => PolicyResult;
}

// ── Configuration ──

/** Allowed change windows (default: Tue-Thu 02:00-06:00 UTC, Sat 04:00-08:00 UTC) */
const DEFAULT_CHANGE_WINDOWS: ChangeWindow[] = [
  { dayOfWeek: 2, startHour: 2, endHour: 6 },  // Tuesday
  { dayOfWeek: 3, startHour: 2, endHour: 6 },  // Wednesday
  { dayOfWeek: 4, startHour: 2, endHour: 6 },  // Thursday
  { dayOfWeek: 6, startHour: 4, endHour: 8 },  // Saturday
];

const CHANGE_WINDOWS: ChangeWindow[] = parseChangeWindows() || DEFAULT_CHANGE_WINDOWS;

/** Actions that are considered Change Manager operations */
const CHANGE_MANAGER_ACTIONS = [
  'approve_change', 'implement_change', 'close_change',
  'create_change', 'update_change', 'schedule_change',
  'rollback_change', 'promote_change',
];

/** Actions that require MFA step-up (Computer Use / high-impact) */
const MFA_REQUIRED_ACTIONS = [
  'computer_use', 'browser_action', 'remote_desktop',
  'execute_script', 'run_command', 'deploy_config',
  'modify_firewall', 'update_dns', 'restart_service',
];

/** Actions blocked from non-compliant devices */
const COMPLIANCE_REQUIRED_ACTIONS = [
  'create_change', 'approve_change', 'implement_change',
  'update_incident', 'close_incident', 'assign_incident',
  'create_problem', 'send_email', 'post_message',
  'computer_use', 'execute_script',
];

/** Actions requiring approval for cross-tenant operations */
const CROSS_TENANT_ACTIONS = [
  'create_change', 'update_change', 'create_incident',
  'update_incident', 'send_email', 'assign_incident',
  'execute_script', 'computer_use', 'deploy_config',
];

// ── Policy Definitions ──

/** Block Change Manager actions outside defined change windows */
const changeWindowPolicy: ConditionalAccessPolicy = {
  name: 'BlockOutsideChangeWindows',
  description: 'Prevents Change Manager actions outside approved maintenance windows.',
  enabled: true,
  evaluate: (ctx: ActionContext): PolicyResult => {
    const action = ctx.workerAction.toLowerCase();
    if (!CHANGE_MANAGER_ACTIONS.some((a) => action.includes(a))) {
      return { allowed: true, policyName: 'BlockOutsideChangeWindows', reason: 'Action is not a change management operation.' };
    }

    const now = ctx.timestamp;
    const dayOfWeek = now.getUTCDay();
    const hour = now.getUTCHours();

    const inWindow = CHANGE_WINDOWS.some(
      (w) => w.dayOfWeek === dayOfWeek && hour >= w.startHour && hour < w.endHour,
    );

    if (inWindow) {
      return { allowed: true, policyName: 'BlockOutsideChangeWindows', reason: 'Within approved change window.' };
    }

    const windowDesc = CHANGE_WINDOWS
      .map((w) => `${dayName(w.dayOfWeek)} ${w.startHour}:00-${w.endHour}:00 UTC`)
      .join(', ');

    return {
      allowed: false,
      policyName: 'BlockOutsideChangeWindows',
      reason: `Change management action '${ctx.workerAction}' is blocked outside approved windows. Allowed: ${windowDesc}`,
      requiredAction: 'blocked',
    };
  },
};

/** Require MFA step-up for Computer Use agent actions */
const mfaStepUpPolicy: ConditionalAccessPolicy = {
  name: 'RequireMFAForComputerUse',
  description: 'Requires MFA step-up verification before executing Computer Use or high-impact agent actions.',
  enabled: true,
  evaluate: (ctx: ActionContext): PolicyResult => {
    const action = ctx.workerAction.toLowerCase();
    if (!MFA_REQUIRED_ACTIONS.some((a) => action.includes(a))) {
      return { allowed: true, policyName: 'RequireMFAForComputerUse', reason: 'Action does not require MFA step-up.' };
    }

    if (ctx.mfaCompleted) {
      return { allowed: true, policyName: 'RequireMFAForComputerUse', reason: 'MFA step-up already completed.' };
    }

    const toolClassification = classifyTool(ctx.workerAction);
    const hitlPrompt = formatConfirmationRequest(
      ctx.workerAction,
      { ...toolClassification, description: `🔐 MFA Step-Up Required: ${toolClassification.description}` },
      { action: ctx.workerAction, user: ctx.userPrincipalName },
    );

    return {
      allowed: false,
      policyName: 'RequireMFAForComputerUse',
      reason: `Action '${ctx.workerAction}' requires MFA step-up. User must re-authenticate.`,
      requiredAction: 'mfa_stepup',
      hitlPrompt,
    };
  },
};

/** Block high-risk actions from non-compliant devices */
const deviceCompliancePolicy: ConditionalAccessPolicy = {
  name: 'BlockNonCompliantDevices',
  description: 'Blocks write and notify actions from devices that are not marked compliant in Intune/Entra.',
  enabled: true,
  evaluate: (ctx: ActionContext): PolicyResult => {
    const action = ctx.workerAction.toLowerCase();
    if (!COMPLIANCE_REQUIRED_ACTIONS.some((a) => action.includes(a))) {
      return { allowed: true, policyName: 'BlockNonCompliantDevices', reason: 'Action does not require device compliance.' };
    }

    if (ctx.deviceCompliant) {
      return { allowed: true, policyName: 'BlockNonCompliantDevices', reason: 'Device is compliant.' };
    }

    return {
      allowed: false,
      policyName: 'BlockNonCompliantDevices',
      reason: `Action '${ctx.workerAction}' is blocked because the originating device is not compliant. Ensure the device is enrolled and compliant in Intune.`,
      requiredAction: 'blocked',
    };
  },
};

/** Require approval for cross-tenant operations */
const crossTenantPolicy: ConditionalAccessPolicy = {
  name: 'RequireApprovalCrossTenant',
  description: 'Requires explicit HITL approval when an action targets a different tenant than the user\'s home tenant.',
  enabled: true,
  evaluate: (ctx: ActionContext): PolicyResult => {
    if (ctx.tenantId === ctx.homeTenantId) {
      return { allowed: true, policyName: 'RequireApprovalCrossTenant', reason: 'Same-tenant operation.' };
    }

    const action = ctx.workerAction.toLowerCase();
    if (!CROSS_TENANT_ACTIONS.some((a) => action.includes(a))) {
      return { allowed: true, policyName: 'RequireApprovalCrossTenant', reason: 'Action does not require cross-tenant approval.' };
    }

    const toolClassification = classifyTool(ctx.workerAction);
    const hitlPrompt = formatConfirmationRequest(
      ctx.workerAction,
      { ...toolClassification, description: `🌐 Cross-Tenant Operation: ${toolClassification.description}` },
      {
        action: ctx.workerAction,
        sourceTenant: ctx.homeTenantId,
        targetTenant: ctx.tenantId,
        user: ctx.userPrincipalName,
      },
    );

    return {
      allowed: false,
      policyName: 'RequireApprovalCrossTenant',
      reason: `Cross-tenant action '${ctx.workerAction}' requires explicit approval. Source: ${ctx.homeTenantId}, Target: ${ctx.tenantId}`,
      requiredAction: 'approval_required',
      hitlPrompt,
    };
  },
};

// ── Policy Registry ──

const ALL_POLICIES: ConditionalAccessPolicy[] = [
  changeWindowPolicy,
  mfaStepUpPolicy,
  deviceCompliancePolicy,
  crossTenantPolicy,
];

// ── Public API ──

/**
 * Evaluate all enabled CA policies against the given action context.
 * Returns the first policy violation, or an 'allowed' result if all pass.
 */
export function evaluatePolicies(ctx: ActionContext): PolicyResult {
  for (const policy of ALL_POLICIES) {
    if (!policy.enabled) continue;
    const result = policy.evaluate(ctx);
    if (!result.allowed) {
      console.log(`[ConditionalAccess] Policy '${policy.name}' BLOCKED action '${ctx.workerAction}' for user '${ctx.userPrincipalName}': ${result.reason}`);
      return result;
    }
  }

  return {
    allowed: true,
    policyName: 'none',
    reason: 'All conditional access policies passed.',
  };
}

/**
 * Quick check: can the current context execute this action?
 * Returns true if allowed, false if blocked.
 */
export function isActionAllowed(ctx: ActionContext): boolean {
  return evaluatePolicies(ctx).allowed;
}

/**
 * Get all registered policies and their enabled status.
 */
export function listPolicies(): Array<{ name: string; description: string; enabled: boolean }> {
  return ALL_POLICIES.map((p) => ({
    name: p.name,
    description: p.description,
    enabled: p.enabled,
  }));
}

/**
 * Check if a specific action is within a change window right now.
 */
export function isInChangeWindow(timestamp?: Date): boolean {
  const now = timestamp || new Date();
  const dayOfWeek = now.getUTCDay();
  const hour = now.getUTCHours();
  return CHANGE_WINDOWS.some(
    (w) => w.dayOfWeek === dayOfWeek && hour >= w.startHour && hour < w.endHour,
  );
}

/**
 * Get the next upcoming change window.
 */
export function getNextChangeWindow(): { dayOfWeek: string; startHour: number; endHour: number } | null {
  if (CHANGE_WINDOWS.length === 0) return null;
  const now = new Date();
  const currentDay = now.getUTCDay();
  const currentHour = now.getUTCHours();

  // Find the next window
  const sorted = [...CHANGE_WINDOWS].sort((a, b) => {
    const aDist = (a.dayOfWeek - currentDay + 7) % 7 || (a.startHour > currentHour ? 0 : 7);
    const bDist = (b.dayOfWeek - currentDay + 7) % 7 || (b.startHour > currentHour ? 0 : 7);
    return aDist - bDist;
  });

  const next = sorted[0];
  return {
    dayOfWeek: dayName(next.dayOfWeek),
    startHour: next.startHour,
    endHour: next.endHour,
  };
}

// ── Helpers ──

function dayName(day: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day] || 'Unknown';
}

function parseChangeWindows(): ChangeWindow[] | null {
  const env = process.env.ITSM_CHANGE_WINDOWS;
  if (!env) return null;
  try {
    const parsed = JSON.parse(env) as ChangeWindow[];
    if (Array.isArray(parsed) && parsed.every((w) => typeof w.dayOfWeek === 'number')) {
      return parsed;
    }
  } catch {
    console.warn('[ConditionalAccess] Failed to parse ITSM_CHANGE_WINDOWS, using defaults');
  }
  return null;
}
