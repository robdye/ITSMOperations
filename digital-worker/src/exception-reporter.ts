// ITSM Operations — Exception Reporter (Pattern 3)
//
// Centralized, deduped exception notification. Wires the existing
// `proactive-engagement` channel (Teams 1:1 + ACS) to a fixed set of triggers
// so callers can't accidentally double-notify the operator. Dedupe is 5 min
// keyed on `{kind, actor, actionKey}`.
//
// Triggers (per plan):
//   1. DENY                                                                   → severity=critical
//   2. REQUIRE_HITL + actionRisk='high'                                        → severity=high
//   3. kill-switch engaged + write-class attempted                             → severity=high
//   4. change-freeze active + change-class attempted                           → severity=medium
//   5. {workflowId, actionKey} failed ≥3 times / 30 min (meta-monitor counter) → severity=high
//   6. forceMode='auto' overrode policy for actionRisk='high'                  → severity=high
//   7. Explicit "status/report" intent                                          → severity=info

import { engageOperator } from './proactive-engagement';
import type { RolePolicyDecision, ActionRisk } from './role-policy';
import { sendEmail as sendGraphMail } from './graph-mail';
import { renderBriefingEmail } from './email-render';

export type ExceptionKind =
  | 'gate-deny'
  | 'high-risk-hitl'
  | 'kill-switch-blocked'
  | 'change-freeze-blocked'
  | 'retry-exhaustion'
  | 'force-mode-override'
  | 'status-digest';

export type ExceptionSeverity = 'critical' | 'high' | 'medium' | 'info';

export interface ExceptionContext {
  actor: string;
  actorRoles?: string[];
  workerId?: string;
  workflowId?: string;
  toolName?: string;
  /** Lowercase identifier of the action for dedupe (defaults to toolName). */
  actionKey?: string;
  scenarioId?: string;
  signalId?: string;
  executionId?: string;
  snowTable?: 'incident' | 'change_request' | 'problem';
  snowSysId?: string;
  /** Free-form details for the Teams message. */
  detail?: string;
  /** Pass-through gate fields when relevant. */
  gateDecision?: RolePolicyDecision;
  actionRisk?: ActionRisk;
  requiredRoles?: string[];
}

const DEFAULT_SEVERITY: Record<ExceptionKind, ExceptionSeverity> = {
  'gate-deny': 'critical',
  'high-risk-hitl': 'high',
  'kill-switch-blocked': 'high',
  'change-freeze-blocked': 'medium',
  'retry-exhaustion': 'high',
  'force-mode-override': 'high',
  'status-digest': 'info',
};

const DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const recentNotices = new Map<string, number>();

// Retry counters for trigger #5 (meta-monitor) — keyed on `${workflowId}::${actionKey}`.
const retryCounters = new Map<string, number[]>();
const RETRY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const RETRY_THRESHOLD = 3;

function dedupeKey(kind: ExceptionKind, ctx: ExceptionContext): string {
  const action = ctx.actionKey || ctx.toolName || ctx.workflowId || 'unknown';
  return `${kind}:${ctx.actor}:${action}`;
}

function isDuplicate(key: string): boolean {
  const seen = recentNotices.get(key);
  if (!seen) return false;
  if (Date.now() - seen > DEDUPE_WINDOW_MS) {
    recentNotices.delete(key);
    return false;
  }
  return true;
}

function markNoticed(key: string): void {
  if (recentNotices.size > 500) {
    const cutoff = Date.now() - DEDUPE_WINDOW_MS;
    for (const [k, ts] of recentNotices.entries()) {
      if (ts < cutoff) recentNotices.delete(k);
    }
  }
  recentNotices.set(key, Date.now());
}

function buildSummary(kind: ExceptionKind, ctx: ExceptionContext): string {
  const who = ctx.actor || 'system';
  const what = ctx.toolName || ctx.workflowId || ctx.actionKey || 'action';
  const detail = ctx.detail ? ` — ${ctx.detail}` : '';
  switch (kind) {
    case 'gate-deny':
      return `🛑 DENY for **${who}** on **${what}**${detail}. Roles=[${(ctx.actorRoles || []).join(', ')}]; required=[${(ctx.requiredRoles || []).join(', ')}]`;
    case 'high-risk-hitl':
      return `⚠️ High-risk action **${what}** for **${who}** needs human approval${detail}.`;
    case 'kill-switch-blocked':
      return `🛑 Kill-switch engaged — blocked write-class **${what}** from **${who}**${detail}.`;
    case 'change-freeze-blocked':
      return `❄️ Change-freeze active — blocked **${what}** from **${who}**${detail}.`;
    case 'retry-exhaustion':
      return `♻️ Retry exhaustion on **${ctx.workflowId || what}** (${ctx.actionKey || what}) — ≥${RETRY_THRESHOLD} failures in 30 min${detail}.`;
    case 'force-mode-override':
      return `⚡ forceMode=auto override on high-risk **${what}** by **${who}**${detail}.`;
    case 'status-digest':
      return `📋 Status digest requested by **${who}**${detail}.`;
  }
}

/**
 * Map our exception kind to the proactive-engagement kind so the Teams + ACS
 * channel is shared. We never call the existing engagement triggers directly.
 */
function engagementKindFor(kind: ExceptionKind): 'high-risk-hitl' | 'outcome-failure' | 'scenario-started' {
  switch (kind) {
    case 'gate-deny':
    case 'kill-switch-blocked':
    case 'retry-exhaustion':
    case 'force-mode-override':
      return 'outcome-failure'; // routes to ACS for severity=high
    case 'high-risk-hitl':
    case 'change-freeze-blocked':
      return 'high-risk-hitl';
    case 'status-digest':
      return 'scenario-started';
  }
}

export interface ExceptionResult {
  kind: ExceptionKind;
  severity: ExceptionSeverity;
  notified: boolean;
  skipped?: 'deduped' | 'disabled';
}

/**
 * Notify the operator about an exception. Honors a 5-min dedupe window so the
 * same `{kind, actor, action}` won't page twice. Best-effort; never throws.
 */
export async function notifyManagerOnException(
  kind: ExceptionKind,
  ctx: ExceptionContext,
): Promise<ExceptionResult> {
  const severity = DEFAULT_SEVERITY[kind];
  const key = dedupeKey(kind, ctx);
  if (isDuplicate(key)) {
    return { kind, severity, notified: false, skipped: 'deduped' };
  }
  markNoticed(key);

  const engagementKind = engagementKindFor(kind);
  const summary = buildSummary(kind, ctx);
  try {
    const r = await engageOperator(engagementKind, {
      scenarioId: ctx.scenarioId,
      workerId: ctx.workerId,
      signalId: ctx.signalId,
      toolName: ctx.toolName,
      snowTable: ctx.snowTable,
      snowSysId: ctx.snowSysId,
      summary,
      severity: severity === 'critical' ? 'high' : severity === 'info' ? 'info' : severity,
      ctxKey: `${kind}:${ctx.actionKey || ctx.toolName || ctx.workflowId || 'unknown'}`,
      // \u2500\u2500 HITL extras \u2014 feed the Adaptive Card builder so the
      //    Teams card surfaces full context (actor / roles / risk class).
      actor: ctx.actor,
      actorRoles: ctx.actorRoles,
      requiredRoles: ctx.requiredRoles,
      decision: ctx.gateDecision,
      riskClass: ctx.actionRisk,
      executionId: ctx.executionId,
      reason: ctx.detail,
    });
    const notified = r.delivered.length > 0;

    // Phase 3.7 — Email floor for critical / high exceptions. The Teams
    // 1:1 channel only fires when (a) PROACTIVE_ENGAGEMENT_ENABLED=true
    // AND (b) we have a captured conversation reference for the operator.
    // Either condition can be false on a fresh container, leaving the user
    // staring at a "Cycle blocked" entry in the feed with no way to act.
    // Always send a styled email for critical/high HITL events so the
    // operator can approve/deny without depending on the bot channel.
    const isHighStakes = severity === 'critical' || severity === 'high';
    const needsApproval = kind === 'high-risk-hitl' || kind === 'gate-deny';
    if (isHighStakes && needsApproval) {
      try {
        await sendApprovalEmail(kind, ctx, severity);
      } catch (err) {
        console.warn('[ExceptionReporter] approval email failed:', (err as Error)?.message);
      }
    }

    return { kind, severity, notified };
  } catch (err) {
    console.warn('[ExceptionReporter] engageOperator failed:', (err as Error)?.message);
    return { kind, severity, notified: false };
  }
}

/**
 * Send a styled approval-request email to MANAGER_EMAIL with explicit
 * Approve / Deny / Open-queue links. This is the deterministic floor so the
 * operator is always paged for high-stakes HITL events even when Teams 1:1
 * or ACS engagement isn't reachable.
 */
async function sendApprovalEmail(
  kind: ExceptionKind,
  ctx: ExceptionContext,
  severity: ExceptionSeverity,
): Promise<void> {
  const to = process.env.MANAGER_EMAIL || process.env.OWNER_EMAIL || '';
  if (!to) return;
  const host = (process.env.PUBLIC_HOSTNAME || '').replace(/\/$/, '');
  const tool = ctx.toolName || ctx.actionKey || ctx.workflowId || 'an action';
  const actor = ctx.actor || 'autonomous worker';
  const reason = ctx.detail || 'Pattern 3 governance gate required human review.';
  const risk = ctx.actionRisk || 'high';
  const decision = ctx.gateDecision || 'REQUIRE_HITL';
  const roles = (ctx.actorRoles || []).join(', ') || 'unknown';
  const required = (ctx.requiredRoles || []).join(', ') || 'n/a';
  const queueUrl = host ? `https://${host}/mission-control.html#approvals` : '';
  // The approve/deny links target the GET /api/approvals/action endpoint so
  // a single tap from the email resolves the queued action (or records the
  // decision for audit if the action has already drained). We prefer
  // `actionKey` (queue id) over `signalId` because the queue path keys on
  // actionKey; `signalId` is a fallback for non-queue-backed HITL events.
  const decisionId = ctx.actionKey || ctx.toolName || ctx.signalId || '';
  const approveUrl = host && decisionId
    ? `https://${host}/api/approvals/action?id=${encodeURIComponent(decisionId)}&decision=approved&by=${encodeURIComponent(ctx.actor || 'email-approver')}`
    : '';
  const denyUrl = host && decisionId
    ? `https://${host}/api/approvals/action?id=${encodeURIComponent(decisionId)}&decision=rejected&by=${encodeURIComponent(ctx.actor || 'email-approver')}`
    : '';
  const title = kind === 'gate-deny' ? 'Action denied — please review' : 'Human approval required';
  const accent = kind === 'gate-deny' ? '#a4262c' : '#8764b8';
  const ctaBtn = (url: string, label: string, bg: string): string => `<a href="${url}" style="display:inline-block;background:${bg};color:#fff;padding:9px 18px;border-radius:5px;text-decoration:none;font-weight:600;margin-right:8px;">${label}</a>`;
  const buttons = [
    approveUrl ? ctaBtn(approveUrl, '✅ Approve', '#107c10') : '',
    denyUrl ? ctaBtn(denyUrl, '🚫 Deny', '#a4262c') : '',
    queueUrl ? ctaBtn(queueUrl, '🧭 Open queue', '#0078d4') : '',
  ].filter(Boolean).join('');
  const buttonsBlock = buttons
    ? `\n\n<div style="margin:12px 0 4px;">${buttons}</div>`
    : '';

  const md = `### ${escapeMd(reason)}

- **Decision:** ${decision}
- **Action:** \`${escapeMd(tool)}\`
- **Risk class:** ${risk}
- **Requested by:** ${escapeMd(actor)}
- **Caller roles:** ${escapeMd(roles)}
- **Required roles:** ${escapeMd(required)}
${ctx.signalId ? `- **Signal id:** \`${escapeMd(ctx.signalId)}\`` : ''}
${ctx.executionId ? `- **Execution id:** \`${escapeMd(ctx.executionId)}\`` : ''}

> Alex paused the cycle and is waiting on you. Approving runs the next planned step against the live tenant; denying records the rejection in the evidence pack and keeps the change paused.${buttonsBlock}`;

  const html = renderBriefingEmail({
    title,
    subtitle: `${decision} · severity ${severity}`,
    emoji: '🛑',
    accent,
    markdown: md,
    footerNote: ctx.executionId ? `Evidence id: ${ctx.executionId}` : undefined,
  });

  await sendGraphMail({
    to: [to],
    subject: `[Approval Required] ${tool} — ${decision}`,
    body: html,
    isHtml: true,
    importance: 'high',
  });
}

function escapeMd(s: string): string {
  // Light escaping for markdown — prevent stray `_` or `*` in IDs from
  // breaking emphasis runs in the rendered email.
  return String(s).replace(/([*_`\[\]\\])/g, '\\$1');
}

/**
 * Record a failure for the meta-monitor (trigger #5) and notify when the
 * threshold is crossed within the rolling window.
 */
export async function recordFailure(
  workflowId: string,
  actionKey: string,
  ctx: Omit<ExceptionContext, 'workflowId' | 'actionKey'>,
): Promise<{ count: number; notified: boolean }> {
  const key = `${workflowId}::${actionKey}`;
  const now = Date.now();
  const cutoff = now - RETRY_WINDOW_MS;
  const list = (retryCounters.get(key) || []).filter((t) => t >= cutoff);
  list.push(now);
  retryCounters.set(key, list);
  if (list.length >= RETRY_THRESHOLD) {
    const r = await notifyManagerOnException('retry-exhaustion', {
      ...ctx,
      workflowId,
      actionKey,
    });
    // Reset after notifying so we don't spam if it keeps failing.
    retryCounters.set(key, []);
    return { count: list.length, notified: r.notified };
  }
  return { count: list.length, notified: false };
}

/** Test helper. */
export function _resetExceptionReporter(): void {
  recentNotices.clear();
  retryCounters.clear();
}
