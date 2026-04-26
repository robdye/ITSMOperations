// ITSM Operations — Scheduled Worker Routines
// CorpGen pattern: each ITIL worker runs autonomous tasks on a schedule.
// All routines are read-heavy (dashboards, analysis) with notifications
// going through the HITL confirmation flow for write operations.

import { runWorker, type PromptContext } from './agent-harness';
import {
  incidentManager,
  changeManager,
  problemManager,
  assetCmdbManager,
  slaManager,
  knowledgeManager,
  vendorManager,
  monitoringManager,
  continuityManager,
  reportingManager,
  securityManager,
} from './worker-definitions';

// ── Routine Definition ──

interface ScheduledRoutine {
  id: string;
  worker: string;
  schedule: string;  // cron expression (kept for documentation / Durable Functions timer config)
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
  // ── Autonomous Workflow Routines ──
  {
    id: 'monday-cab-prep',
    worker: 'change-manager',
    schedule: '0 7 * * 1',  // Monday 07:00
    description: 'Monday CAB prep: query upcoming changes, generate packs, send calendar invites',
    prompt: 'Prepare for this week\'s Change Advisory Board meeting. Query all changes scheduled for the upcoming week that require CAB review. For each change: generate a CAB review pack with risk assessment, impact analysis, and implementation plan summary. Create a consolidated CAB agenda listing all changes by risk level. Send calendar invites for the CAB meeting and post the agenda to the IT Operations Teams channel.',
    enabled: true,
  },
  {
    id: 'emergency-change-fast-track',
    worker: 'change-manager',
    schedule: '*/15 * * * *',  // Every 15 minutes
    description: 'Check for emergency changes and fast-track approval flow',
    prompt: 'Check for any new emergency change requests submitted in the last 15 minutes. For each emergency change: validate the emergency justification, perform rapid risk assessment, identify the emergency CAB approvers, and initiate the fast-track approval flow. Flag any that lack proper justification for manual review. Report the status of all active emergency changes.',
    enabled: true,
  },
  {
    id: 'major-incident-bridge',
    worker: 'incident-manager',
    schedule: '*/5 * * * *',  // Every 5 minutes
    description: 'Check for new P1/P2 incidents and auto-spin incident bridge',
    prompt: 'Check for any new P1 or P2 incidents created in the last 5 minutes that do not yet have a Teams incident bridge channel. For each: create a Teams incident bridge channel, notify key stakeholders and resolver groups, post initial incident details and impact assessment to the bridge. Also check existing major incident bridges for incidents that have been resolved and flag them for closure.',
    enabled: true,
  },
  {
    id: 'daily-ops-standup',
    worker: 'reporting-manager',
    schedule: '0 8 * * 1-5',  // Weekdays 08:00
    description: 'Generate daily ops briefing across all practice areas',
    prompt: 'Generate the daily operations standup briefing. Include: overnight incident summary (any P1/P2 incidents, new incidents, resolved incidents), active problem investigations, changes scheduled for today and tomorrow, SLA compliance snapshot, any vendor alerts or contract milestones, and CMDB health indicators. Format as a concise executive briefing suitable for the morning ops standup. Post to the IT Operations Teams channel.',
    enabled: true,
  },
  {
    id: 'incident-to-problem-promotion',
    worker: 'problem-manager',
    schedule: '0 */2 * * *',  // Every 2 hours
    description: 'Detect repeat incidents and auto-create problem records',
    prompt: 'Analyze incidents from the past 30 days to detect recurring patterns. Identify CIs, categories, or services with 3 or more related incidents. For each pattern found: check if a problem record already exists. If not, recommend creating a new problem record. Link all related incidents, assign a root cause analysis owner, and set a target investigation date. Provide a summary of new problems created and existing problems updated.',
    enabled: true,
  },
  {
    id: 'cmdb-health-audit',
    worker: 'asset-cmdb-manager',
    schedule: '0 2 * * *',  // Daily 02:00
    description: 'Daily CMDB completeness and accuracy audit',
    prompt: 'Run a comprehensive CMDB health audit. Check for: CIs with missing mandatory attributes (owner, support group, criticality), orphaned CIs with no relationships, CIs not updated in 90+ days, duplicate CI entries, CIs referenced in active incidents or changes but marked as retired, and relationship integrity (broken parent-child or dependency links). Calculate overall CMDB health score as a percentage. Provide a prioritized remediation list.',
    enabled: true,
  },
  {
    id: 'sla-breach-escalation',
    worker: 'sla-manager',
    schedule: '*/30 * * * *',  // Every 30 minutes
    description: 'Check approaching SLA breaches and trigger escalation workflows',
    prompt: 'Check all active tickets for approaching SLA breaches. Identify tickets that will breach within the next 60 minutes based on current progress. For each at-risk ticket: determine the appropriate escalation level, notify the assigned group and their manager, update the ticket priority if warranted. Also check for tickets that have already breached and ensure escalation has been triggered. Check if any breaches are part of a systemic pattern affecting a specific service or CI.',
    enabled: true,
  },
  {
    id: 'post-incident-kb-capture',
    worker: 'knowledge-manager',
    schedule: '0 * * * *',  // Every hour
    description: 'Find recently resolved incidents without KB articles and draft them',
    prompt: 'Find incidents resolved in the last 24 hours that do not have a linked knowledge base article. For each: analyze the incident resolution notes, categorize the knowledge type (how-to, troubleshooting, known error workaround), draft a knowledge base article with: symptom description, root cause, step-by-step resolution, and prevention tips. Submit the draft articles for review. Prioritize incidents that match common categories or affect multiple users.',
    enabled: true,
  },
  {
    id: 'monthly-health-report',
    worker: 'reporting-manager',
    schedule: '0 6 1 * *',  // 1st of month 06:00
    description: 'Generate monthly ITSM health report and distribute to stakeholders',
    prompt: 'Generate the comprehensive monthly ITSM health report for the previous month. Include: executive summary with key achievements and concerns, incident management KPIs (volume, MTTR, SLA compliance, recurring patterns), change management KPIs (success rate, emergency change ratio, PIR completion), problem management KPIs (backlog age, RCA completion rate, known error resolution), asset and CMDB health metrics, SLA performance across all services, knowledge base growth and utilization, vendor performance scorecard. Provide trend analysis comparing to the previous 3 months. Distribute the report to IT leadership and service owners.',
    enabled: true,
  },
];

// ── Routine Execution ──
// Routines are now triggered externally by Azure Durable Functions timer triggers
// via HTTP POST to /api/scheduled with { routineId }. No in-process cron needed.

/**
 * Start scheduled routines (no-op — scheduling is handled by Durable Functions).
 * Kept for backwards compatibility; logs the registered routines.
 */
export function startScheduledRoutines(): void {
  const enabled = routines.filter(r => r.enabled);
  console.log(`[ScheduledRoutines] ${enabled.length} routines registered (triggered externally via /api/scheduled)`);
  for (const routine of enabled) {
    console.log(`  ✓ ${routine.id}: ${routine.description} [${routine.schedule}]`);
  }
}

/**
 * Stop all scheduled routines (no-op — no in-process cron jobs to stop).
 */
export function stopScheduledRoutines(): void {
  console.log('[ScheduledRoutines] No in-process jobs to stop (scheduling is external)');
}

/**
 * Execute a single routine by ID.
 * Called from the /api/scheduled endpoint when Durable Functions timers fire.
 */
export async function executeRoutine(routineId: string): Promise<{ id: string; output: string }> {
  const routine = routines.find(r => r.id === routineId);
  if (!routine) {
    throw new Error(`Unknown routine: ${routineId}`);
  }
  if (!routine.enabled) {
    throw new Error(`Routine is disabled: ${routineId}`);
  }

  console.log(`[ScheduledRoutines] Running: ${routine.id} (${routine.description})`);
  const worker = getWorkerForRoutine(routine.worker);
  if (!worker) {
    throw new Error(`Unknown worker: ${routine.worker}`);
  }

  const ctx: PromptContext = {
    userMessage: routine.prompt,
    displayName: 'System (Scheduled Routine)',
  };

  const result = await runWorker(worker, routine.prompt, ctx);
  console.log(`[ScheduledRoutines] Completed: ${routine.id} — ${result.output.substring(0, 100)}...`);
  return { id: routine.id, output: result.output };
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
  status: string;
}> {
  return routines.map(r => ({
    id: r.id,
    worker: r.worker,
    schedule: r.schedule,
    description: r.description,
    enabled: r.enabled,
    active: r.enabled,
    status: r.enabled ? 'scheduled' : 'disabled',
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
    'monitoring-manager': monitoringManager,
    'continuity-manager': continuityManager,
    'reporting-manager': reportingManager,
    'security-manager': securityManager,
  };
  return workers[workerId];
}
