// ITSM Operations — Mission Control Kanban
// Derives a 5-lane "what is Alex actually doing right now?" view from the
// existing in-memory stores. Nothing here mutates state — it's a pure
// projection used by GET /api/kanban for the Mission Control panel and by
// the End-of-Day reporter to summarize today's work.
//
// Lanes:
//   1. Queue           — signals received, not yet picked up by a workflow.
//   2. In-cycle        — workflow executions / workday cycles currently running.
//   3. Waiting         — pending approvals + executions paused for HITL.
//   4. Proof / review  — outcomes labeled 'partial' or 'inconclusive'.
//   5. Done today      — write-class audit entries + completed workflows since
//                        midnight local.
//
// Cards are intentionally small (≤ 240 char summary, top-line metadata only)
// so the UI can render a dense board without round-tripping for detail.

import { signalRouter, type Signal, type SignalRoutingDecision } from './signal-router';
import { workflowEngine, type WorkflowStatus } from './workflow-engine';
import { listPendingActions, type PendingAction } from './approval-queue';
import { getRecentOutcomes, type OutcomeRecord } from './outcome-verifier';
import { getRecentAuditEntries, type AuditEntry } from './audit-trail';
import { autonomousWorkday, type WorkdayTaskRecord } from './autonomous-workday';

// ── Card / lane types ──

export type KanbanLaneId = 'queue' | 'in-cycle' | 'waiting' | 'proof' | 'done-today';

export interface KanbanCard {
  /** Stable id so the UI can diff between polls without flicker. */
  id: string;
  laneId: KanbanLaneId;
  /** One-line headline (≤ 80 chars). */
  title: string;
  /** Optional secondary line (≤ 200 chars). */
  subtitle?: string;
  /** Source store this card was derived from. */
  source:
    | 'signal'
    | 'workflow'
    | 'workday'
    | 'approval'
    | 'outcome'
    | 'audit';
  /** Owning worker/workflow id if known. */
  workerId?: string;
  workflowId?: string;
  /** Started / observed timestamp (ISO). */
  startedAt: string;
  /** Severity hint for color coding (info | low | medium | high | critical | unknown). */
  severity?: 'info' | 'low' | 'medium' | 'high' | 'critical' | 'unknown';
  /** Optional ServiceNow record link target ('INCxxx', 'CHGxxx', …). */
  recordId?: string;
  /** Free-form metadata for the UI (kept short — no secrets). */
  meta?: Record<string, string>;
}

export interface KanbanLane {
  id: KanbanLaneId;
  label: string;
  cards: KanbanCard[];
  /** Truncation flag — UI can show "+N more". */
  truncated: boolean;
  /** Total before truncation. */
  totalCount: number;
}

export interface KanbanSnapshot {
  generatedAt: string;
  windowStartLocal: string;
  timeZone: string;
  lanes: KanbanLane[];
  totals: Record<KanbanLaneId, number>;
}

const LANE_LABELS: Record<KanbanLaneId, string> = {
  'queue': 'Queue',
  'in-cycle': 'In cycle',
  'waiting': 'Waiting / HITL',
  'proof': 'Proof / review',
  'done-today': 'Done today',
};

const DEFAULT_LANE_LIMIT = 12;

// ── Helpers ──

function snippet(s: string | undefined, max = 200): string {
  if (!s) return '';
  const trimmed = s.trim();
  return trimmed.length > max ? trimmed.slice(0, max - 1) + '…' : trimmed;
}

function timezone(): string {
  return process.env.AUTONOMOUS_WORKDAY_TIME_ZONE || 'America/Los_Angeles';
}

/** ISO timestamp for "today 00:00 local" in the configured time zone. */
function localMidnightIso(): string {
  const tz = timezone();
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    // en-CA gives YYYY-MM-DD ordering; treat midnight as UTC-aware best-effort.
    // The Intl APIs do not directly emit a TZ offset, so we encode the date
    // and rely on JS to parse it in the local-of-the-host timezone. For an
    // exact-cutoff comparison this is close enough for a UI lane filter.
    return new Date(`${map.year}-${map.month}-${map.day}T00:00:00`).toISOString();
  } catch {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
}

function recordIdFromPayload(payload: Record<string, unknown> | undefined): string | undefined {
  if (!payload) return undefined;
  const number = (payload.number || payload.incident_number || payload.recordId) as
    | string
    | undefined;
  if (typeof number === 'string' && number.trim()) return number.trim();
  return undefined;
}

function sevFromSignal(sev: Signal['severity']): KanbanCard['severity'] {
  return sev;
}

function takeWithTruncation<T>(items: T[], limit: number): { kept: T[]; truncated: boolean; total: number } {
  return { kept: items.slice(0, limit), truncated: items.length > limit, total: items.length };
}

// ── Lane derivations ──

/**
 * Signals that have been seen recently but don't yet have a matching
 * workflow execution or completed outcome. We treat "queue" as "Alex
 * has noticed it, hasn't started yet". A signal is considered started
 * once any workflow execution carries the same signalId in its context
 * OR any outcome references the same signalType in the same window.
 */
function deriveQueueLane(): KanbanLane {
  const decisions = signalRouter.getRecentDecisions(80);
  const signals = signalRouter.getRecentSignals(80);
  const executions = workflowEngine.listExecutions(120);

  // Build the set of signal ids that have already produced a workflow run.
  const startedSignalIds = new Set<string>();
  for (const ex of executions) {
    const ctxSignalId =
      (ex.context && (ex.context.signalId || ex.context.signal_id || ex.context.sid)) as string | undefined;
    if (typeof ctxSignalId === 'string') startedSignalIds.add(ctxSignalId);
  }
  // Also consider decisions that are matched + not suppressed.
  for (const d of decisions) {
    if (d.matched && !d.suppressedReason) {
      startedSignalIds.add(d.signalId);
    }
  }

  const queueSignals = signals.filter((s) => !startedSignalIds.has(s.id));
  const taken = takeWithTruncation(queueSignals, DEFAULT_LANE_LIMIT);
  const cards: KanbanCard[] = taken.kept.map((s) => ({
    id: `sig:${s.id}`,
    laneId: 'queue',
    title: `${s.type} (${s.severity})`,
    subtitle: snippet(`${s.source} • asset=${s.asset || 'n/a'}`),
    source: 'signal',
    startedAt: s.occurredAt,
    severity: sevFromSignal(s.severity),
    recordId: recordIdFromPayload(s.payload),
    meta: {
      origin: s.origin,
      forceMode: s.forceMode || '',
      correlationId: s.correlationId || '',
    },
  }));

  return {
    id: 'queue',
    label: LANE_LABELS.queue,
    cards,
    truncated: taken.truncated,
    totalCount: taken.total,
  };
}

/**
 * Workflows currently running + autonomous-workday cycles in-flight.
 * Workday cycles surface as their own cards so demo viewers can see the
 * "every-25-min heartbeat" alongside the workflow execution stream.
 */
function deriveInCycleLane(): KanbanLane {
  const executions = workflowEngine.listExecutions(60).filter((ex) => ex.status === 'running');
  const tasks = autonomousWorkday.getTasks(20).filter((t) => t.status === 'running');

  const exCards: KanbanCard[] = executions.map((ex) => ({
    id: `wf:${ex.executionId}`,
    laneId: 'in-cycle',
    title: `${ex.workflowId} • ${ex.steps.filter((s) => s.status === 'completed').length}/${ex.steps.length} steps`,
    subtitle: snippet(
      `Running since ${ex.startedAt} • current step: ${
        ex.steps.find((s) => s.status === 'running')?.stepId || 'pending'
      }`,
    ),
    source: 'workflow',
    workflowId: ex.workflowId,
    startedAt: ex.startedAt,
    severity: 'medium',
    meta: { executionId: ex.executionId },
  }));

  const taskCards: KanbanCard[] = tasks.map((t) => ({
    id: `wd:${t.id}`,
    laneId: 'in-cycle',
    title: `Workday cycle #${t.cycleNumber} • ${t.workerId}`,
    subtitle: snippet(t.prompt, 200),
    source: 'workday',
    workerId: t.workerId,
    startedAt: t.startedAt,
    severity: 'info',
    meta: { conversationId: t.conversationId },
  }));

  const combined = [...exCards, ...taskCards].sort((a, b) =>
    (b.startedAt || '').localeCompare(a.startedAt || ''),
  );
  const taken = takeWithTruncation(combined, DEFAULT_LANE_LIMIT);

  return {
    id: 'in-cycle',
    label: LANE_LABELS['in-cycle'],
    cards: taken.kept,
    truncated: taken.truncated,
    totalCount: taken.total,
  };
}

/**
 * Pending approvals + workflow executions paused waiting for HITL.
 */
function deriveWaitingLane(): KanbanLane {
  const approvals = listPendingActions(30);
  const paused = workflowEngine.listExecutions(80).filter((ex) => ex.status === 'paused');

  const approvalCards: KanbanCard[] = approvals.map((a: PendingAction) => ({
    id: `appr:${a.id}`,
    laneId: 'waiting',
    title: `${a.classification.level.toUpperCase()} • ${a.toolName}`,
    subtitle: snippet(
      `${a.workerName} → ${a.displayName} (${a.userId.slice(0, 12)}…) • requires approval`,
      200,
    ),
    source: 'approval',
    workerId: a.workerId,
    startedAt: a.createdAt.toISOString(),
    severity: a.classification.level === 'write' ? 'high' : 'medium',
    meta: { actionId: a.id, userId: a.userId },
  }));

  const pausedCards: KanbanCard[] = paused.map((ex) => ({
    id: `wf-pause:${ex.executionId}`,
    laneId: 'waiting',
    title: `${ex.workflowId} • paused`,
    subtitle: snippet(
      `Awaiting approval • step: ${
        ex.steps.find((s) => s.status === 'awaiting_approval')?.stepId || 'unknown'
      }`,
    ),
    source: 'workflow',
    workflowId: ex.workflowId,
    startedAt: ex.startedAt,
    severity: 'high',
    meta: { executionId: ex.executionId },
  }));

  const combined = [...approvalCards, ...pausedCards].sort((a, b) =>
    (b.startedAt || '').localeCompare(a.startedAt || ''),
  );
  const taken = takeWithTruncation(combined, DEFAULT_LANE_LIMIT);

  return {
    id: 'waiting',
    label: LANE_LABELS.waiting,
    cards: taken.kept,
    truncated: taken.truncated,
    totalCount: taken.total,
  };
}

/**
 * Outcomes with label !== 'success'. Operators see "did Alex really fix
 * it?" here. Newest first.
 */
function deriveProofLane(): KanbanLane {
  const outcomes: OutcomeRecord[] = getRecentOutcomes(50).filter(
    (o) => o.label === 'partial' || o.label === 'inconclusive' || o.label === 'failure',
  );
  const taken = takeWithTruncation(outcomes, DEFAULT_LANE_LIMIT);

  const cards: KanbanCard[] = taken.kept.map((o) => ({
    id: `out:${o.executionId}`,
    laneId: 'proof',
    title: `${o.workflowId} • ${o.label}${o.rolledBack ? ' (rolled back)' : ''}`,
    subtitle: snippet(
      `${o.signalType || 'n/a'} → ${o.notes || 'no notes'}`,
    ),
    source: 'outcome',
    workflowId: o.workflowId,
    startedAt: o.observedAt,
    severity: o.label === 'failure' ? 'high' : 'medium',
    meta: {
      label: o.label,
      executionId: o.executionId,
      rolledBack: String(!!o.rolledBack),
    },
  }));

  return {
    id: 'proof',
    label: LANE_LABELS.proof,
    cards,
    truncated: taken.truncated,
    totalCount: taken.total,
  };
}

/**
 * Write-class audit entries since local midnight + completed workflow
 * executions since local midnight + completed workday tasks since local
 * midnight. Newest first.
 */
function deriveDoneTodayLane(): KanbanLane {
  const cutoffMs = new Date(localMidnightIso()).getTime();
  const audits = getRecentAuditEntries(200).filter(
    (a: AuditEntry) =>
      (a.riskLevel === 'write' || a.riskLevel === 'notify') &&
      new Date(a.timestamp).getTime() >= cutoffMs,
  );
  const completedExecs = workflowEngine.listExecutions(120).filter(
    (ex) =>
      ex.status === 'completed' &&
      ex.completedAt &&
      new Date(ex.completedAt).getTime() >= cutoffMs,
  );
  const completedTasks = autonomousWorkday.getTasks(50).filter(
    (t: WorkdayTaskRecord) =>
      t.status === 'completed' &&
      t.completedAt &&
      new Date(t.completedAt).getTime() >= cutoffMs,
  );

  const auditCards: KanbanCard[] = audits.map((a) => ({
    id: `aud:${a.partitionKey}:${a.rowKey}`,
    laneId: 'done-today',
    title: `${a.toolName} (${a.riskLevel})`,
    subtitle: snippet(`${a.workerName} • triggered by ${a.triggeredBy} • ${a.durationMs}ms`),
    source: 'audit',
    workerId: a.workerId,
    startedAt: a.timestamp,
    severity: a.riskLevel === 'write' ? 'medium' : 'info',
    meta: {
      requiredConfirmation: String(!!a.requiredConfirmation),
      approved: a.approved === undefined ? '' : String(!!a.approved),
    },
  }));

  const execCards: KanbanCard[] = completedExecs.map((ex) => ({
    id: `wf-done:${ex.executionId}`,
    laneId: 'done-today',
    title: `${ex.workflowId} • completed`,
    subtitle: snippet(`${ex.steps.length} steps • ${ex.startedAt} → ${ex.completedAt}`),
    source: 'workflow',
    workflowId: ex.workflowId,
    startedAt: ex.completedAt || ex.startedAt,
    severity: 'info',
    meta: { executionId: ex.executionId },
  }));

  const taskCards: KanbanCard[] = completedTasks.map((t) => ({
    id: `wd-done:${t.id}`,
    laneId: 'done-today',
    title: `Workday cycle #${t.cycleNumber} • ${t.workerId}`,
    subtitle: snippet(t.outputSnippet || t.output || t.prompt, 200),
    source: 'workday',
    workerId: t.workerId,
    startedAt: t.completedAt || t.startedAt,
    severity: 'info',
    meta: {
      conversationId: t.conversationId,
      durationMs: String(t.durationMs ?? 0),
    },
  }));

  const combined = [...auditCards, ...execCards, ...taskCards].sort((a, b) =>
    (b.startedAt || '').localeCompare(a.startedAt || ''),
  );
  const taken = takeWithTruncation(combined, DEFAULT_LANE_LIMIT * 2);

  return {
    id: 'done-today',
    label: LANE_LABELS['done-today'],
    cards: taken.kept,
    truncated: taken.truncated,
    totalCount: taken.total,
  };
}

// ── Public API ──

/**
 * Compute the full Kanban snapshot. Cheap (only reads in-memory stores).
 * UI may poll this every 5–15 s.
 */
export function getKanbanSnapshot(): KanbanSnapshot {
  const lanes: KanbanLane[] = [
    deriveQueueLane(),
    deriveInCycleLane(),
    deriveWaitingLane(),
    deriveProofLane(),
    deriveDoneTodayLane(),
  ];

  const totals: Record<KanbanLaneId, number> = {
    'queue': 0,
    'in-cycle': 0,
    'waiting': 0,
    'proof': 0,
    'done-today': 0,
  };
  for (const ln of lanes) totals[ln.id] = ln.totalCount;

  return {
    generatedAt: new Date().toISOString(),
    windowStartLocal: localMidnightIso(),
    timeZone: timezone(),
    lanes,
    totals,
  };
}

/**
 * Compact summary used by the End-of-Day report — just the counts plus
 * the top 5 cards of "Done today" so a manager sees what landed without
 * needing to open the UI.
 */
export function getEndOfDaySummary(): {
  generatedAt: string;
  timeZone: string;
  totals: Record<KanbanLaneId, number>;
  doneToday: KanbanCard[];
  proofReview: KanbanCard[];
  waiting: KanbanCard[];
} {
  const snap = getKanbanSnapshot();
  const lane = (id: KanbanLaneId) => snap.lanes.find((l) => l.id === id)?.cards || [];
  return {
    generatedAt: snap.generatedAt,
    timeZone: snap.timeZone,
    totals: snap.totals,
    doneToday: lane('done-today').slice(0, 5),
    proofReview: lane('proof').slice(0, 5),
    waiting: lane('waiting').slice(0, 5),
  };
}
