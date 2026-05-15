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

import type { ConversationReference } from '@microsoft/agents-activity';
import type { TurnContext } from '@microsoft/agents-hosting';
import { agentApplication, getConversationReferences } from './agent';
import { initiateOutboundTeamsCall } from './voice/acsBridge';

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
    case 'high-risk-hitl':
      return `🛑 High-risk action needs your approval: **${ctx.toolName || 'unknown tool'}** on scenario **${ctx.scenarioId || 'current'}**. Check the Mission Control approval queue.`;
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
 * In practice the deployed bot only has a couple of refs (Alex × the operator).
 * Returns the number of refs we successfully posted to.
 */
async function postProactiveTeamsMessage(message: string): Promise<{ posted: number; errors: string[] }> {
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
          await context.sendActivity(message);
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

  // 1) Teams 1:1 chat (best-effort).
  try {
    const message = buildMessage(kind, ctx);
    const r = await postProactiveTeamsMessage(message);
    if (r.posted > 0) delivered.push('teams-chat');
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
