// ITSM Operations — Signal Router
// Central event-driven dispatcher. Replaces cron-first triggering by letting
// any source (ServiceNow webhook, scheduler, demo-director, internal monitor)
// publish typed Signals that route to subscribed workflows under a policy gate.
//
// Pillar 1 of the Anticipatory-Alex architecture (MVP slice).

import { logAuditEntry } from './audit-trail';
import { logTrace } from './reasoning-trace';

// ── Types ──

export type SignalSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type SignalOrigin = 'observed' | 'predicted' | 'scripted';

export interface Signal {
  /** Stable id used for dedupe (5-min window). Caller must ensure uniqueness. */
  id: string;
  /** Source system: 'servicenow' | 'scheduler' | 'monitor' | 'demo' | 'foresight' | ... */
  source: string;
  /** Hierarchical type: '<table>.<action>' for SNOW, '<routine>.<event>' for scheduler. */
  type: string;
  severity: SignalSeverity;
  /** Optional CI / asset identifier the signal pertains to. */
  asset?: string;
  /** Free-form payload kept by the publisher (sanitized externally). */
  payload: Record<string, unknown>;
  /** ISO-8601 timestamp at which the underlying event occurred. */
  occurredAt: string;
  /** Optional trace correlation id (propagated to downstream workflow). */
  correlationId?: string;
  /** Confidence in the signal in [0, 1]. Defaults to 1 for observed events. */
  confidence?: number;
  /** Whether this signal is the output of a forecast (vs. an observed event). */
  predicted?: boolean;
  /**
   * Provenance for governance, mission-control color-coding, and prod/demo
   * separation. Mission-control hides 'scripted' in the prod profile.
   */
  origin: SignalOrigin;
}

export interface SignalSubscription {
  /** Workflow id (or arbitrary handler id) the subscription routes to. */
  workflowId: string;
  /** Predicate evaluated on each published signal. */
  predicate: (signal: Signal) => boolean;
  /** Per-subscription cooldown in ms. Re-fires within the window are suppressed. */
  cooldownMs?: number;
  /** Optional handler invoked with the signal + last decision context. */
  handler?: (signal: Signal) => Promise<void> | void;
}

export interface SignalRoutingDecision {
  signalId: string;
  workflowId: string;
  matched: boolean;
  /** Reason a matched subscription was suppressed (cooldown, dedupe, etc.). */
  suppressedReason?: string;
}

// ── Helper predicates ──

export const when = {
  type: (t: string) => (s: Signal) => s.type === t,
  source: (src: string) => (s: Signal) => s.source === src,
  minSeverity: (min: SignalSeverity) => {
    const order: Record<SignalSeverity, number> = {
      info: 0,
      low: 1,
      medium: 2,
      high: 3,
      critical: 4,
    };
    return (s: Signal) => order[s.severity] >= order[min];
  },
  all:
    (...preds: Array<(s: Signal) => boolean>) =>
    (s: Signal) =>
      preds.every((p) => p(s)),
  any:
    (...preds: Array<(s: Signal) => boolean>) =>
    (s: Signal) =>
      preds.some((p) => p(s)),
};

// ── Implementation ──

const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const MAX_RECENT_SIGNALS = 200;
const MAX_RECENT_DECISIONS = 200;

interface DedupeEntry {
  id: string;
  expiresAt: number;
}

export class SignalRouter {
  private subscriptions: SignalSubscription[] = [];
  private dedupe: DedupeEntry[] = [];
  private lastFiredAt = new Map<string, number>(); // workflowId -> ms epoch
  private recentSignals: Signal[] = [];
  private recentDecisions: SignalRoutingDecision[] = [];

  subscribe(sub: SignalSubscription): () => void {
    this.subscriptions.push(sub);
    return () => {
      this.subscriptions = this.subscriptions.filter((s) => s !== sub);
    };
  }

  /** Publish a signal. Returns the routing decisions that were taken. */
  async publish(signal: Signal): Promise<SignalRoutingDecision[]> {
    this.recordSignal(signal);
    if (this.isDuplicate(signal.id)) {
      return [
        { signalId: signal.id, workflowId: '*', matched: false, suppressedReason: 'duplicate' },
      ];
    }
    this.markSeen(signal.id);

    // Surface every published signal in the reasoning-trace store so the
    // Mission Control "Agent Activity" panel reflects what Alex is reacting
    // to in near-real time. Conversation id is the signal id so all routed
    // workflow traces nest under the same thread.
    const convId = signal.correlationId || `sig-${signal.id}`;
    try {
      logTrace({
        conversationId: convId,
        type: 'intent',
        source: `signal:${signal.source}`,
        summary: `Signal received: ${signal.type} (${signal.severity})`,
        detail: `Asset: ${signal.asset || 'n/a'}\nOrigin: ${signal.origin}\nPayload: ${JSON.stringify(signal.payload).slice(0, 400)}`,
        metadata: { signalId: signal.id, signalType: signal.type, severity: signal.severity, origin: signal.origin },
      });
    } catch { /* ignore */ }

    const decisions: SignalRoutingDecision[] = [];
    const now = Date.now();

    for (const sub of this.subscriptions) {
      let matched = false;
      try {
        matched = sub.predicate(signal);
      } catch (err) {
        console.error('[SignalRouter] Predicate threw:', err);
        matched = false;
      }
      if (!matched) {
        continue;
      }

      const cooldown = sub.cooldownMs ?? 0;
      const last = this.lastFiredAt.get(sub.workflowId) ?? 0;
      if (cooldown > 0 && now - last < cooldown) {
        const decision: SignalRoutingDecision = {
          signalId: signal.id,
          workflowId: sub.workflowId,
          matched: true,
          suppressedReason: 'cooldown',
        };
        decisions.push(decision);
        this.recordDecision(decision);
        continue;
      }

      const decision: SignalRoutingDecision = {
        signalId: signal.id,
        workflowId: sub.workflowId,
        matched: true,
      };
      decisions.push(decision);
      this.recordDecision(decision);
      this.lastFiredAt.set(sub.workflowId, now);

      try {
        logTrace({
          conversationId: convId,
          type: 'routing',
          source: `signal-router`,
          summary: `Routed → ${sub.workflowId}`,
          detail: `Signal ${signal.type} (${signal.severity}) matched workflow ${sub.workflowId}`,
          metadata: { signalId: signal.id, workflowId: sub.workflowId, signalType: signal.type },
        });
      } catch { /* ignore */ }

      // Audit the routing decision (best-effort).
      void logAuditEntry({
        workerId: sub.workflowId,
        workerName: `signal-router → ${sub.workflowId}`,
        toolName: `signal:${signal.type}`,
        riskLevel: 'read',
        triggeredBy: signal.source,
        triggerType: 'scheduled',
        parameters: JSON.stringify({
          signalId: signal.id,
          origin: signal.origin,
          severity: signal.severity,
        }),
        resultSummary: `Routed to ${sub.workflowId}`,
        requiredConfirmation: false,
        durationMs: 0,
      }).catch(() => {});

      if (sub.handler) {
        try {
          await sub.handler(signal);
        } catch (err) {
          console.error(`[SignalRouter] Handler for ${sub.workflowId} failed:`, err);
        }
      }
    }

    return decisions;
  }

  getRecentSignals(limit = 50): Signal[] {
    return this.recentSignals.slice(-limit).reverse();
  }

  getRecentDecisions(limit = 50): SignalRoutingDecision[] {
    return this.recentDecisions.slice(-limit).reverse();
  }

  /** Test-only: clears subscriptions, dedupe, and history. */
  reset(): void {
    this.subscriptions = [];
    this.dedupe = [];
    this.lastFiredAt.clear();
    this.recentSignals = [];
    this.recentDecisions = [];
  }

  private isDuplicate(id: string): boolean {
    const now = Date.now();
    this.dedupe = this.dedupe.filter((d) => d.expiresAt > now);
    return this.dedupe.some((d) => d.id === id);
  }

  private markSeen(id: string): void {
    this.dedupe.push({ id, expiresAt: Date.now() + DEDUPE_WINDOW_MS });
  }

  private recordSignal(signal: Signal): void {
    this.recentSignals.push(signal);
    if (this.recentSignals.length > MAX_RECENT_SIGNALS) {
      this.recentSignals.shift();
    }
  }

  private recordDecision(decision: SignalRoutingDecision): void {
    this.recentDecisions.push(decision);
    if (this.recentDecisions.length > MAX_RECENT_DECISIONS) {
      this.recentDecisions.shift();
    }
  }
}

export const signalRouter = new SignalRouter();
