// ITSM Operations — Foresight Engine (Pillar 3 of the Anticipatory-Alex architecture)
//
// Mines recent signals, audit-trail, and reasoning-trace to detect leading
// indicators (precursor events, anomaly patterns, CI-graph blast radius) and
// publishes *predicted* Signals back to the SignalRouter so the
// trigger-policy can decide what to do about them.
//
// This is intentionally a small, dependency-free baseline: short rolling
// windows, simple statistical thresholds, deterministic pattern rules. It
// keeps the same Signal contract as observed events so contract-equivalence
// is preserved (scripted == observed == predicted).

import { signalRouter, type Signal, type SignalSeverity } from './signal-router';
import {
  ANTICIPATORY_TABLES,
  loadRecent,
  upsertEntry,
  getBackend,
} from './anticipatory-store';

// ── Types ──

export interface ForesightConfig {
  /** How often the engine ticks, in ms. Default 60s. */
  tickMs: number;
  /** Rolling window for pattern mining, in ms. Default 30 min. */
  windowMs: number;
  /** Minimum count of related events in the window to forecast a follow-on. */
  minClusterSize: number;
  /** Confidence assigned to forecasted signals before damping. */
  baseConfidence: number;
  /** Disable on the prod tenant via env if needed. Default true. */
  enabled: boolean;
}

export const DEFAULT_FORESIGHT_CONFIG: ForesightConfig = {
  tickMs: 60 * 1000,
  windowMs: 30 * 60 * 1000,
  minClusterSize: 3,
  baseConfidence: 0.65,
  enabled: true,
};

export interface ForecastedSignal {
  signal: Signal;
  rationale: string;
  /** Source signals used to derive this forecast. */
  evidenceIds: string[];
}

// ── CI graph (lightweight, JSON-loadable) ──

export interface CINode {
  id: string;
  name?: string;
  /** Upstream dependencies — services this CI depends on. */
  dependsOn?: string[];
}

let ciGraph: Map<string, CINode> = new Map();

/** Set or replace the CI graph used for blast-radius propagation. */
export function setCIGraph(nodes: CINode[]): void {
  ciGraph = new Map(nodes.map((n) => [n.id, n]));
}

/** Returns the set of CIs that depend (directly or transitively) on the given CI. */
export function downstreamOf(ciId: string): string[] {
  const out = new Set<string>();
  for (const [id, node] of ciGraph) {
    if (id === ciId) continue;
    if ((node.dependsOn ?? []).includes(ciId)) {
      out.add(id);
      for (const sub of downstreamOf(id)) out.add(sub);
    }
  }
  return [...out];
}

// ── Engine state ──

interface Tick {
  startedAt: number;
  forecasted: ForecastedSignal[];
}

const recentForecasts: ForecastedSignal[] = [];
const MAX_FORECAST_HISTORY = 200;
let timer: NodeJS.Timeout | null = null;
let activeConfig: ForesightConfig = DEFAULT_FORESIGHT_CONFIG;
let backfilled = false;

export function getRecentForecasts(limit = 50): ForecastedSignal[] {
  return recentForecasts.slice(-limit).reverse();
}

export function getForesightBackend(): 'azure-table' | 'memory' {
  return getBackend(ANTICIPATORY_TABLES.forecasts);
}

/**
 * Cold-start backfill: load the most recent forecasts from Table Storage
 * so that restart does not erase predictive context.
 */
export async function backfillForesight(limit = MAX_FORECAST_HISTORY): Promise<number> {
  if (backfilled) return recentForecasts.length;
  backfilled = true;
  try {
    const stored = await loadRecent<ForecastedSignal>(ANTICIPATORY_TABLES.forecasts, {
      partitionKey: 'global',
      limit,
    });
    // Insert in chronological order so newest is at the tail.
    const ordered = stored.reverse();
    for (const s of ordered) {
      recentForecasts.push(s.payload);
      if (recentForecasts.length > MAX_FORECAST_HISTORY) recentForecasts.shift();
    }
    if (stored.length > 0) {
      console.log(`[Foresight] Restored ${stored.length} forecasts from Table Storage`);
    }
  } catch (err: any) {
    console.warn('[Foresight] backfill failed:', err?.message);
  }
  return recentForecasts.length;
}

/** Clears in-memory forecast history. Test only. */
export function _resetForesight(): void {
  recentForecasts.length = 0;
  ciGraph.clear();
  backfilled = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ── Pattern miners ──

/**
 * Cluster recent signals by `type` and forecast a high-severity follow-on
 * when the cluster crosses minClusterSize within the rolling window.
 */
export function mineClusters(
  signals: Signal[],
  config: ForesightConfig,
  now: number
): ForecastedSignal[] {
  const cutoff = now - config.windowMs;
  const fresh = signals.filter((s) => Date.parse(s.occurredAt) >= cutoff);
  const buckets = new Map<string, Signal[]>();
  for (const s of fresh) {
    const key = `${s.source}::${s.type}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(s);
  }

  const out: ForecastedSignal[] = [];
  for (const [key, group] of buckets) {
    if (group.length < config.minClusterSize) continue;
    const sample = group[group.length - 1];
    // Rule: cluster of incidents on a service ⇒ forecast major incident
    if (sample.type.startsWith('incident.')) {
      const predicted: Signal = {
        id: `forecast-major-${sample.asset ?? 'unknown'}-${now}`,
        source: 'foresight',
        type: 'incident.major-predicted',
        severity: bumpSeverity(sample.severity),
        asset: sample.asset,
        payload: {
          reason: `Cluster of ${group.length} ${key} events in last ${Math.round(
            config.windowMs / 60000
          )}m`,
          evidence: group.map((g) => g.id),
        },
        occurredAt: new Date(now).toISOString(),
        correlationId: sample.correlationId,
        confidence: config.baseConfidence,
        predicted: true,
        origin: 'predicted',
      };
      out.push({
        signal: predicted,
        rationale: `Cluster of ${group.length} ${sample.type} events`,
        evidenceIds: group.map((g) => g.id),
      });
    }
  }
  return out;
}

/**
 * If a precursor `em_event` (monitoring) fires on a CI, forecast incidents
 * on its downstream CIs. Simple deterministic propagation.
 */
export function propagateFromMonitoring(
  signals: Signal[],
  config: ForesightConfig,
  now: number
): ForecastedSignal[] {
  const cutoff = now - config.windowMs;
  const out: ForecastedSignal[] = [];
  for (const s of signals) {
    if (Date.parse(s.occurredAt) < cutoff) continue;
    if (s.source !== 'servicenow' && s.source !== 'monitor') continue;
    if (!s.type.startsWith('em_event.') && !s.type.startsWith('monitor.')) continue;
    if (!s.asset) continue;
    const downstream = downstreamOf(s.asset);
    for (const ci of downstream) {
      const predicted: Signal = {
        id: `forecast-cascade-${ci}-${s.id}`,
        source: 'foresight',
        type: 'incident.cascade-predicted',
        severity: s.severity,
        asset: ci,
        payload: {
          reason: `Upstream alarm on ${s.asset} → cascade to ${ci}`,
          evidence: [s.id],
        },
        occurredAt: new Date(now).toISOString(),
        correlationId: s.correlationId,
        confidence: Math.min(1, config.baseConfidence + 0.1),
        predicted: true,
        origin: 'predicted',
      };
      out.push({
        signal: predicted,
        rationale: `Upstream alarm on ${s.asset}, ${ci} depends on it`,
        evidenceIds: [s.id],
      });
    }
  }
  return out;
}

function bumpSeverity(s: SignalSeverity): SignalSeverity {
  const order: SignalSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
  const idx = Math.min(order.length - 1, order.indexOf(s) + 1);
  return order[idx];
}

// ── Public surface ──

/** Run one mining pass and publish forecasted signals. Returns what was emitted. */
export async function runForesightOnce(
  signals: Signal[],
  config: ForesightConfig = activeConfig,
  now: number = Date.now()
): Promise<Tick> {
  const out: ForecastedSignal[] = [];
  if (config.enabled) {
    out.push(...mineClusters(signals, config, now));
    out.push(...propagateFromMonitoring(signals, config, now));
  }
  for (const fc of out) {
    recentForecasts.push(fc);
    if (recentForecasts.length > MAX_FORECAST_HISTORY) recentForecasts.shift();
    // Write-through to Table Storage so the forecast survives restarts.
    void upsertEntry(
      ANTICIPATORY_TABLES.forecasts,
      'global',
      fc.signal.id,
      fc,
    ).catch((err) => console.warn('[Foresight] persist failed:', (err as Error)?.message));
    // Phase 9.3 — broadcast to Service Bus + Teams Approvals + App Insights.
    void import('./anticipatory-broadcaster')
      .then(({ broadcastForecast }) => broadcastForecast(fc))
      .catch((err) => console.warn('[Foresight] broadcast failed:', (err as Error)?.message));
    try {
      await signalRouter.publish(fc.signal);
    } catch (err) {
      console.error('[Foresight] publish failed:', err);
    }
  }
  return { startedAt: now, forecasted: out };
}

/** Start the periodic foresight loop. Idempotent. */
export function startForesight(config: Partial<ForesightConfig> = {}): void {
  activeConfig = { ...DEFAULT_FORESIGHT_CONFIG, ...config };
  if (!activeConfig.enabled) {
    console.log('[Foresight] disabled');
    return;
  }
  if (timer) return;
  console.log(
    `[Foresight] Started: tick=${activeConfig.tickMs}ms window=${activeConfig.windowMs}ms minCluster=${activeConfig.minClusterSize}`
  );
  void backfillForesight().catch((e) => console.warn('[Foresight] backfill error:', (e as Error)?.message));
  timer = setInterval(() => {
    void runForesightOnce(signalRouter.getRecentSignals(MAX_FORECAST_HISTORY)).catch((e) =>
      console.error('[Foresight] tick failed:', e)
    );
  }, activeConfig.tickMs);
  if (typeof timer.unref === 'function') timer.unref();
}

export function stopForesight(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[Foresight] Stopped');
  }
}
