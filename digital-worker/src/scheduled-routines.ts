// ITSM Operations — Scheduled Worker Routines
// CorpGen pattern: each ITIL worker runs autonomous tasks on a schedule.
// All routines are read-heavy (dashboards, analysis) with notifications
// going through the HITL confirmation flow for write operations.

import cron from 'node-cron';
import { runWorker, type PromptContext } from './agent-harness';
import {
  incidentManager,
  changeManager,
  problemManager,
  assetCmdbManager,
  slaManager,
  knowledgeManager,
  vendorManager,
} from './worker-definitions';

// ── Routine Definition ──

interface ScheduledRoutine {
  id: string;
  worker: string;
  schedule: string;  // cron expression
  description: string;
  prompt: string;
  enabled: boolean;
}

// ── Routine Registry ──

const routines: ScheduledRoutine[] = [
  // ── Incident Manager ──
  {
    id: 'incident-stale-check',
    worker: 'incident-manager',
    schedule: '0 */4 * * *',  // Every 4 hours
    description: 'Check for stale incidents with no updates in 24+ hours',
    prompt: 'Run a stale incident check. Find all open incidents that have had no updates in the last 24 hours. For each stale incident, report: ticket number, priority, age, assigned group, last update time. Flag any P1/P2 stale tickets as critical. Provide a summary with recommended actions.',
    enabled: true,
  },
  {
    id: 'incident-recurring-pattern',
    worker: 'incident-manager',
    schedule: '0 6 * * 1',  // Monday 06:00
    description: 'Weekly recurring incident pattern analysis',
    prompt: 'Analyze incident patterns from the past 7 days. Identify CIs with 3 or more incidents (recurring pattern). For each recurring pattern: list the CI, incident count, categories, and recommend whether a problem record should be created. Provide a weekly incident trend summary.',
    enabled: true,
  },
  // ── SLA Manager ──
  {
    id: 'sla-breach-prediction',
    worker: 'sla-manager',
    schedule: '*/30 * * * *',  // Every 30 minutes
    description: 'Predict SLA breaches within the next 2 hours',
    prompt: 'Run SLA breach prediction. Check all active SLAs and identify any that are at risk of breaching within the next 2 hours based on current resolution progress. For each at-risk SLA: report ticket number, SLA type, time remaining, current assignment. Recommend immediate escalation actions.',
    enabled: true,
  },
  // ── Change Manager ──
  {
    id: 'change-collision-check',
    worker: 'change-manager',
    schedule: '0 7 * * 1-5',  // Weekdays 07:00
    description: 'Daily change collision and conflict detection',
    prompt: 'Run change collision detection for the next 48 hours. Identify any overlapping maintenance windows, same-CI conflicts, or resource contention. For each collision: report the change numbers, affected CIs, maintenance windows, and risk. Recommend rescheduling actions.',
    enabled: true,
  },
  {
    id: 'change-pir-overdue',
    worker: 'change-manager',
    schedule: '0 9 * * 3',  // Wednesday 09:00
    description: 'Check for overdue post-implementation reviews',
    prompt: 'Check for changes that were closed more than 5 business days ago but have no post-implementation review. List each overdue PIR with: change number, close date, days overdue, change type. Emergency changes without PIR should be flagged as critical.',
    enabled: true,
  },
  // ── Vendor Manager ──
  {
    id: 'vendor-contract-expiry',
    worker: 'vendor-manager',
    schedule: '0 8 * * 1',  // Monday 08:00
    description: 'Weekly contract expiry check (30/60/90 day windows)',
    prompt: 'Run a contract expiry review. Check all vendor contracts and identify those expiring within 30, 60, and 90 days. For each expiring contract: report vendor name, contract ID, expiry date, annual value, and associated assets. Categorize urgency: Critical (<30 days), Warning (<60 days), Planning (<90 days). Recommend renewal or replacement actions.',
    enabled: true,
  },
  {
    id: 'vendor-license-compliance',
    worker: 'vendor-manager',
    schedule: '0 8 1 * *',  // 1st of month 08:00
    description: 'Monthly license compliance audit',
    prompt: 'Run a software license compliance audit. Compare entitled license counts against installed/deployed counts for all tracked software. Flag over-deployed licenses (compliance risk) and under-utilized licenses (cost savings opportunity). Provide a compliance summary with recommended actions.',
    enabled: true,
  },
  // ── Knowledge Manager ──
  {
    id: 'knowledge-gap-analysis',
    worker: 'knowledge-manager',
    schedule: '0 7 * * 5',  // Friday 07:00
    description: 'Weekly KB gap analysis against incident categories',
    prompt: 'Run a knowledge base gap analysis. Compare incident categories from the past 30 days against existing KB articles. Identify high-volume incident categories with no matching KB articles. For each gap: report the category, incident count, and estimated self-service deflection potential. Prioritize article creation recommendations by incident volume.',
    enabled: true,
  },
  // ── Asset & CMDB Manager ──
  {
    id: 'asset-eol-scan',
    worker: 'asset-cmdb-manager',
    schedule: '0 6 1 * *',  // 1st of month 06:00
    description: 'Monthly EOL/EOS asset lifecycle scan',
    prompt: 'Run an asset lifecycle scan. Check all CMDB configuration items for end-of-life and end-of-support status. Classify each: GREEN (supported), YELLOW (within 12 months of EOL), RED (post-EOL, non-compliant). For RED assets: recommend immediate remediation. For YELLOW: recommend proactive change proposals. Provide an executive summary with counts per category.',
    enabled: true,
  },
  {
    id: 'asset-warranty-check',
    worker: 'asset-cmdb-manager',
    schedule: '0 6 15 * *',  // 15th of month 06:00
    description: 'Bi-monthly warranty expiration check',
    prompt: 'Check for hardware assets with warranties expiring in the next 90 days. For each: report asset name, type, warranty end date, and associated services. Recommend renewal or replacement planning.',
    enabled: true,
  },
  // ── Problem Manager ──
  {
    id: 'problem-kedb-review',
    worker: 'problem-manager',
    schedule: '0 9 * * 4',  // Thursday 09:00
    description: 'Weekly known error database review',
    prompt: 'Review the known error database. Check for: known errors with permanent fixes identified but no change request created, known errors with workarounds that are stale (>90 days without review), and new problem records that need root cause analysis started. Provide a prioritized action list.',
    enabled: true,
  },
];

// ── Scheduled Jobs ──

const activeJobs = new Map<string, cron.ScheduledTask>();

/**
 * Start all scheduled worker routines.
 * Call this from index.ts during server startup.
 */
export function startScheduledRoutines(): void {
  console.log(`[ScheduledRoutines] Starting ${routines.filter(r => r.enabled).length} autonomous routines...`);

  for (const routine of routines) {
    if (!routine.enabled) continue;

    const job = cron.schedule(routine.schedule, async () => {
      console.log(`[ScheduledRoutines] Running: ${routine.id} (${routine.description})`);
      try {
        const worker = getWorkerForRoutine(routine.worker);
        if (!worker) {
          console.error(`[ScheduledRoutines] Unknown worker: ${routine.worker}`);
          return;
        }

        const ctx: PromptContext = {
          userMessage: routine.prompt,
          displayName: 'System (Scheduled Routine)',
        };

        const result = await runWorker(worker, routine.prompt, ctx);
        console.log(`[ScheduledRoutines] Completed: ${routine.id} — ${result.output.substring(0, 100)}...`);

        // Log completion (audit trail will capture details)
      } catch (err) {
        console.error(`[ScheduledRoutines] Failed: ${routine.id}`, err);
      }
    });

    activeJobs.set(routine.id, job);
    console.log(`  ✓ ${routine.id}: ${routine.description} [${routine.schedule}]`);
  }
}

/**
 * Stop all scheduled routines.
 */
export function stopScheduledRoutines(): void {
  for (const [id, job] of activeJobs) {
    job.stop();
    console.log(`[ScheduledRoutines] Stopped: ${id}`);
  }
  activeJobs.clear();
}

/**
 * Get the list of all routines with their status.
 */
export function getRoutineStatus(): Array<{
  id: string;
  worker: string;
  schedule: string;
  description: string;
  enabled: boolean;
  active: boolean;
}> {
  return routines.map(r => ({
    id: r.id,
    worker: r.worker,
    schedule: r.schedule,
    description: r.description,
    enabled: r.enabled,
    active: activeJobs.has(r.id),
  }));
}

// ── Helper ──

function getWorkerForRoutine(workerId: string) {
  const workers: Record<string, any> = {
    'incident-manager': incidentManager,
    'change-manager': changeManager,
    'problem-manager': problemManager,
    'asset-cmdb-manager': assetCmdbManager,
    'sla-manager': slaManager,
    'knowledge-manager': knowledgeManager,
    'vendor-manager': vendorManager,
  };
  return workers[workerId];
}
