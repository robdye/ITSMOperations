// ITSM Operations — Meta-Monitor (Phase 3.5)
//
// Watches Alex herself. Periodically inspects:
//   - Outcome failure rate across recent outcomes.
//   - Suppression rate at the trigger policy.
//   - Reviewer-block rate.
//   - Reminder/nag escalation rate.
//
// When any of these crosses a threshold for N consecutive ticks, the
// meta-monitor:
//   1) Posts an audit row at riskLevel='block' with kind='meta-alert'.
//   2) Optionally engages the kill-switch (if META_AUTO_KILL=true).
//   3) Surfaces the alert at /api/meta/alerts.
//
// Single numeric KPI: alerts_per_hour.

import { logAuditEntry } from './audit-trail';
import { getRecentOutcomes } from './outcome-verifier';
import { getReviewerKpi } from './reviewer-worker';
import { getReminderKpi } from './case-reminders';
import { engageKillSwitch, isKillSwitchEngaged } from './governance';

export interface MetaAlert {
  id: string;
  kind: 'high-failure-rate' | 'high-suppression-rate' | 'high-block-rate' | 'high-escalation-rate' | 'trust_score_low';
  severity: 'warning' | 'critical';
  detail: string;
  metrics: Record<string, number>;
  raisedAt: string;
}

const META_INTERVAL_MS = Number(process.env.META_MONITOR_INTERVAL_MS || 5 * 60_000);
const FAIL_RATE_THRESHOLD = Number(process.env.META_FAIL_RATE_THRESHOLD || 0.4); // 40% of last 20 outcomes
const BLOCK_RATE_THRESHOLD = Number(process.env.META_BLOCK_RATE_THRESHOLD || 0.6); // 60% of reviews
const ESCALATION_PER_HOUR_THRESHOLD = Number(process.env.META_ESCALATION_THRESHOLD || 10);
const CONSECUTIVE_TICKS_FOR_CRITICAL = 3;
const META_AUTO_KILL = (process.env.META_AUTO_KILL || 'false').toLowerCase() === 'true';

const alerts: MetaAlert[] = [];
const consecutiveTicksByKind = new Map<MetaAlert['kind'], number>();
let timer: NodeJS.Timeout | null = null;
const stats = {
  ticks: 0,
  alertsRaised: 0,
  killTriggered: 0,
  startedAt: Date.now(),
};

export function getMetaMonitorKpi(): {
  ticks: number;
  alertsRaised: number;
  killTriggered: number;
  alertsPerHour: number;
  uptimeSec: number;
} {
  const uptimeMs = Date.now() - stats.startedAt;
  const alertsPerHour = uptimeMs > 0 ? (stats.alertsRaised * 3_600_000) / uptimeMs : 0;
  return {
    ticks: stats.ticks,
    alertsRaised: stats.alertsRaised,
    killTriggered: stats.killTriggered,
    alertsPerHour: Math.round(alertsPerHour * 100) / 100,
    uptimeSec: Math.round(uptimeMs / 1000),
  };
}

export function getRecentMetaAlerts(limit = 20): MetaAlert[] {
  return alerts.slice(-limit).reverse();
}

async function raiseAlert(
  kind: MetaAlert['kind'],
  detail: string,
  metrics: Record<string, number>,
): Promise<void> {
  const ticks = (consecutiveTicksByKind.get(kind) ?? 0) + 1;
  consecutiveTicksByKind.set(kind, ticks);
  const severity: MetaAlert['severity'] = ticks >= CONSECUTIVE_TICKS_FOR_CRITICAL ? 'critical' : 'warning';
  const alert: MetaAlert = {
    id: `meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    severity,
    detail,
    metrics,
    raisedAt: new Date().toISOString(),
  };
  alerts.push(alert);
  if (alerts.length > 100) alerts.shift();
  stats.alertsRaised += 1;
  await logAuditEntry({
    workerId: 'meta-monitor',
    workerName: 'Meta Monitor',
    toolName: `meta-alert.${kind}`,
    riskLevel: 'block',
    triggeredBy: 'meta-monitor-tick',
    triggerType: 'scheduled',
    parameters: JSON.stringify(metrics),
    resultSummary: `${severity}: ${detail}`,
    requiredConfirmation: false,
    durationMs: 0,
  }).catch(() => {});

  if (severity === 'critical' && META_AUTO_KILL && !isKillSwitchEngaged()) {
    stats.killTriggered += 1;
    try {
      engageKillSwitch('meta-monitor', `${kind} critical (${detail})`);
      console.warn(`[meta-monitor] kill-switch engaged due to ${kind}`);
    } catch (err) {
      console.error('[meta-monitor] kill-switch engage failed:', (err as Error).message);
    }
  }
}

function clearAlertKind(kind: MetaAlert['kind']): void {
  consecutiveTicksByKind.set(kind, 0);
}

async function tick(): Promise<void> {
  stats.ticks += 1;
  try {
    // 1. Outcome failure rate (window: last 20 outcomes)
    const recent = getRecentOutcomes(20);
    if (recent.length >= 5) {
      const failures = recent.filter((o) => o.label === 'failure').length;
      const rate = failures / recent.length;
      if (rate >= FAIL_RATE_THRESHOLD) {
        await raiseAlert('high-failure-rate', `${(rate * 100).toFixed(0)}% failure rate in last ${recent.length} outcomes`, { rate, failures, total: recent.length });
      } else {
        clearAlertKind('high-failure-rate');
      }
    }

    // 2. Reviewer block rate
    const rev = getReviewerKpi();
    if (rev.reviews >= 5 && rev.blockRate >= BLOCK_RATE_THRESHOLD) {
      await raiseAlert('high-block-rate', `Reviewer blocking ${(rev.blockRate * 100).toFixed(0)}% of plans`, { blockRate: rev.blockRate, reviews: rev.reviews });
    } else if (rev.reviews >= 5) {
      clearAlertKind('high-block-rate');
    }

    // 3. Reminder/escalation rate
    const rem = getReminderKpi();
    if (rem.uptimeSec > 600 && rem.escalations / Math.max(1, rem.uptimeSec / 3600) >= ESCALATION_PER_HOUR_THRESHOLD) {
      await raiseAlert('high-escalation-rate', `${rem.escalations} escalations in ${Math.round(rem.uptimeSec / 60)}m`, { escalations: rem.escalations });
    } else if (rem.uptimeSec > 600) {
      clearAlertKind('high-escalation-rate');
    }
  } catch (err) {
    console.warn('[meta-monitor] tick failed:', (err as Error).message);
  }
}

export function startMetaMonitor(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, META_INTERVAL_MS);
  console.log(`[meta-monitor] started (interval=${META_INTERVAL_MS}ms, autoKill=${META_AUTO_KILL})`);
}

export function stopMetaMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Phase 2.1 — public surface for other modules (e.g. red-team-agent) to drop
 * a meta-monitor alert directly without going through the periodic tick.
 * Mirrors the internal `raiseAlert` shape but takes a simpler payload.
 */
export function recordMetaAlert(input: {
  kind: MetaAlert['kind'];
  severity: MetaAlert['severity'];
  message: string;
  details?: Record<string, unknown>;
}): void {
  const alert: MetaAlert = {
    id: `meta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    severity: input.severity,
    detail: input.message,
    metrics: {},
    raisedAt: new Date().toISOString(),
  };
  alerts.push(alert);
  if (alerts.length > 100) alerts.shift();
  stats.alertsRaised += 1;
  // Best-effort audit; ignore failures so the caller never sees a throw.
  void logAuditEntry({
    workerId: 'meta-monitor',
    workerName: 'Meta Monitor',
    toolName: `meta-alert.${input.kind}`,
    riskLevel: input.severity === 'critical' ? 'block' : 'notify',
    triggeredBy: 'recordMetaAlert',
    triggerType: 'scheduled',
    parameters: JSON.stringify(input.details || {}),
    resultSummary: `${input.severity}: ${input.message}`,
    requiredConfirmation: false,
    durationMs: 0,
  }).catch(() => {});
}
