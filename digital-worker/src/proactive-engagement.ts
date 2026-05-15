// ITSM Operations — Proactive Engagement (Phase 4)
//
// Closes the "Alex is talking about what it's doing vs. just doing it" gap.
// When Alex picks up a scenario, completes a write, hits a high-risk HITL,
// fails an outcome, or wraps a scenario, this module proactively reaches
// the operator via Teams 1:1 chat (Bot Framework proactive messaging) and,
// for high-severity events, places an outbound Teams call via ACS.
//
// Reuses:
//   - `agentApplication.adapter` + `getConversationReferences()` from agent.ts
//   - `initiateOutboundTeamsCall` from voice/acsBridge.ts
//
// Adds:
//   - 10-minute in-memory dedupe keyed on {kind, scenarioId, ctxKey}
//   - Env-driven gate `PROACTIVE_ENGAGEMENT_ENABLED=true` (default off so
//     existing deployments don't change behavior)

import type { Attachment, ConversationReference } from '@microsoft/agents-activity';
import { Activity } from '@microsoft/agents-activity';
import type { TurnContext } from '@microsoft/agents-hosting';
import { agentApplication, getConversationReferences } from './agent';
import { initiateOutboundTeamsCall } from './voice/acsBridge';
import { createHitlApprovalCard } from './adaptive-cards';

export type EngagementKind =
  | 'scenario-started'
  | 'first-write-complete'
  | 'high-risk-hitl'
  | 'outcome-failure'
  | 'scenario-complete';

export type EngagementSeverity = 'info' | 'medium' | 'high';

export interface EngagementContext {
  scenarioId?: string;
  workerId?: string;
  signalId?: string;
  toolName?: string;
  snowTable?: 'incident' | 'change_request' | 'problem';
  snowSysId?: string;
  outcomeLabel?: 'success' | 'partial' | 'inconclusive' | 'failure';
  /** Free-form summary text — used for the Teams message body. */
  summary?: string;
  /** Override severity. Default by kind. */
  severity?: EngagementSeverity;
  /** Optional explicit dedupe key extension. */
  ctxKey?: string;
  // ── HITL extras (used to build the Teams Adaptive Card for
  //    'high-risk-hitl'). All optional — when absent the card renders
  //    with only the fields we do know.
  actor?: string;
  actorRoles?: string[];
  requiredRoles?: string[];
  decision?: string;
  riskClass?: string;
  executionId?: string;
  actionId?: string;
  reason?: string;
}

export interface EngagementResult {
  kind: EngagementKind;
  severity: EngagementSeverity;
  delivered: string[];
  skipped?: 'deduped' | 'disabled' | 'no-recipient';
  errors?: Record<string, string>;
}

const DEFAULT_SEVERITY: Record<EngagementKind, EngagementSeverity> = {
  'scenario-started': 'info',
  'first-write-complete': 'medium',
  'high-risk-hitl': 'high',
  'outcome-failure': 'high',
  'scenario-complete': 'medium',
};

const DEDUPE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const recentEngagements = new Map<string, number>();

function dedupeKey(kind: EngagementKind, ctx: EngagementContext): string {
  return `${kind}:${ctx.scenarioId || ''}:${ctx.signalId || ''}:${ctx.snowSysId || ''}:${ctx.ctxKey || ''}`;
}

function isDuplicate(key: string): boolean {
  const seen = recentEngagements.get(key);
  if (!seen) return false;
  if (Date.now() - seen > DEDUPE_WINDOW_MS) {
    recentEngagements.delete(key);
    return false;
  }
  return true;
}

function markEngaged(key: string): void {
  // Prune occasionally so the map doesn't grow without bound.
  if (recentEngagements.size > 500) {
    const cutoff = Date.now() - DEDUPE_WINDOW_MS;
    for (const [k, ts] of recentEngagements.entries()) {
      if (ts < cutoff) recentEngagements.delete(k);
    }
  }
  recentEngagements.set(key, Date.now());
}

function isEnabled(): boolean {
  const flag = String(process.env.PROACTIVE_ENGAGEMENT_ENABLED || '').toLowerCase();
  return flag === 'true' || flag === '1' || flag === 'yes';
}

function buildMessage(kind: EngagementKind, ctx: EngagementContext): string {
  if (ctx.summary) return ctx.summary;
  switch (kind) {
    case 'scenario-started':
      return `🎬 Picked up scenario **${ctx.scenarioId || 'unknown'}** — watching signals and starting the cycle.`;
    case 'first-write-complete': {
      const link = ctx.snowSysId
        ? ` ([${ctx.snowTable || 'record'}](sysid:${ctx.snowSysId}))`
        : '';
      return `✍️ First write completed for scenario **${ctx.scenarioId || 'current'}**${link}.`;
    }
    case 'high-risk-hitl': {
      // Phase 3.7 — make the HITL ask concrete. Previously this message just
      // said "Check the Mission Control approval queue" with no link, which
      // is why the operator saw a "Cycle blocked" feed entry but never got
      // anything actionable. Now we surface Approve / Deny / Open queue
      // links so they can act in one tap from Teams or email.
      const tool = ctx.toolName || 'unknown action';
      const scenario = ctx.scenarioId || 'autonomous workday';
      const host = (process.env.PUBLIC_HOSTNAME || '').replace(/\/$/, '');
      const queueUrl = host ? `https://${host}/mission-control.html#approvals` : '';
      const approveUrl = host && ctx.signalId
        ? `https://${host}/api/approvals/callback?action=approve&signal=${encodeURIComponent(ctx.signalId)}`
        : '';
      const denyUrl = host && ctx.signalId
        ? `https://${host}/api/approvals/callback?action=deny&signal=${encodeURIComponent(ctx.signalId)}`
        : '';
      const cta: string[] = [];
      if (approveUrl) cta.push(`[✅ Approve](${approveUrl})`);
      if (denyUrl) cta.push(`[🚫 Deny](${denyUrl})`);
      if (queueUrl) cta.push(`[🧭 Open queue](${queueUrl})`);
      const ctaLine = cta.length > 0 ? `\n\n${cta.join(' · ')}` : '';
      return `🛑 **Human approval needed** — Alex paused **${tool}** on **${scenario}** because it crossed the Pattern 3 risk gate. You'll see "Cycle blocked by Pattern 3 gate" in the Live Ops Feed — that's me waiting on you.${ctaLine}`;
    }
    case 'outcome-failure':
      return `⚠️ Outcome **${ctx.outcomeLabel || 'failure'}** on scenario **${ctx.scenarioId || 'current'}** (tool: ${ctx.toolName || 'unknown'}). Calling now.`;
    case 'scenario-complete':
      return `✅ Scenario **${ctx.scenarioId || 'current'}** complete. See the Mission Control Kanban for the wrap.`;
    default:
      return `Alex engagement: ${kind}`;
  }
}

/**
 * Post a proactive Teams 1:1 message to every captured conversation reference.
 *
 * Optional `attachments` lets callers ship an Adaptive Card alongside (or
 * instead of) the plain text. Used by 'high-risk-hitl' to send the
 * approve/deny card.
 *
 * In practice the deployed bot only has a couple of refs (Alex × the operator).
 * Returns the number of refs we successfully posted to.
 */
async function postProactiveTeamsMessage(
  message: string,
  attachments?: Attachment[],
): Promise<{ posted: number; errors: string[] }> {
  const errors: string[] = [];
  const refs = getConversationReferences();
  if (refs.size === 0) {
    return { posted: 0, errors: ['no captured conversation references'] };
  }
  const adapter = agentApplication.adapter;
  let posted = 0;
  for (const [, ref] of refs.entries()) {
    try {
      // The captured ref is a partial — reconstruct the shape `continueConversation`
      // expects. The Agent 365 SDK `CloudAdapter.continueConversation` accepts
      // a partial ConversationReference + a logic callback receiving a TurnContext.
      await (adapter as unknown as {
        continueConversation: (
          ref: Partial<ConversationReference>,
          logic: (context: TurnContext) => Promise<void>,
        ) => Promise<void>;
      }).continueConversation(
        ref as Partial<ConversationReference>,
        async (context: TurnContext) => {
          if (attachments && attachments.length > 0) {
            const activity = Activity.fromObject({
              type: 'message',
              text: message,
              attachments,
            });
            await context.sendActivity(activity);
          } else {
            await context.sendActivity(message);
          }
        },
      );
      posted += 1;
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  return { posted, errors };
}

/**
 * Build the HITL approve/deny attachment from an engagement context.
 * Exposed so exception-reporter can also embed it in email (future).
 */
function buildHitlAttachment(ctx: EngagementContext): Attachment {
  const host = (process.env.PUBLIC_HOSTNAME || '').replace(/\/$/, '');
  const missionControlUrl = host ? `https://${host}/mission-control.html#approvals` : undefined;
  return createHitlApprovalCard({
    actionId: ctx.actionId || ctx.ctxKey,
    signalId: ctx.signalId,
    executionId: ctx.executionId,
    toolName: ctx.toolName,
    scenarioId: ctx.scenarioId,
    actor: ctx.actor,
    actorRoles: ctx.actorRoles,
    requiredRoles: ctx.requiredRoles,
    decision: ctx.decision,
    riskClass: ctx.riskClass,
    reason: ctx.reason || ctx.summary,
    missionControlUrl,
  });
}

/**
 * Place an outbound ACS Teams call to the configured manager.
 *
 * No-op when `MANAGER_TEAMS_OID` is not set.
 */
async function callOperator(kind: EngagementKind, ctx: EngagementContext): Promise<{ called: boolean; error?: string }> {
  const teamsOid = process.env.MANAGER_TEAMS_OID || '';
  if (!teamsOid) return { called: false, error: 'MANAGER_TEAMS_OID not configured' };
  try {
    const reason = `${kind}: ${ctx.scenarioId ? `scenario ${ctx.scenarioId} — ` : ''}${buildMessage(kind, ctx).replace(/\*\*/g, '')}`;
    await initiateOutboundTeamsCall({
      teamsUserAadOid: teamsOid,
      reason,
      requestedBy: 'Alex (proactive)',
      snowTable: ctx.snowTable,
      snowSysId: ctx.snowSysId,
    });
    return { called: true };
  } catch (err) {
    return { called: false, error: (err as Error).message };
  }
}

/**
 * Fire a proactive engagement to the operator. Honors the dedupe window and the
 * `PROACTIVE_ENGAGEMENT_ENABLED` env flag. High-severity events also place an
 * ACS call (if `MANAGER_TEAMS_OID` is set).
 */
export async function engageOperator(
  kind: EngagementKind,
  ctx: EngagementContext = {},
): Promise<EngagementResult> {
  const severity: EngagementSeverity = ctx.severity || DEFAULT_SEVERITY[kind];

  if (!isEnabled()) {
    return { kind, severity, delivered: [], skipped: 'disabled' };
  }

  const key = dedupeKey(kind, ctx);
  if (isDuplicate(key)) {
    return { kind, severity, delivered: [], skipped: 'deduped' };
  }
  markEngaged(key);

  const delivered: string[] = [];
  const errors: Record<string, string> = {};

  // 1) Teams 1:1 chat (best-effort). For 'high-risk-hitl' we attach an
  //    Adaptive Card with Approve / Deny buttons so the operator can
  //    act in one tap — no need to open Mission Control.
  try {
    const message = buildMessage(kind, ctx);
    const attachments: Attachment[] = kind === 'high-risk-hitl'
      ? [buildHitlAttachment(ctx)]
      : [];
    const r = await postProactiveTeamsMessage(
      message,
      attachments.length > 0 ? attachments : undefined,
    );
    if (r.posted > 0) {
      delivered.push(attachments.length > 0 ? 'teams-card' : 'teams-chat');
    }
    if (r.errors.length > 0) errors['teams-chat'] = r.errors.join('; ');
  } catch (err) {
    errors['teams-chat'] = (err as Error).message;
  }

  // 2) ACS outbound call for high-severity events only.
  if (severity === 'high') {
    const r = await callOperator(kind, ctx);
    if (r.called) delivered.push('acs-call');
    else if (r.error) errors['acs-call'] = r.error;
  }

  // If we delivered nothing and have no captured refs and no MANAGER_TEAMS_OID,
  // surface it so callers can fall back to email.
  if (delivered.length === 0 && Object.keys(errors).length === 0) {
    return { kind, severity, delivered, skipped: 'no-recipient' };
  }

  return {
    kind,
    severity,
    delivered,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  };
}

/**
 * Test helper — clear the dedupe map. Not exported in the index module path
 * but called from `__tests__/proactive-engagement.test.ts`.
 */
export function _resetEngagementDedupe(): void {
  recentEngagements.clear();
}
