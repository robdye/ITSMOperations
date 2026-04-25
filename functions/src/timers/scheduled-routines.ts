/**
 * Timer-triggered functions replacing node-cron scheduled routines.
 * Each timer calls the digital worker's API to execute the routine.
 */

import { app, Timer, InvocationContext } from '@azure/functions';

const WORKER_URL = process.env.DIGITAL_WORKER_URL || 'http://localhost:3978';

async function callWorkerRoutine(routineId: string, prompt: string, context: InvocationContext): Promise<void> {
  context.log(`[Timer] Running routine: ${routineId}`);
  try {
    const res = await fetch(`${WORKER_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt }),
    });
    if (!res.ok) {
      context.error(`[Timer] Routine ${routineId} failed: ${res.status}`);
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
    callWorkerRoutine('sla-breach-prediction', 
      'Run SLA breach prediction. Check all active SLAs at risk of breaching within 2 hours.', context),
});

// Incident Stale Check — every 4 hours
app.timer('incidentStale', {
  schedule: '0 0 */4 * * *',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('incident-stale-check',
      'Find all open incidents with no updates in 24+ hours. Flag P1/P2 stale tickets as critical.', context),
});

// Change Collision Detection — weekdays 07:00
app.timer('changeCollision', {
  schedule: '0 0 7 * * 1-5',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('change-collision-check',
      'Run change collision detection for the next 48 hours.', context),
});

// Monday CAB Prep — Monday 07:00
app.timer('cabPrep', {
  schedule: '0 0 7 * * 1',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('monday-cab-prep',
      'Prepare this week\'s Change Advisory Board meeting. Generate CAB agenda.', context),
});

// Emergency Change Fast-Track — every 15 minutes
app.timer('emergencyChange', {
  schedule: '0 */15 * * * *',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('emergency-change-fast-track',
      'Check for new emergency change requests in the last 15 minutes.', context),
});

// Major Incident Bridge Check — every 5 minutes
app.timer('majorIncidentBridge', {
  schedule: '0 */5 * * * *',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('major-incident-bridge',
      'Check for new P1/P2 incidents without bridge channels.', context),
});

// Daily Ops Standup — weekdays 08:00
app.timer('dailyOps', {
  schedule: '0 0 8 * * 1-5',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('daily-ops-standup',
      'Generate the daily operations standup briefing.', context),
});

// CMDB Health Audit — daily 02:00
app.timer('cmdbHealth', {
  schedule: '0 0 2 * * *',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('cmdb-health-audit',
      'Run comprehensive CMDB health audit.', context),
});

// Post-Incident KB Capture — every hour
app.timer('kbCapture', {
  schedule: '0 0 * * * *',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('post-incident-kb-capture',
      'Find incidents resolved in the last 24 hours without KB articles and draft them.', context),
});

// SLA Breach Escalation — every 30 minutes
app.timer('slaEscalation', {
  schedule: '0 */30 * * * *',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('sla-breach-escalation',
      'Check all active tickets for approaching SLA breaches within 60 minutes.', context),
});

// Monthly Health Report — 1st of month 06:00
app.timer('monthlyReport', {
  schedule: '0 0 6 1 * *',
  handler: (timer: Timer, context: InvocationContext) =>
    callWorkerRoutine('monthly-health-report',
      'Generate comprehensive monthly ITSM health report.', context),
});
