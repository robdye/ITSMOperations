// ITSM Operations — Autonomous Workday Loop
//
// Phase 2 of the autonomous-operator pattern. While the operating window is
// open (default 09:00–17:00 in the configured timezone), Alex wakes every
// `AUTONOMOUS_WORKDAY_INTERVAL_MINUTES` (default 25) and runs ONE cycle:
//
//   1. Compose a "what's the next most-valuable concrete action" prompt
//      grounded in current SNOW state and the recent signal-router decisions.
//   2. Hand it to the chosen worker (default `service-desk-manager`) via
//      `runWorker(...)` — same agent harness chat uses.
//   3. Record the resulting TaskRecord in an in-memory ring buffer so
//      Mission Control / Kanban / EOD can surface it.
//
// The loop is OFF by default (`AUTONOMOUS_WORKDAY_ENABLED=true` to enable)
// so existing deployments are unchanged. When ON, it complements the
// signal-router (event-driven) and scheduled-routines (cron-driven) paths
// with a slow heartbeat that picks up work nothing else routed.

import { runWorker, type PromptContext } from './agent-harness';
import { workerMap } from './worker-definitions';
import { signalRouter } from './signal-router';
import { startConversation, logTrace, logOutcome, logError } from './reasoning-trace';
import { getSnowClientStatus } from './snow-client';
import { autonomyGate } from './autonomy-gate';
import { resolveRoles } from './live-role-resolver';
import { POLICY_VERSION, type ActionRisk } from './role-policy';
import { recordEvidence } from './evidence-pack';
import { notifyManagerOnException } from './exception-reporter';

// ── Configuration ──

interface WorkdayConfig {
  enabled: boolean;
  startHour: number;
  endHour: number;
  intervalMinutes: number;
  timeZone: string;
  workerId: string;
}

function readConfig(): WorkdayConfig {
  const parseHour = (raw: string | undefined, fallback: number) => {
    const n = Number.parseInt(raw || '', 10);
    return Number.isFinite(n) && n >= 0 && n <= 23 ? n : fallback;
  };
  const parseInterval = (raw: string | undefined, fallback: number) => {
    const n = Number.parseInt(raw || '', 10);
    return Number.isFinite(n) && n >= 1 ? n : fallback;
  };
  return {
    enabled: process.env.AUTONOMOUS_WORKDAY_ENABLED === 'true',
    startHour: parseHour(process.env.AUTONOMOUS_WORKDAY_START_HOUR, 9),
    endHour: parseHour(process.env.AUTONOMOUS_WORKDAY_END_HOUR, 17),
    intervalMinutes: parseInterval(process.env.AUTONOMOUS_WORKDAY_INTERVAL_MINUTES, 25),
    timeZone: process.env.AUTONOMOUS_WORKDAY_TIME_ZONE || 'America/Los_Angeles',
    workerId: process.env.AUTONOMOUS_WORKDAY_WORKER || 'service-desk-manager',
  };
}

// ── State ──

export type WorkdayTaskStatus = 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkdayTaskRecord {
  id: string;
  cycleNumber: number;
  workerId: string;
  conversationId: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: WorkdayTaskStatus;
  prompt: string;
  output?: string;
  outputSnippet?: string;
  error?: string;
  /**
   * Lightweight reason when the cycle skipped without invoking the worker
   * (out-of-window, kill-switch, already-running, etc.).
   */
  skipReason?: string;
}

const TASK_BUFFER_LIMIT = 50;

class AutonomousWorkdayScheduler {
  private config: WorkdayConfig = readConfig();
  private timer: NodeJS.Timeout | null = null;
  private cycleCounter = 0;
  private inFlight = false;
  private tasks: WorkdayTaskRecord[] = [];
  private startedAt: string | null = null;
  private lastSummary: string | null = null;

  start(): void {
    this.config = readConfig();
    if (!this.config.enabled) {
      console.log('[AutonomousWorkday] disabled (set AUTONOMOUS_WORKDAY_ENABLED=true to enable)');
      return;
    }
    if (this.timer) {
      console.log('[AutonomousWorkday] already running');
      return;
    }
    const intervalMs = this.config.intervalMinutes * 60 * 1000;
    this.startedAt = new Date().toISOString();
    this.timer = setInterval(() => {
      this.runCycle().catch((err) => {
        console.error('[AutonomousWorkday] cycle threw:', err);
      });
    }, intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    console.log(
      `[AutonomousWorkday] started — window ${this.config.startHour}:00–${this.config.endHour}:00 ` +
        `${this.config.timeZone}, every ${this.config.intervalMinutes}min, worker=${this.config.workerId}`,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.startedAt = null;
    console.log('[AutonomousWorkday] stopped');
  }

  getState() {
    const localNow = this.formatLocalNow();
    return {
      enabled: this.config.enabled,
      running: !!this.timer,
      startedAt: this.startedAt,
      inWindow: this.isInOperatingWindow(),
      localTime: localNow.formatted,
      localHour: localNow.hour,
      cycleCount: this.cycleCounter,
      inFlight: this.inFlight,
      config: { ...this.config },
      taskCount: this.tasks.length,
      lastSummary: this.lastSummary,
      lastCompletedTask: this.tasks.find((t) => t.status === 'completed' || t.status === 'failed') || null,
    };
  }

  getTasks(limit = 25): WorkdayTaskRecord[] {
    return this.tasks.slice(0, Math.max(1, Math.min(TASK_BUFFER_LIMIT, limit)));
  }

  /**
   * Run one cycle synchronously (skips the timer). Used by the
   * `/api/workday/run-cycle` endpoint for on-demand demoing.
   */
  async runCycle(opts: { force?: boolean } = {}): Promise<WorkdayTaskRecord> {
    if (this.inFlight) {
      return this.skipCycle('already-running');
    }
    this.config = readConfig();
    if (!opts.force && !this.isInOperatingWindow()) {
      const localNow = this.formatLocalNow();
      return this.skipCycle(
        `out-of-window (${localNow.formatted} ${this.config.timeZone}; window ${this.config.startHour}:00–${this.config.endHour}:00)`,
      );
    }

    this.inFlight = true;
    const cycleNumber = ++this.cycleCounter;
    const taskId = `wd-${cycleNumber}-${Date.now()}`;
    const conversationId = startConversation();
    const startedAt = new Date().toISOString();
    const tStart = Date.now();

    const worker = workerMap.get(this.config.workerId);
    if (!worker) {
      const record: WorkdayTaskRecord = {
        id: taskId,
        cycleNumber,
        workerId: this.config.workerId,
        conversationId,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: 0,
        status: 'failed',
        prompt: '',
        error: `Worker '${this.config.workerId}' not found in workerMap`,
      };
      this.pushTask(record);
      this.inFlight = false;
      return record;
    }

    // Pattern 3 — governance check before spending the cycle on this worker.
    // Resolves the autonomous actor's live roles, infers action risk from the
    // worker's blastRadius, runs the unified autonomy-gate, and persists an
    // evidence pack. On DENY/REQUIRE_HITL we skip the cycle, notify the
    // manager, and surface the reason on the Kanban.
    const autonomousRoles = (process.env.AUTONOMOUS_WORKDAY_ROLES_CSV || 'operations-manager')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    let live;
    try {
      live = await resolveRoles({ actor: 'system:autonomous-workday', autonomousRoles });
    } catch {
      live = {
        actor: 'system:autonomous-workday',
        roles: autonomousRoles.length ? autonomousRoles : ['system'],
        source: 'fallback' as const,
        fetchedAt: Date.now(),
        ttlMs: 0,
      };
    }
    const blast = worker.blastRadius ?? 0.5;
    const actionRisk: ActionRisk = blast >= 0.66 ? 'high' : blast >= 0.33 ? 'medium' : 'low';

    const gate = autonomyGate({
      workflowId: `autonomous-workday:${worker.id}`,
      worker,
      tenantId: 'autonomous-workday',
      actor: live.actor,
      actorRoles: live.roles,
      actionRisk,
      toolName: `autonomous-workday-cycle:${worker.id}`,
      now: Date.now(),
    });

    if (gate.decision !== 'ALLOW') {
      const completedAt = new Date().toISOString();
      const skipped: WorkdayTaskRecord = {
        id: taskId,
        cycleNumber,
        workerId: this.config.workerId,
        conversationId,
        startedAt,
        completedAt,
        durationMs: Date.now() - tStart,
        status: 'skipped',
        prompt: '',
        skipReason: `gate-${gate.decision.toLowerCase()}: ${gate.reason}`,
      };
      this.pushTask(skipped);
      this.inFlight = false;

      logTrace({
        conversationId,
        type: 'approval',
        source: 'autonomous-workday',
        summary: `Cycle #${cycleNumber} blocked by Pattern 3 gate (${gate.decision})`,
        detail: gate.reason,
        metadata: {
          taskId,
          decision: gate.decision,
          actor: live.actor,
          roles: live.roles.join(','),
          actionRisk,
          policyVersion: POLICY_VERSION,
        },
      });

      const evidenceId = await recordEvidence({
        actor: live.actor,
        actorRoles: live.roles,
        roleSource: live.source,
        workerId: worker.id,
        requestedAction: `autonomous-workday-cycle #${cycleNumber}`,
        toolName: `autonomous-workday-cycle:${worker.id}`,
        actionRisk,
        mode: 'auto',
        gateDecision: gate.decision,
        gateReason: gate.reason,
        policyVersion: POLICY_VERSION,
        leverEngaged: gate.rolePolicy?.leverEngaged,
        verifierOutcome: 'inconclusive',
        result: { ok: false, summary: `skipped: ${gate.reason}` },
        startedAt,
        completedAt,
        durationMs: Date.now() - tStart,
        conversationId,
        executionId: taskId,
      }).catch(() => undefined);

      void notifyManagerOnException(gate.decision === 'DENY' ? 'gate-deny' : 'high-risk-hitl', {
        actor: live.actor,
        actorRoles: live.roles,
        workerId: worker.id,
        workflowId: `autonomous-workday:${worker.id}`,
        toolName: `autonomous-workday-cycle:${worker.id}`,
        actionKey: taskId,
        executionId: taskId,
        actionRisk,
        gateDecision: gate.decision,
        requiredRoles: gate.rolePolicy?.requiredRoles,
        detail: `${gate.reason}${evidenceId ? ` (evidence=${evidenceId.id})` : ''}`,
      }).catch(() => undefined);

      return skipped;
    }

    const prompt = this.buildCyclePrompt(cycleNumber);
    const record: WorkdayTaskRecord = {
      id: taskId,
      cycleNumber,
      workerId: this.config.workerId,
      conversationId,
      startedAt,
      status: 'running',
      prompt,
    };
    this.pushTask(record);

    logTrace({
      conversationId,
      type: 'intent',
      source: 'autonomous-workday',
      summary: `Workday cycle #${cycleNumber} started`,
      detail: `Worker ${this.config.workerId} — every ${this.config.intervalMinutes}min in window ${this.config.startHour}:00–${this.config.endHour}:00 ${this.config.timeZone}`,
      metadata: { taskId, cycleNumber: String(cycleNumber), workerId: this.config.workerId, force: String(!!opts.force) },
    });

    const ctx: PromptContext = {
      userMessage: prompt,
      displayName: 'System (Autonomous Workday)',
    };

    try {
      const result = await runWorker(worker, prompt, ctx, conversationId);
      record.status = 'completed';
      record.output = result.output;
      record.outputSnippet = this.snippet(result.output);
      record.completedAt = new Date().toISOString();
      record.durationMs = Date.now() - tStart;
      this.lastSummary = record.outputSnippet || null;
      logOutcome(
        conversationId,
        worker.id,
        `Workday cycle #${cycleNumber} completed (${result.output.length} chars)`,
        record.durationMs,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      record.status = 'failed';
      record.error = msg;
      record.completedAt = new Date().toISOString();
      record.durationMs = Date.now() - tStart;
      logError(conversationId, worker.id, msg);
    } finally {
      // Pattern 3 — evidence pack for the executed cycle (best-effort).
      void recordEvidence({
        actor: live.actor,
        actorRoles: live.roles,
        roleSource: live.source,
        workerId: worker.id,
        requestedAction: `autonomous-workday-cycle #${cycleNumber}`,
        toolName: `autonomous-workday-cycle:${worker.id}`,
        actionRisk,
        mode: 'auto',
        gateDecision: 'ALLOW',
        gateReason: gate.reason,
        policyVersion: POLICY_VERSION,
        verifierOutcome:
          record.status === 'completed' ? 'success' : record.status === 'failed' ? 'failure' : 'inconclusive',
        result: {
          ok: record.status === 'completed',
          summary: record.outputSnippet || record.error || record.status,
        },
        startedAt,
        completedAt: record.completedAt ?? new Date().toISOString(),
        durationMs: record.durationMs ?? Date.now() - tStart,
        conversationId,
        executionId: taskId,
      }).catch(() => undefined);
      this.inFlight = false;
    }

    return record;
  }

  /**
   * Build the "what should you do next" prompt. Grounds the worker in:
   *   - current local time
   *   - whether SNOW is configured (so it falls back gracefully when not)
   *   - the most recent N signals it might want to action
   * Asks for ONE concrete action so each cycle is a single, auditable step.
   */
  private buildCyclePrompt(cycleNumber: number): string {
    const localNow = this.formatLocalNow();
    const snow = getSnowClientStatus();
    const recentSignals = signalRouter.getRecentSignals(8);
    const recentDecisions = signalRouter.getRecentDecisions(8);

    const signalLines = recentSignals.length
      ? recentSignals
          .map(
            (s) =>
              `  - ${s.id} (${s.type}, ${s.severity}, ${s.origin}) asset=${s.asset || 'n/a'} @ ${s.occurredAt}`,
          )
          .join('\n')
      : '  (none in buffer)';
    const decisionLines = recentDecisions.length
      ? recentDecisions
          .map(
            (d) =>
              `  - signal=${d.signalId} → wf=${d.workflowId} matched=${d.matched} suppressed=${d.suppressedReason || ''}`,
          )
          .join('\n')
      : '  (none in buffer)';

    return [
      `Autonomous workday cycle #${cycleNumber} — local time ${localNow.formatted} (${this.config.timeZone}).`,
      `Window: ${this.config.startHour}:00–${this.config.endHour}:00 every ${this.config.intervalMinutes}min.`,
      `SNOW: ${snow.enabled ? `connected (${snow.instance})` : `NOT configured — missing ${snow.missing.join(', ')}`}.`,
      '',
      'Recent signals (8):',
      signalLines,
      '',
      'Recent routing decisions (8):',
      decisionLines,
      '',
      'Your job in this cycle:',
      '  1. Pick the ONE most urgent, concrete action that moves real ITSM work forward — favor: open P1/P2 incidents lacking progress, breach-imminent SLAs, blocked changes near CAB, problem records lacking RCA, or unhandled signals above.',
      '  2. Use your MCP tools to do it for real (read first, then write — work note, state change, escalation, KB stub, etc.).',
      '  3. After acting, verify by re-reading the affected record.',
      '  4. Respond with a 3-sentence summary: what you picked, what you did, what you verified.',
      '',
      'Rules:',
      '  - Exactly ONE concrete action per cycle.',
      '  - If nothing genuinely needs action, say so explicitly and stop (do not invent work).',
      '  - Never auto-execute a high-blast-radius write without HITL — defer to approval queue.',
      '  - Always include the SNOW record number/sysId in your summary so the audit trail can verify.',
    ].join('\n');
  }

  // ── helpers ──

  private skipCycle(reason: string): WorkdayTaskRecord {
    const record: WorkdayTaskRecord = {
      id: `wd-skip-${Date.now()}`,
      cycleNumber: this.cycleCounter,
      workerId: this.config.workerId,
      conversationId: '',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 0,
      status: 'skipped',
      prompt: '',
      skipReason: reason,
    };
    this.pushTask(record);
    return record;
  }

  private pushTask(record: WorkdayTaskRecord): void {
    // newest-first
    this.tasks.unshift(record);
    if (this.tasks.length > TASK_BUFFER_LIMIT) {
      this.tasks.length = TASK_BUFFER_LIMIT;
    }
  }

  private isInOperatingWindow(): boolean {
    const { hour } = this.formatLocalNow();
    // [start, end) — 09:00–17:00 means 9..16 inclusive.
    const { startHour, endHour } = this.config;
    if (startHour === endHour) return false;
    if (startHour < endHour) return hour >= startHour && hour < endHour;
    // wraps midnight (e.g. 22 → 04)
    return hour >= startHour || hour < endHour;
  }

  private formatLocalNow(): { formatted: string; hour: number } {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: this.config.timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        weekday: 'short',
        month: 'short',
        day: '2-digit',
      }).formatToParts(new Date());
      const map: Record<string, string> = {};
      for (const p of parts) map[p.type] = p.value;
      const hourStr = map.hour || '00';
      const hour = Number.parseInt(hourStr, 10) || 0;
      const formatted = `${map.weekday || ''} ${map.month || ''} ${map.day || ''} ${hourStr}:${map.minute || '00'}`.trim();
      return { formatted, hour };
    } catch {
      const d = new Date();
      return { formatted: d.toISOString(), hour: d.getUTCHours() };
    }
  }

  private snippet(s: string, max = 240): string {
    const trimmed = s.replace(/\s+/g, ' ').trim();
    return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
  }
}

export const autonomousWorkday = new AutonomousWorkdayScheduler();

export function startAutonomousWorkday(): void {
  autonomousWorkday.start();
}
export function stopAutonomousWorkday(): void {
  autonomousWorkday.stop();
}
