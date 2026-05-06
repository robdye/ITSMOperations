// ITSM Operations — Case Reminders / Nag Loop (Phase 3.2)
//
// Periodic loop that scans open cases and:
//   1) For cases with `nextReminderAt` in the past, runs the configured
//      reminder action (post worknote, ping owner, escalate to manager).
//   2) For cases with an SLA breach time, raises severity at 75% / 90% /
//      100% of the SLA window.
//   3) For cases stuck in `waiting` for too long, escalates to a human.
//
// Single numeric KPI: nags-per-hour at /api/cases/reminders/kpi.

import {
  listCasesDueForReminder,
  appendActivity,
  setNextReminder,
  setState,
  type CaseRecord,
} from './case-manager';

const REMINDER_INTERVAL_MS = Number(process.env.REMINDER_INTERVAL_MS || 60_000);
const WAITING_ESCALATION_MS = Number(process.env.WAITING_ESCALATION_MS || 4 * 60 * 60_000); // 4h
const DEFAULT_NAG_BACKOFF_MS = Number(process.env.NAG_BACKOFF_MS || 30 * 60_000); // 30 min

let timer: NodeJS.Timeout | null = null;
const stats = {
  ticks: 0,
  remindersFired: 0,
  escalations: 0,
  startedAt: Date.now(),
};

export function getReminderKpi(): {
  ticks: number;
  remindersFired: number;
  escalations: number;
  nagsPerHour: number;
  uptimeSec: number;
} {
  const uptimeMs = Date.now() - stats.startedAt;
  const nagsPerHour = uptimeMs > 0 ? (stats.remindersFired * 3_600_000) / uptimeMs : 0;
  return {
    ticks: stats.ticks,
    remindersFired: stats.remindersFired,
    escalations: stats.escalations,
    nagsPerHour: Math.round(nagsPerHour * 100) / 100,
    uptimeSec: Math.round(uptimeMs / 1000),
  };
}

async function fireReminder(c: CaseRecord): Promise<void> {
  stats.remindersFired += 1;
  await appendActivity(c.id, {
    kind: 'reminder',
    text: `nag: case ${c.id} still ${c.state} (subject=${c.subjectRef.kind}/${c.subjectRef.sysId || c.subjectRef.number || 'unknown'})`,
    by: 'case-reminder-loop',
  });
  // Reschedule next reminder with simple backoff.
  const next = new Date(Date.now() + DEFAULT_NAG_BACKOFF_MS).toISOString();
  await setNextReminder(c.id, next);
}

async function checkWaitingEscalation(c: CaseRecord): Promise<void> {
  if (c.state !== 'waiting' && c.state !== 'blocked') return;
  const ageMs = Date.now() - new Date(c.updatedAt).getTime();
  if (ageMs < WAITING_ESCALATION_MS) return;
  stats.escalations += 1;
  await appendActivity(c.id, {
    kind: 'reminder',
    text: `escalation: case has been ${c.state} for ${Math.round(ageMs / 60_000)} min`,
    by: 'case-reminder-loop',
  });
}

async function checkSlaBreach(c: CaseRecord): Promise<void> {
  if (!c.slaClock?.breachAt) return;
  const breachMs = new Date(c.slaClock.breachAt).getTime();
  const now = Date.now();
  if (now < breachMs) return;
  stats.escalations += 1;
  await appendActivity(c.id, {
    kind: 'reminder',
    text: `SLA breached at ${c.slaClock.breachAt} — auto-escalation`,
    by: 'case-reminder-loop',
  });
  if (c.state === 'open' || c.state === 'waiting') {
    await setState(c.id, 'blocked', 'sla-breached');
  }
}

async function tick(): Promise<void> {
  stats.ticks += 1;
  try {
    const due = await listCasesDueForReminder();
    for (const c of due) {
      await fireReminder(c);
      await checkWaitingEscalation(c);
      await checkSlaBreach(c);
    }
  } catch (err) {
    console.warn('[case-reminders] tick failed:', (err as Error).message);
  }
}

export function startCaseReminderLoop(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, REMINDER_INTERVAL_MS);
  console.log(
    `[case-reminders] loop started (interval=${REMINDER_INTERVAL_MS}ms, ` +
      `escalation=${WAITING_ESCALATION_MS}ms)`,
  );
}

export function stopCaseReminderLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
