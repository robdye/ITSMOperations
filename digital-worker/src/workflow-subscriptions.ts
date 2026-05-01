// ITSM Operations — Workflow signal subscriptions.
// MVP slice: subscribes the major-incident-response workflow to ServiceNow
// incident signals. Wider wiring lands in later phases.

import { signalRouter, when, type Signal } from './signal-router';
import { evaluateTrigger } from './trigger-policy';
import { workflowEngine } from './workflow-engine';
import { workerMap } from './worker-definitions';

/**
 * Wire the default subscriptions. Idempotent — call once at boot.
 * Returns an array of unsubscribe functions for tests/shutdown.
 */
export function registerDefaultSubscriptions(): Array<() => void> {
  const unsubs: Array<() => void> = [];

  // ServiceNow incident signals (high severity or above) → major-incident-response.
  unsubs.push(
    signalRouter.subscribe({
      workflowId: 'major-incident-response',
      cooldownMs: 60_000,
      predicate: when.all(
        when.source('servicenow'),
        (s) => s.type.startsWith('incident.'),
        when.minSeverity('high'),
      ),
      handler: async (signal) => {
        await runMajorIncidentResponse(signal);
      },
    }),
  );

  return unsubs;
}

async function runMajorIncidentResponse(signal: Signal): Promise<void> {
  const worker = workerMap.get('incident-manager');
  const decision = evaluateTrigger({
    workflowId: 'major-incident-response',
    signal,
    worker,
  });

  console.log(
    `[Subscriptions] major-incident-response decision: mode=${decision.mode} ` +
      `confidence=${decision.effectiveConfidence.toFixed(2)} reason="${decision.reason}"`,
  );

  if (decision.mode === 'suppress' || decision.mode === 'notify-only') {
    return;
  }

  // Even in dry-run / propose modes we still execute the workflow today;
  // the workflow itself respects step-level requiresApproval gates. Tighter
  // mode handling (true dry-run, propose-only) lands in a later phase.
  // Phase 10 — env-flagged opt-in to the parallel DAG variant. Defaults off
  // so behaviour is unchanged unless an operator sets DAG_MAJOR_INCIDENT=1.
  const useDag = process.env.DAG_MAJOR_INCIDENT === '1' || process.env.DAG_MAJOR_INCIDENT === 'true';
  const targetWorkflow = useDag ? 'major-incident-response-dag' : 'major-incident-response';
  try {
    await workflowEngine.executeWorkflow(targetWorkflow, {
      signalId: signal.id,
      signalSource: signal.source,
      signalType: signal.type,
      signalOrigin: signal.origin,
      severity: signal.severity,
      asset: signal.asset,
      payload: signal.payload,
      occurredAt: signal.occurredAt,
      correlationId: signal.correlationId,
      triggerMode: decision.mode,
      effectiveConfidence: decision.effectiveConfidence,
      decisionReason: decision.reason,
      // Forward the full signal + decision so workflow-engine's autonomy gate
      // can re-evaluate per-step against governance + tuner.
      signal,
      triggerDecision: decision,
    });
  } catch (err) {
    console.error('[Subscriptions] major-incident-response execution failed:', err);
  }
}
