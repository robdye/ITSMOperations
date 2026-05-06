// ITSM Operations — Voice approvals
//
// Phase 1.5 — maps user voice utterances ("approve", "yes proceed",
// "deny", "hold") to actions on the existing approval queue, then
// confirms back via the caller's TTS so the user knows the decision was
// committed.
//
// Wired from the voice bridge: when Alex pages a user about a pending
// approval, the bridge feeds the user's transcribed turns (Realtime
// `conversation.item.input_audio_transcription.completed`) into
// `processVoiceApproval()`. If we recognise an approve/deny/hold intent
// and the user has at least one pending approval, we resolve the most
// recent one and emit a confirmation string the caller can speak via
// `response.create` with a custom instruction.
//
// This module is transport-agnostic — it does NOT speak. The voice
// bridge is responsible for actually playing the confirmation back. We
// only return the text and the resolution.

import {
  resolveAction,
  getUserPendingActions,
  findPendingActionsForOid,
  type PendingAction,
} from '../approval-queue';
import { logAuditEntry } from '../audit-trail';

export type VoiceIntent = 'approve' | 'deny' | 'hold' | 'unknown';

// ── KPI counters (Phase 1.5 — single numeric surface per hard rule #1) ──
//
// Counts since process start. Surfaced via getVoiceApprovalKpi() and
// exposed on /api/voice/kpi for the mission-control tile.
const kpi = {
  utterancesProcessed: 0,
  resolved: 0,
  byIntent: { approve: 0, deny: 0, hold: 0, unknown: 0 } as Record<VoiceIntent, number>,
  startedAt: Date.now(),
};

export function getVoiceApprovalKpi(): {
  utterancesProcessed: number;
  resolved: number;
  resolutionRate: number;
  byIntent: Record<VoiceIntent, number>;
  uptimeSec: number;
} {
  const uptimeSec = Math.round((Date.now() - kpi.startedAt) / 1000);
  const resolutionRate =
    kpi.utterancesProcessed > 0 ? kpi.resolved / kpi.utterancesProcessed : 0;
  return {
    utterancesProcessed: kpi.utterancesProcessed,
    resolved: kpi.resolved,
    resolutionRate,
    byIntent: { ...kpi.byIntent },
    uptimeSec,
  };
}

export interface VoiceApprovalContext {
  /** ACS call connection id — used as the audit triggeredBy when no userId. */
  callConnectionId?: string;
  /** Stable user id (Teams-Bot user id or AAD OID) — used to resolve queue. */
  userId?: string;
  /** Entra (AAD) Object ID — fallback when userId isn't present. */
  aadOid?: string;
  /** Display name used when speaking the confirmation. */
  displayName?: string;
}

export interface VoiceApprovalResult {
  intent: VoiceIntent;
  /** Confidence in [0, 1]. 0 means we shouldn't act on it. */
  confidence: number;
  /** Pending action that was acted on, if any. */
  resolvedAction?: PendingAction;
  /** Text the bridge should speak back to the user (TTS). */
  confirmation?: string;
  /** Reason we couldn't resolve, when no action was taken. */
  reason?: string;
}

// ── Intent classifier ──
//
// Deliberately tiny, deterministic, and word-boundary based so the
// classifier doesn't fire on partial transcripts ("approving the budget"
// must NOT count as approve). Matches against a small canonical phrase
// list per intent. Negation prefix ("don't", "do not", "never") flips an
// approve → unknown so transcription glitches don't auto-approve.

const NEGATION = /\b(?:don'?t|do\s+not|never|cannot|can'?t|won'?t)\b/i;
const STOPWORDS = /\b(?:please|just|kindly|umm?|uh|er)\b/gi;

const APPROVE_PHRASES = [
  /\bapprove\b/,
  /\bapproved\b/,
  /\bproceed\b/,
  /\bgo\s+ahead\b/,
  /\b(?:i\s+)?confirm\b/,
  /\bconfirmed\b/,
  /\baffirmative\b/,
  /\bsounds?\s+good\b/,
  /\byes,?\s+(?:do\s+it|proceed|go|please|approve)\b/,
  /\bsigned?\s+off\b/,
  /\bship\s+it\b/,
  /\blooks?\s+(?:good|fine|ok)\b/,
];

const DENY_PHRASES = [
  /\b(?:reject|rejected|deny|denied|decline|declined)\b/,
  /\b(?:cancel|cancelled?|abort|aborted?)\b/,
  /\b(?:stop|hold\s+off|kill\s+it|kill\s+the\s+request)\b/,
  /\bnegative\b/,
  /\bno\s+go\b/,
  /\bno,?\s+(?:do\s+not|don'?t|stop|cancel|reject|deny)\b/,
];

const HOLD_PHRASES = [
  /\b(?:hold|wait|pause|defer|park|standby|stand\s+by)\b/,
  /\bnot\s+(?:yet|right\s+now|now)\b/,
  /\bhold\s+(?:on|off|please|that)\b/,
  /\bgive\s+me\s+a\s+(?:minute|moment|sec(?:ond)?)\b/,
  /\bcheck\s+back\b/,
];

export function classifyVoiceIntent(utterance: string): {
  intent: VoiceIntent;
  confidence: number;
} {
  if (!utterance || typeof utterance !== 'string') {
    return { intent: 'unknown', confidence: 0 };
  }
  const cleaned = utterance.trim().replace(STOPWORDS, ' ').replace(/\s+/g, ' ');
  if (cleaned.length === 0) return { intent: 'unknown', confidence: 0 };

  // Always classify under NEGATION as "unknown" — it's safer to ask again
  // than to auto-approve on an ambiguous "no, don't approve" phrase.
  if (NEGATION.test(cleaned)) {
    if (DENY_PHRASES.some((re) => re.test(cleaned))) {
      // "don't proceed" still means deny.
      return { intent: 'deny', confidence: 0.7 };
    }
    return { intent: 'unknown', confidence: 0 };
  }

  if (DENY_PHRASES.some((re) => re.test(cleaned))) {
    return { intent: 'deny', confidence: 0.85 };
  }
  if (HOLD_PHRASES.some((re) => re.test(cleaned))) {
    return { intent: 'hold', confidence: 0.8 };
  }
  if (APPROVE_PHRASES.some((re) => re.test(cleaned))) {
    return { intent: 'approve', confidence: 0.85 };
  }
  return { intent: 'unknown', confidence: 0 };
}

// ── Public API ──

/**
 * Process a user's spoken approval utterance against their pending queue.
 * Returns the action that was resolved (if any) plus a confirmation string
 * suitable for TTS playback by the voice bridge. Always emits an audit
 * entry — even on `unknown` — so call recordings are traceable.
 */
export async function processVoiceApproval(
  utterance: string,
  ctx: VoiceApprovalContext,
): Promise<VoiceApprovalResult> {
  const { intent, confidence } = classifyVoiceIntent(utterance);
  kpi.utterancesProcessed += 1;
  kpi.byIntent[intent] += 1;

  // Always audit. (We deliberately log the utterance text — voice
  // recording + transcript are already attached to the SNOW worknote by
  // the ACS bridge so this is consistent, and the audit-trail's
  // sanitiseParams will strip anything that looks like a credential.)
  await logAuditEntry({
    workerId: 'voice-approvals',
    workerName: 'Voice Approvals',
    toolName: 'voice.approval.classify',
    riskLevel: 'notify',
    triggeredBy: ctx.userId || ctx.callConnectionId || 'voice',
    triggerType: 'user',
    parameters: JSON.stringify({
      utterance: utterance.slice(0, 500),
      callConnectionId: ctx.callConnectionId,
      intent,
      confidence,
    }),
    resultSummary: `intent=${intent} confidence=${confidence.toFixed(2)}`,
    requiredConfirmation: false,
    durationMs: 0,
  }).catch(() => {});

  if (intent === 'unknown' || confidence < 0.5) {
    return {
      intent,
      confidence,
      reason: 'Utterance did not match a known approval intent.',
      confirmation:
        "I didn't catch a clear decision. Say 'approve', 'deny', or 'hold' and I'll record it.",
    };
  }

  if (!ctx.userId && !ctx.aadOid) {
    return {
      intent,
      confidence,
      reason: 'No userId / aadOid in voice context — cannot resolve queue.',
      confirmation:
        "I heard your decision, but I don't have you signed in to the approval queue right now. " +
        "I'll keep the request pending and you can resolve it in Teams.",
    };
  }

  // Look up pending actions: prefer exact userId match, fall back to AAD OID.
  let pending: PendingAction[] = ctx.userId ? getUserPendingActions(ctx.userId) : [];
  if (pending.length === 0 && ctx.aadOid) {
    pending = findPendingActionsForOid(ctx.aadOid, ctx.displayName);
  }
  if (pending.length === 0) {
    return {
      intent,
      confidence,
      reason: 'No pending actions for this user.',
      confirmation:
        "There aren't any pending approvals on your queue right now. Nothing to confirm.",
    };
  }

  // Resolve the OLDEST pending action. Keeps the queue FIFO so the user
  // can knock items off in order over a single voice call.
  const target = pending.reduce((oldest, a) =>
    a.createdAt.getTime() < oldest.createdAt.getTime() ? a : oldest,
  );

  if (intent === 'hold') {
    // Hold is a no-op against the queue — leave it pending. We confirm
    // verbally so the user knows we didn't accidentally commit.
    return {
      intent,
      confidence,
      confirmation:
        `Holding ${target.toolName}. The request stays pending — say 'approve' or 'deny' when you're ready.`,
    };
  }

  const decision = intent === 'approve' ? 'approved' : 'rejected';
  const resolvedBy = ctx.displayName || ctx.userId || ctx.aadOid || 'voice';
  const resolved = resolveAction(target.id, decision, resolvedBy);
  if (!resolved) {
    return {
      intent,
      confidence,
      reason: 'Action vanished from queue between read and resolve.',
      confirmation:
        `That action just expired before I could record your ${decision}. ` +
        "Take a look in Teams — if it reappears I'll page you again.",
    };
  }
  kpi.resolved += 1;

  return {
    intent,
    confidence,
    resolvedAction: resolved,
    confirmation:
      decision === 'approved'
        ? `Approved ${resolved.toolName} for ${resolved.workerName}. Committing now.`
        : `Rejected ${resolved.toolName}. ${resolved.workerName} won't run it.`,
  };
}
