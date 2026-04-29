/**
 * Timer-triggered functions replacing node-cron scheduled routines.
 * Each timer calls the digital worker's API to execute the routine.
 */

import { app, Timer, InvocationContext } from '@azure/functions';

const WORKER_URL = process.env.DIGITAL_WORKER_URL || 'http://localhost:3978';
const WORKER_SCHEDULED_SECRET = process.env.WORKER_SCHEDULED_SECRET || process.env.SCHEDULED_SECRET || '';

async function callWorkerRoutine(routineId: string, context: InvocationContext): Promise<void> {
  context.log(`[Timer] Running routine: ${routineId}`);
  if (!WORKER_SCHEDULED_SECRET) {
    context.error('[Timer] WORKER_SCHEDULED_SECRET (or SCHEDULED_SECRET) is not set. Cannot call /api/scheduled.');
    return;
  }

  try {
    const res = await fetch(`${WORKER_URL}/api/scheduled`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-scheduled-secret': WORKER_SCHEDULED_SECRET,
      },
      body: JSON.stringify({ routineId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      context.error(`[Timer] Routine ${routineId} failed: ${res.status} ${body}`);
    } else {
      context.log(`[Timer] Routine ${routineId} completed`);
    }
  } catch (err) {
    context.error(`[Timer] Routine ${routineId} error:`, err);
  }
}

// SLA Breach Prediction — every 30 minutes
app.timer('slaBreach', {
  schedule: '0 */30 * * * *',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('sla-breach-prediction', context),
});

// Incident Stale Check — every 4 hours
app.timer('incidentStale', {
  schedule: '0 0 */4 * * *',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('incident-stale-check', context),
});

// Change Collision Detection — weekdays 07:00
app.timer('changeCollision', {
  schedule: '0 0 7 * * 1-5',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('change-collision-check', context),
});

// Monday CAB Prep — Monday 07:00
app.timer('cabPrep', {
  schedule: '0 0 7 * * 1',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('monday-cab-prep', context),
});

// Emergency Change Fast-Track — every 15 minutes
app.timer('emergencyChange', {
  schedule: '0 */15 * * * *',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('emergency-change-fast-track', context),
});

// Major Incident Bridge Check — every 5 minutes
app.timer('majorIncidentBridge', {
  schedule: '0 */5 * * * *',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('major-incident-bridge', context),
});

// Daily Ops Standup — weekdays 08:00
app.timer('dailyOps', {
  schedule: '0 0 8 * * 1-5',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('daily-ops-standup', context),
});

// CMDB Health Audit — daily 02:00
app.timer('cmdbHealth', {
  schedule: '0 0 2 * * *',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('cmdb-health-audit', context),
});

// Post-Incident KB Capture — every hour
app.timer('kbCapture', {
  schedule: '0 0 * * * *',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('post-incident-kb-capture', context),
});

// SLA Breach Escalation — every 30 minutes
app.timer('slaEscalation', {
  schedule: '0 */30 * * * *',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('sla-breach-escalation', context),
});

// Monthly Health Report — 1st of month 06:00
app.timer('monthlyReport', {
  schedule: '0 0 6 1 * *',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('monthly-health-report', context),
});
