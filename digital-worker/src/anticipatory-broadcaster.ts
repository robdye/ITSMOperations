// ITSM Operations — Anticipatory Broadcaster (Phase 9.3)
//
// Pushes Phase 5–7 anticipatory events (forecast published, kill-switch
// engaged/released, autonomy blocked, outcome failure with rollback) onto
// the existing notification surfaces so ITSM operators see them where they
// already work — Service Bus topic for downstream automations, Teams
// Approvals for the actionable ones, and App Insights for telemetry.
//
// Reuses the existing wiring rather than introducing a new transport:
//   - `service-bus.ts` already exposes a NOTIFICATION topic with local
//     fallback so dispatch works even without an Azure Service Bus.
//   - `teams-approvals.ts` already wraps Microsoft Graph Approvals API
//     with a fallback path; we reuse it for events that need a human Yes/No.
//   - App Insights gets a structured custom event via console.log JSON
//     (the existing OpenTelemetry exporter picks these up).

import { publishEvent, TOPICS } from './service-bus';
import type { ForecastedSignal } from './foresight';
import type { OutcomeRecord } from './outcome-verifier';
import type { KillState } from './governance';
import type { Signal } from './signal-router';

export type AnticipatoryEventKind =
  | 'forecast.published'
  | 'kill-switch.engaged'
  | 'kill-switch.released'
  | 'autonomy.blocked'
  | 'outcome.failure'
  | 'outcome.rolled-back';

export interface AnticipatoryEvent {
  kind: AnticipatoryEventKind;
  /** Short human title for the notification card. */
  title: string;
  /** Short human summary. */
  summary: string;
  /** Severity for downstream routing. */
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  /** Free-form structured payload. */
  payload: Record<string, unknown>;
  /** Optional correlation id. */
  correlationId?: string;
}

function structuredLog(event: AnticipatoryEvent): void {
  // App Insights / console — structured JSON line for KQL search.
  // Keyed under the same `kind` namespace as Service Bus subjects so KQL is uniform.
  try {
    console.log(
      `[Broadcaster] ${event.kind} severity=${event.severity} ${JSON.stringify({
        title: event.title,
        summary: event.summary,
        payload: event.payload,
        correlationId: event.correlationId,
      })}`,
    );
  } catch {
    // ignore
  }
}

async function dispatchToServiceBus(event: AnticipatoryEvent): Promise<void> {
  try {
    await publishEvent(TOPICS.NOTIFICATION, event.kind, event, event.correlationId);
  } catch (err: any) {
    console.warn(`[Broadcaster] service-bus dispatch failed for ${event.kind}:`, err?.message);
  }
}

/**
 * Optionally route an actionable event to Teams Approvals (Microsoft Graph).
 * Loaded via dynamic import to avoid a hard dependency at startup when the
 * approvals path is unconfigured.
 */
async function dispatchToTeamsApprovals(event: AnticipatoryEvent): Promise<void> {
  // Only forecast-published events go through Teams Approvals so operators
  // can confirm or dismiss the prediction. Kill-switch already requires an
  // explicit operator action through governance API.
  if (event.kind !== 'forecast.published') return;
  const approverEnv = process.env.ANTICIPATORY_APPROVERS || '';
  if (!approverEnv) return;
  const approvers = approverEnv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (approvers.length === 0) return;
  try {
    const { createApproval } = await import('./teams-approvals');
    await createApproval({
      title: `[Anticipatory] ${event.title}`,
      description: event.summary,
      requestedBy: 'alex@itsm-operations',
      approvers,
      category: 'incident',
      priority: event.severity === 'critical' ? 'urgent' : 'normal',
      metadata: {
        kind: event.kind,
        severity: event.severity,
        ...Object.fromEntries(
          Object.entries(event.payload).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
        ),
      },
    });
  } catch (err: any) {
    console.warn(`[Broadcaster] teams-approvals dispatch failed for ${event.kind}:`, err?.message);
  }
}

/** Single dispatch fan-out used by every helper below. */
export async function broadcastAnticipatoryEvent(event: AnticipatoryEvent): Promise<void> {
  structuredLog(event);
  // Run side channels in parallel; never throw.
  await Promise.all([
    dispatchToServiceBus(event).catch(() => undefined),
    dispatchToTeamsApprovals(event).catch(() => undefined),
  ]);
}

// ── Convenience builders ──

export function broadcastForecast(forecast: ForecastedSignal): Promise<void> {
  const s = forecast.signal;
  return broadcastAnticipatoryEvent({
    kind: 'forecast.published',
    severity: (s.severity as any) ?? 'medium',
    title: `Forecast: ${s.type}`,
    summary: forecast.rationale,
    payload: {
      signalId: s.id,
      asset: s.asset,
      confidence: s.confidence,
      evidenceIds: forecast.evidenceIds,
    },
    correlationId: s.correlationId,
  });
}

export function broadcastKillSwitch(state: KillState, action: 'engaged' | 'released'): Promise<void> {
  return broadcastAnticipatoryEvent({
    kind: action === 'engaged' ? 'kill-switch.engaged' : 'kill-switch.released',
    severity: action === 'engaged' ? 'critical' : 'medium',
    title: action === 'engaged' ? 'Kill-switch engaged' : 'Kill-switch released',
    summary:
      action === 'engaged'
        ? `Autonomous actions globally suspended by ${state.engagedBy ?? 'unknown'}${state.reason ? ` — ${state.reason}` : ''}`
        : `Autonomous actions resumed`,
    payload: { ...state },
  });
}

export function broadcastAutonomyBlocked(args: {
  workflowId: string;
  signalType?: string;
  workerId: string;
  reason: string;
  effectiveConfidence?: number;
}): Promise<void> {
  return broadcastAnticipatoryEvent({
    kind: 'autonomy.blocked',
    severity: 'medium',
    title: `Autonomy blocked: ${args.workflowId}`,
    summary: args.reason,
    payload: { ...args },
  });
}

export function broadcastOutcomeFailure(record: OutcomeRecord, originating?: Signal): Promise<void> {
  const kind: AnticipatoryEventKind = record.rolledBack ? 'outcome.rolled-back' : 'outcome.failure';
  return broadcastAnticipatoryEvent({
    kind,
    severity: record.rolledBack ? 'high' : 'critical',
    title: record.rolledBack
      ? `Workflow rolled back: ${record.workflowId}`
      : `Workflow failed: ${record.workflowId}`,
    summary: record.notes ?? 'no notes',
    payload: {
      executionId: record.executionId,
      signalType: record.signalType,
      label: record.label,
      rolledBack: record.rolledBack,
      metrics: record.metrics ?? {},
      originatingSignal: originating?.id,
    },
    correlationId: originating?.correlationId,
  });
}
