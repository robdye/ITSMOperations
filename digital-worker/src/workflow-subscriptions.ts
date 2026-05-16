// ITSM Operations — Workflow signal subscriptions.
// MVP slice: subscribes the major-incident-response workflow to ServiceNow
// incident signals. Wider wiring lands in later phases.

import { signalRouter, when, type Signal } from './signal-router';
import { evaluateTrigger, type TriggerDecision } from './trigger-policy';
import { workflowEngine } from './workflow-engine';
import { workerMap } from './worker-definitions';
import { createApproval } from './teams-approvals';
import { logAuditEntry } from './audit-trail';
import { requireReviewIfBlastRadius } from './reviewer-worker';
import { applyTag } from './cognition-tags';
import { assertSnowPrecondition, auditSnowBlocked } from './snow-preflight';
import { notifyManagerOnException } from './exception-reporter';

/**
 * Phase E — Inspect a signal's payload for an embedded CVSS base score
 * and return true when it crosses the Critical threshold (>= 9.0). This
 * is the trip-wire for forcing a reviewer-worker re-evaluation regardless
 * of the worker's nominal blast radius — a Critical CVE outranks the
 * normal autonomy gates.
 */
function isCriticalCvss(signal: Signal): boolean {
  const p = signal.payload as
    | {
        cvss?: { baseScore?: number };
        cvssBaseScore?: number;
        baseScore?: number;
      }
    | undefined;
  const score =
    typeof p?.cvss?.baseScore === 'number'
      ? p.cvss.baseScore
      : typeof p?.cvssBaseScore === 'number'
        ? p.cvssBaseScore
        : typeof p?.baseScore === 'number'
          ? p.baseScore
          : null;
  return score !== null && score >= 9.0;
}

/**
 * Phase E — When a signal carries CVSS >= 9.0, force the reviewer regardless
 * of the worker's blast-radius score. We do this by pinning the radius to 1.0
 * for the gate call so it always runs and any blocking concern downgrades
 * the workflow to propose.
 */
function effectiveReviewBlastRadius(workerBlast: number, signal: Signal): number {
  return isCriticalCvss(signal) ? Math.max(workerBlast, 1.0) : workerBlast;
}

/**
 * Wire the default subscriptions. Idempotent — call once at boot.
 * Returns an array of unsubscribe functions for tests/shutdown.
 */
export function registerDefaultSubscriptions(): Array<() => void> {
  const unsubs: Array<() => void> = [];

  // ── major-incident-response ──
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

  // ── change-lifecycle ──
  // Phase 2.2 — Any new change_request from SNOW kicks off the lifecycle
  // workflow. The workflow itself respects approval gates per step, so
  // this is safe to subscribe wide.
  unsubs.push(
    signalRouter.subscribe({
      workflowId: 'change-lifecycle',
      cooldownMs: 30_000,
      predicate: when.all(
        when.source('servicenow'),
        (s) => s.type === 'change_request.insert' || s.type === 'change.created',
      ),
      handler: async (signal) => {
        await runWorkflowWithModes('change-lifecycle', 'change-manager', signal);
      },
    }),
  );

  // ── incident-to-problem ──
  // Phase 2.2 — Foresight cluster signal (recurring pattern detection)
  // promotes to a problem record.
  unsubs.push(
    signalRouter.subscribe({
      workflowId: 'incident-to-problem',
      cooldownMs: 5 * 60_000,
      predicate: when.all(
        (s) =>
          s.type === 'foresight.cluster' ||
          s.type === 'foresight.recurrence' ||
          s.type === 'incident.cluster',
      ),
      handler: async (signal) => {
        await runWorkflowWithModes('incident-to-problem', 'problem-manager', signal);
      },
    }),
  );

  // ── vulnerability-to-change ──
  // Phase 2.2 — KEV / MSRC enrichment signals open a remediation RFC.
  unsubs.push(
    signalRouter.subscribe({
      workflowId: 'vulnerability-to-change',
      cooldownMs: 60_000,
      predicate: when.all(
        (s) =>
          s.type === 'vulnerability.kev' ||
          s.type === 'vulnerability.msrc' ||
          s.type === 'vuln.cve.published' ||
          s.type.startsWith('security.advisory.'),
      ),
      handler: async (signal) => {
        await runWorkflowWithModes('vulnerability-to-change', 'security-manager', signal);
      },
    }),
  );

  // ── sla-breach-escalation ──
  // Phase 2.2 — SNOW SLA breach (or imminent breach).
  unsubs.push(
    signalRouter.subscribe({
      workflowId: 'sla-breach-escalation',
      cooldownMs: 60_000,
      predicate: when.all(
        when.source('servicenow'),
        (s) =>
          s.type === 'sla.breach' ||
          s.type === 'task_sla.breached' ||
          s.type === 'sla.imminent_breach',
      ),
      handler: async (signal) => {
        await runWorkflowWithModes('sla-breach-escalation', 'sla-manager', signal);
      },
    }),
  );

  // ── knowledge-harvest ──
  // Phase 2.2 — Resolved incident with no linked KB → harvest.
  unsubs.push(
    signalRouter.subscribe({
      workflowId: 'knowledge-harvest',
      cooldownMs: 5 * 60_000,
      predicate: when.all(
        when.source('servicenow'),
        (s) =>
          s.type === 'incident.resolved' ||
          s.type === 'incident.update' &&
            (s.payload as { state?: string } | undefined)?.state === 'resolved',
      ),
      handler: async (signal) => {
        await runWorkflowWithModes('knowledge-harvest', 'knowledge-manager', signal);
      },
    }),
  );

  // ── enrichment.kev.match → major-incident-response ──
  // Phase E — A CISA KEV CVE matched a CMDB asset. Promote straight to
  // a critical major-incident response so the on-call SRE sees the
  // CISA citation in the SNOW worknote within seconds.
  unsubs.push(
    signalRouter.subscribe({
      workflowId: 'major-incident-response',
      cooldownMs: 60_000,
      predicate: when.all((s) => s.type === 'enrichment.kev.match'),
      handler: async (signal) => {
        const upgraded: Signal = {
          ...signal,
          severity: 'critical',
          origin: 'observed',
        };
        await runMajorIncidentResponse(upgraded);
      },
    }),
  );

  // ── enrichment.msrc.critical → vulnerability-to-change ──
  // Phase E — MSRC published a Critical (CVSS ≥ 9.0) advisory affecting
  // a Microsoft product we own. Drives an RFC through the change manager.
  unsubs.push(
    signalRouter.subscribe({
      workflowId: 'vulnerability-to-change',
      cooldownMs: 60_000,
      predicate: when.all((s) => s.type === 'enrichment.msrc.critical'),
      handler: async (signal) => {
        await runWorkflowWithModes('vulnerability-to-change', 'change-manager', signal);
      },
    }),
  );

  // ── enrichment.azure.status.degraded → cognition graph tag (no workflow) ──
  // Phase E — An Azure status feed entry calls out a region-wide
  // degradation. We tag the cognition graph with `upstream-degraded:<region>`
  // for 30 minutes so workers triaging downstream symptoms during that
  // window can cite the upstream condition rather than chase ghosts.
  unsubs.push(
    signalRouter.subscribe({
      workflowId: 'cognition-tag-azure-degraded',
      cooldownMs: 5 * 60_000,
      predicate: when.all((s) => s.type === 'enrichment.azure.status.degraded'),
      handler: async (signal) => {
        const region =
          (signal.payload as { region?: string } | undefined)?.region ??
          signal.asset ??
          'unknown';
        const detail = signal.payload as Record<string, unknown> | undefined;
        applyTag({
          namespace: 'upstream-degraded',
          key: region,
          ttlMs: 30 * 60_000,
          detail: {
            sourceSignalId: signal.id,
            severity: signal.severity,
            occurredAt: signal.occurredAt,
            ...(detail ?? {}),
          },
        });
        await logAuditEntry({
          workerId: 'cognition-tagger',
          workerName: 'Cognition Tagger',
          toolName: 'cognition.tag.upstream-degraded',
          riskLevel: 'notify',
          triggeredBy: signal.source,
          triggerType: 'a2a',
          parameters: JSON.stringify({ region, signalId: signal.id, ttlMinutes: 30 }),
          resultSummary: `Tagged upstream-degraded:${region} (TTL 30m) — source signal ${signal.id}`,
          requiredConfirmation: false,
          durationMs: 0,
        });
      },
    }),
  );

  return unsubs;
}

/**
 * Generic mode-aware workflow runner. Mirrors the major-incident-response
 * branch (suppress | notify-only | propose | dry-run | auto) so every
 * subscription gets identical mode handling.
 */
async function runWorkflowWithModes(
  workflowId: string,
  workerId: string,
  signal: Signal,
): Promise<void> {
  // Preflight — refuse to run when SNOW lacks the seeded record the
  // workflow expects. Catches the "no SNOW sys_id on originating signal"
  // and "record-not-found" classes of bad outcomes BEFORE any tool runs.
  const pf = await assertSnowPrecondition(workflowId, signal);
  if (!pf.ok) {
    await auditSnowBlocked(workflowId, signal, pf);
    await notifyManagerOnException('change-freeze-blocked', {
      actor: signal.source || 'signal-router',
      workflowId,
      toolName: workflowId,
      actionKey: `preflight:${workflowId}`,
      scenarioId: workflowId,
      signalId: signal.id,
      detail: pf.reason,
    }).catch(() => undefined);
    return;
  }

  const worker = workerMap.get(workerId);
  const decision = evaluateTrigger({ workflowId, signal, worker });

  console.log(
    `[Subscriptions] ${workflowId} decision: mode=${decision.mode} ` +
      `confidence=${decision.effectiveConfidence.toFixed(2)} reason="${decision.reason}"`,
  );

  if (decision.mode === 'suppress') {
    await auditTriggerOutcome(workflowId, signal, decision, 'suppressed');
    return;
  }
  if (decision.mode === 'notify-only') {
    await auditTriggerOutcome(workflowId, signal, decision, 'notify-only');
    return;
  }
  if (decision.mode === 'propose') {
    await proposeWorkflow(workflowId, signal, decision);
    return;
  }

  // Phase 3.4 — Reviewer worker (default-on for blast radius >= 0.5).
  // For 'auto' mode only, we ask the reviewer to look at a synthetic plan
  // before commit. If the reviewer blocks, we downgrade to 'propose'.
  // Phase E — Critical CVSS forces the gate to run regardless of nominal radius.
  if (decision.mode === 'auto') {
    const baseBlast = worker?.blastRadius ?? 0;
    const blastRadius = effectiveReviewBlastRadius(baseBlast, signal);
    const verdict = await requireReviewIfBlastRadius({
      workflowId,
      workerId,
      blastRadius,
      plan: {
        signalType: signal.type,
        severity: signal.severity,
        asset: signal.asset,
        payload: signal.payload,
      },
      signalSummary: `${signal.source}:${signal.type}:${signal.severity}`,
    });
    if (verdict?.blocking) {
      console.warn(
        `[Subscriptions] ${workflowId} reviewer blocked auto-run: ${verdict.concerns.join('; ')} — downgrading to propose`,
      );
      const downgraded: TriggerDecision = {
        ...decision,
        mode: 'propose',
        reason: `${decision.reason} | reviewer blocked: ${verdict.concerns.join('; ')}`,
      };
      await proposeWorkflow(workflowId, signal, downgraded);
      return;
    }
  }

  // dry-run + auto path.
  try {
    await workflowEngine.executeWorkflow(workflowId, {
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
      dryRun: decision.mode === 'dry-run',
      signal,
      triggerDecision: decision,
    });
  } catch (err) {
    console.error(`[Subscriptions] ${workflowId} execution failed:`, err);
  }
}

async function proposeWorkflow(
  workflowId: string,
  signal: Signal,
  decision: TriggerDecision,
): Promise<void> {
  const approver =
    process.env.WORKFLOW_PROPOSE_APPROVER || process.env.MANAGER_TEAMS_OID || '';
  if (!approver) {
    console.warn(
      `[Subscriptions] ${workflowId} propose: no approver configured — falling back to dry-run`,
    );
    await workflowEngine.executeWorkflow(workflowId, {
      signalId: signal.id,
      severity: signal.severity,
      asset: signal.asset,
      payload: signal.payload,
      dryRun: true,
      signal,
      triggerDecision: decision,
    });
    return;
  }
  try {
    await createApproval({
      title: `Run ${workflowId} for ${signal.asset || signal.id}?`,
      description:
        `Alex proposes running the ${workflowId} workflow.\n\n` +
        `- Source: ${signal.source}\n` +
        `- Type: ${signal.type}\n` +
        `- Severity: ${signal.severity}\n` +
        `- Asset: ${signal.asset || '(unknown)'}\n` +
        `- Effective confidence: ${decision.effectiveConfidence.toFixed(2)}\n` +
        `- Reason: ${decision.reason}\n\n` +
        `Approving will run the full workflow against the source-of-truth systems.`,
      requestedBy: 'alex.itsm-operations',
      approvers: [approver],
      category: workflowId.includes('change')
        ? 'change'
        : workflowId.includes('problem')
          ? 'problem'
          : workflowId.includes('incident')
            ? 'incident'
            : 'general',
      priority: 'normal',
      metadata: {
        signalId: signal.id,
        workflowId,
        triggerMode: decision.mode,
      },
    });
    await auditTriggerOutcome(workflowId, signal, decision, 'proposed');
  } catch (err) {
    console.error(`[Subscriptions] ${workflowId} propose-mode card failed:`, err);
  }
}

async function runMajorIncidentResponse(signal: Signal): Promise<void> {
  // Preflight — must have a verifiable SNOW incident before MIR fires.
  // Customer requirement: never run workflows without seeded data.
  const pf = await assertSnowPrecondition('major-incident-response', signal);
  if (!pf.ok) {
    await auditSnowBlocked('major-incident-response', signal, pf);
    await notifyManagerOnException('change-freeze-blocked', {
      actor: signal.source || 'signal-router',
      workflowId: 'major-incident-response',
      toolName: 'major-incident-response',
      actionKey: 'preflight:major-incident-response',
      scenarioId: 'major-incident-response',
      signalId: signal.id,
      detail: pf.reason,
    }).catch(() => undefined);
    return;
  }

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

  // Phase 2.1 — honour every trigger-policy mode for real.
  // - suppress    → audit + drop
  // - notify-only → audit only (mission-control feed already records the
  //                 routing decision via signal-router)
  // - propose     → fire a Teams approval card; do NOT execute the workflow
  // - dry-run     → execute the workflow with `dryRun:true` so writes
  //                 short-circuit to a planning summary
  // - auto        → execute normally
  if (decision.mode === 'suppress') {
    await auditTriggerOutcome('major-incident-response', signal, decision, 'suppressed');
    return;
  }
  if (decision.mode === 'notify-only') {
    await auditTriggerOutcome('major-incident-response', signal, decision, 'notify-only');
    return;
  }
  if (decision.mode === 'propose') {
    await proposeMajorIncidentResponse(signal, decision);
    return;
  }

  // Phase 3.4 — Reviewer-worker gate before auto-commit on
  // major-incident-response. Downgrade to propose if blocking.
  // Phase E — Critical CVSS forces the gate to run regardless of nominal radius.
  if (decision.mode === 'auto') {
    const baseBlast = worker?.blastRadius ?? 0.6; // MIR is by default >= 0.5
    const blastRadius = effectiveReviewBlastRadius(baseBlast, signal);
    const verdict = await requireReviewIfBlastRadius({
      workflowId: 'major-incident-response',
      workerId: 'incident-manager',
      blastRadius,
      plan: {
        signalType: signal.type,
        severity: signal.severity,
        asset: signal.asset,
        payload: signal.payload,
      },
      signalSummary: `${signal.source}:${signal.type}:${signal.severity}`,
    });
    if (verdict?.blocking) {
      console.warn(
        `[Subscriptions] major-incident-response reviewer blocked auto-run: ${verdict.concerns.join('; ')} — downgrading to propose`,
      );
      const downgraded: TriggerDecision = {
        ...decision,
        mode: 'propose',
        reason: `${decision.reason} | reviewer blocked: ${verdict.concerns.join('; ')}`,
      };
      await proposeMajorIncidentResponse(signal, downgraded);
      return;
    }
  }

  // dry-run + auto both go through the engine, with `dryRun` threaded in.
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
      // Phase 2.1 — `dryRun:true` for trigger-mode 'dry-run'; SNOW writes
      // (snow-client.snowRequest) and other tools should short-circuit
      // when this flag is set in workflow context.
      dryRun: decision.mode === 'dry-run',
      // Forward the full signal + decision so workflow-engine's autonomy gate
      // can re-evaluate per-step against governance + tuner.
      signal,
      triggerDecision: decision,
    });
  } catch (err) {
    console.error('[Subscriptions] major-incident-response execution failed:', err);
  }
}

async function proposeMajorIncidentResponse(
  signal: Signal,
  decision: TriggerDecision,
): Promise<void> {
  // 'propose' mode = ask a human FIRST, then run only on approval. We
  // post an approvals card to the on-call manager (or a configured
  // approver) and exit — the approval-callback handler will re-fire
  // this workflow as 'auto' when the human says yes.
  const approver = process.env.MIR_PROPOSE_APPROVER || process.env.MANAGER_TEAMS_OID || '';
  if (!approver) {
    console.warn('[Subscriptions] propose mode requested but no approver configured (MIR_PROPOSE_APPROVER) — falling back to dry-run');
    await workflowEngine.executeWorkflow('major-incident-response', {
      signalId: signal.id,
      severity: signal.severity,
      asset: signal.asset,
      payload: signal.payload,
      dryRun: true,
      signal,
      triggerDecision: decision,
    });
    return;
  }

  try {
    await createApproval({
      title: `Run major-incident-response for ${signal.asset || signal.id}?`,
      description:
        `Alex proposes running the major-incident-response workflow.\n\n` +
        `- Source: ${signal.source}\n` +
        `- Severity: ${signal.severity}\n` +
        `- Asset: ${signal.asset || '(unknown)'}\n` +
        `- Effective confidence: ${decision.effectiveConfidence.toFixed(2)}\n` +
        `- Reason: ${decision.reason}\n\n` +
        `Approving will run the full workflow against the source-of-truth systems.`,
      requestedBy: 'alex.itsm-operations',
      approvers: [approver],
      category: 'incident',
      priority: 'urgent',
      metadata: {
        signalId: signal.id,
        workflowId: 'major-incident-response',
        triggerMode: decision.mode,
      },
    });
    await auditTriggerOutcome('major-incident-response', signal, decision, 'proposed');
  } catch (err) {
    console.error('[Subscriptions] propose-mode approval card failed:', err);
  }
}

async function auditTriggerOutcome(
  workflowId: string,
  signal: Signal,
  decision: TriggerDecision,
  outcome: 'suppressed' | 'notify-only' | 'proposed',
): Promise<void> {
  await logAuditEntry({
    workerId: 'workflow-subscriptions',
    workerName: 'Workflow Subscriptions',
    toolName: `trigger.${outcome}`,
    riskLevel: 'notify',
    triggeredBy: signal.source,
    triggerType: 'escalation',
    parameters: JSON.stringify({
      workflowId,
      signalId: signal.id,
      severity: signal.severity,
      mode: decision.mode,
      effectiveConfidence: decision.effectiveConfidence,
      reason: decision.reason,
    }),
    resultSummary: `${workflowId} ${outcome}`,
    requiredConfirmation: false,
    durationMs: 0,
  }).catch(() => {});
}
