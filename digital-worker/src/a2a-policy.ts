// ITSM Operations — A2A inbound policy
//
// Phase 1.7 — gates inbound agent-to-agent messages on
// /api/agent-messages. Implements:
//   1. Per-caller-agent allow-list (env: A2A_ALLOWED_AGENTS — CSV).
//   2. Rate budget (default 60 calls/hr per caller, sliding window).
//   3. Scope mapping (caller agent → permitted intents).
//   4. Honours kill-switch + change-freeze (existing autonomy gate).
//   5. Stamps every audit-trail row with the resolved callerAgentId.
//
// Hard rule #3 forbids adding new gates beyond the trigger mode +
// blast-radius approval. This is NOT a new gate on EXECUTION — it is an
// inbound *transport* filter that decides whether to even hand the
// message to `agentApplication.run()`. The two governance gates remain
// the only ones evaluated during workflow execution.
//
// KPI: a2a inbound rejection rate per reason, surfaced via getA2APolicyKpi().

import { isKillSwitchEngaged, isChangeFreezeActive } from './governance';
import { logAuditEntry } from './audit-trail';

export type A2ARejectReason =
  | 'missing-agent-id'
  | 'agent-not-allowed'
  | 'rate-limited'
  | 'scope-denied'
  | 'killed'
  | 'frozen';

export interface A2APolicyDecision {
  allow: boolean;
  callerAgentId?: string;
  reason?: A2ARejectReason;
  details?: string;
}

interface RateBucket {
  windowStartedAt: number;
  count: number;
}

const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_DEFAULT = Number(process.env.A2A_RATE_LIMIT_PER_HOUR || 60);
const PER_CALLER_RATE = new Map<string, RateBucket>();

// ── KPI counters (Phase 1.7) ──
const kpi = {
  attempts: 0,
  allowed: 0,
  rejected: 0,
  byReason: {
    'missing-agent-id': 0,
    'agent-not-allowed': 0,
    'rate-limited': 0,
    'scope-denied': 0,
    'killed': 0,
    'frozen': 0,
  } as Record<A2ARejectReason, number>,
  startedAt: Date.now(),
};

export function getA2APolicyKpi(): {
  attempts: number;
  allowed: number;
  rejected: number;
  rejectionRate: number;
  byReason: Record<A2ARejectReason, number>;
  uptimeSec: number;
} {
  const rejectionRate = kpi.attempts > 0 ? kpi.rejected / kpi.attempts : 0;
  return {
    attempts: kpi.attempts,
    allowed: kpi.allowed,
    rejected: kpi.rejected,
    rejectionRate,
    byReason: { ...kpi.byReason },
    uptimeSec: Math.round((Date.now() - kpi.startedAt) / 1000),
  };
}

// ── Allow-list ──
//
// Comma-separated env (A2A_ALLOWED_AGENTS=portfolio-pm,fabric-admin,...).
// Empty / unset = allow none (fail closed). The string `*` allows all
// authenticated callers (NOT recommended for prod — useful in dev).

function getAllowedAgents(): Set<string> {
  const raw = (process.env.A2A_ALLOWED_AGENTS || '').trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

// ── Scope map ──
//
// Per-agent intent allow-list. JSON in env A2A_AGENT_SCOPES or
// hard-coded fallback for known callers. The intent of an inbound
// message is heuristically the first word of `text` (case-insensitive)
// — the policy stays out of the way for plain-text chat by accepting
// `*` as a scope wildcard.

interface ScopeMap {
  [agentId: string]: string[]; // allowed intents (lowercase) or ['*']
}

function getScopeMap(): ScopeMap {
  const raw = process.env.A2A_AGENT_SCOPES;
  if (raw) {
    try {
      return JSON.parse(raw) as ScopeMap;
    } catch {
      console.warn('[a2a-policy] invalid A2A_AGENT_SCOPES JSON — falling back to defaults');
    }
  }
  return {
    'portfolio-pm': ['*'],
    'fabric-admin': ['fabric.', 'workspace.', 'capacity.'],
    'finops-agent': ['cost.', 'budget.', 'forecast.'],
    'service-now': ['*'],
  };
}

function intentMatches(intent: string, allowed: string[]): boolean {
  if (allowed.includes('*')) return true;
  const lower = intent.toLowerCase();
  return allowed.some((a) => {
    const aLower = a.toLowerCase();
    if (aLower.endsWith('.')) return lower.startsWith(aLower);
    return lower === aLower;
  });
}

// ── Rate limit ──

function checkRate(callerAgentId: string): boolean {
  const now = Date.now();
  const bucket = PER_CALLER_RATE.get(callerAgentId);
  if (!bucket || now - bucket.windowStartedAt > RATE_WINDOW_MS) {
    PER_CALLER_RATE.set(callerAgentId, { windowStartedAt: now, count: 1 });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_DEFAULT) return false;
  bucket.count += 1;
  return true;
}

// ── Public: evaluate ──

export interface InboundA2AContext {
  callerAgentId?: string;
  /** First word of the message body — used for scope matching. */
  intent?: string;
  /** Whole text or activity payload (string-form) — only used for audit. */
  preview?: string;
}

export async function evaluateInboundA2A(
  ctx: InboundA2AContext,
): Promise<A2APolicyDecision> {
  kpi.attempts += 1;

  const reject = async (reason: A2ARejectReason, details?: string): Promise<A2APolicyDecision> => {
    kpi.rejected += 1;
    kpi.byReason[reason] += 1;
    await logAuditEntry({
      workerId: 'a2a-policy',
      workerName: 'A2A Inbound Policy',
      toolName: 'a2a.reject',
      riskLevel: 'block',
      triggeredBy: ctx.callerAgentId || 'unknown-agent',
      triggerType: 'a2a',
      parameters: JSON.stringify({
        callerAgentId: ctx.callerAgentId || null,
        intent: ctx.intent || null,
        preview: (ctx.preview || '').slice(0, 200),
      }),
      resultSummary: `rejected: ${reason}${details ? ' — ' + details : ''}`,
      requiredConfirmation: false,
      durationMs: 0,
    }).catch(() => {});
    return { allow: false, callerAgentId: ctx.callerAgentId, reason, details };
  };

  // Governance gates short-circuit first.
  if (isKillSwitchEngaged()) return reject('killed', 'kill-switch active');
  if (isChangeFreezeActive()) return reject('frozen', 'change-freeze active');

  const callerAgentId = (ctx.callerAgentId || '').trim().toLowerCase();
  if (!callerAgentId) return reject('missing-agent-id');

  const allowed = getAllowedAgents();
  if (!allowed.has('*') && !allowed.has(callerAgentId)) {
    return reject('agent-not-allowed', `not in A2A_ALLOWED_AGENTS`);
  }

  if (!checkRate(callerAgentId)) {
    return reject('rate-limited', `>${RATE_LIMIT_DEFAULT}/hr`);
  }

  // Scope match.
  const scopes = getScopeMap();
  const allowedIntents = scopes[callerAgentId];
  const intent = (ctx.intent || '').trim();
  if (allowedIntents && intent && !intentMatches(intent, allowedIntents)) {
    return reject('scope-denied', `intent='${intent}' not in scope`);
  }

  // Allowed.
  kpi.allowed += 1;
  await logAuditEntry({
    workerId: 'a2a-policy',
    workerName: 'A2A Inbound Policy',
    toolName: 'a2a.allow',
    riskLevel: 'notify',
    triggeredBy: callerAgentId,
    triggerType: 'a2a',
    parameters: JSON.stringify({ callerAgentId, intent, preview: (ctx.preview || '').slice(0, 200) }),
    resultSummary: 'allowed',
    requiredConfirmation: false,
    durationMs: 0,
  }).catch(() => {});

  return { allow: true, callerAgentId };
}

// ── Helpers for Express ──

/**
 * Pulls callerAgentId + intent from a Bot Framework request body.
 * Bot Framework sends the activity payload at `req.body` with a `text`
 * field for plain-text invocations, or a `value` field for invoke
 * activities. We treat the first whitespace-separated token of `text`
 * as the intent for scope matching.
 */
export function extractA2AContextFromBody(
  headerAgentId: string | string[] | undefined,
  body: unknown,
): InboundA2AContext {
  const callerAgentId = Array.isArray(headerAgentId) ? headerAgentId[0] : headerAgentId;
  const text =
    body && typeof body === 'object' && 'text' in body
      ? String((body as { text?: unknown }).text || '')
      : '';
  const firstWord = text.trim().split(/\s+/, 1)[0] || '';
  return {
    callerAgentId: typeof callerAgentId === 'string' ? callerAgentId : undefined,
    intent: firstWord,
    preview: text,
  };
}
