// ITSM Operations — Cognition Graph (Phase 9.5)
//
// Builds a force-graph-compatible JSON view of Alex's current anticipatory
// state — workers, recent signals, foresight forecasts, recent outcomes,
// and the inferred CMDB CI relationships from monitoring evidence. This is
// Alex's "Agent Mind" knowledge graph. Customers can see Alex thinking:
// which workers are firing, which signals connect to which forecasts, and
// which outcomes link back to which workflows.
//
// Output shape (consumed by force-graph in Mission Control):
//   {
//     nodes: [
//       { id, label, group: 'worker' | 'signal' | 'forecast' | 'outcome' | 'asset',
//         severity?, status?, val?  // val = node radius hint }
//     ],
//     links: [ { source, target, kind } ]
//   }
//
// All read-only; no persistence beyond what the underlying stores already do.

import { allWorkers } from './worker-definitions';
import { signalRouter, type Signal } from './signal-router';
import { getRecentForecasts } from './foresight';
import { getRecentOutcomes } from './outcome-verifier';

export interface CognitionNode {
  id: string;
  label: string;
  group: 'worker' | 'signal' | 'forecast' | 'outcome' | 'asset';
  severity?: string;
  status?: string;
  val?: number;
}

export interface CognitionLink {
  source: string;
  target: string;
  kind: 'subscribes' | 'predicts' | 'evidences' | 'resolves' | 'cascades' | 'affects';
}

export interface CognitionGraph {
  nodes: CognitionNode[];
  links: CognitionLink[];
  generatedAt: string;
  counts: {
    workers: number;
    signals: number;
    forecasts: number;
    outcomes: number;
    assets: number;
  };
}

/** Map ITIL practice / signal type to a canonical worker subscription. */
function workersFor(signalType: string): string[] {
  const out: string[] = [];
  if (signalType.startsWith('incident.')) out.push('incident-manager');
  if (signalType.startsWith('change.')) out.push('change-manager');
  if (signalType.startsWith('problem.')) out.push('problem-manager');
  if (signalType.startsWith('sla.')) out.push('sla-manager');
  if (signalType.startsWith('em_event.') || signalType.startsWith('monitor.')) out.push('monitoring-manager');
  if (signalType.startsWith('release.')) out.push('release-manager');
  return out;
}

export function buildCognitionGraph(): CognitionGraph {
  const nodes = new Map<string, CognitionNode>();
  const links: CognitionLink[] = [];

  // 1. Workers (always shown, even when idle)
  for (const w of allWorkers) {
    nodes.set(`worker:${w.id}`, {
      id: `worker:${w.id}`,
      label: w.name,
      group: 'worker',
      val: 6,
    });
  }

  // 2. Recent signals (most recent 30)
  const signals: Signal[] = signalRouter.getRecentSignals(30);
  for (const s of signals) {
    const sid = `signal:${s.id}`;
    nodes.set(sid, {
      id: sid,
      label: s.type,
      group: 'signal',
      severity: s.severity,
      val: 3,
    });
    // Asset edges
    if (s.asset) {
      const aid = `asset:${s.asset}`;
      if (!nodes.has(aid)) {
        nodes.set(aid, { id: aid, label: s.asset, group: 'asset', val: 4 });
      }
      links.push({ source: sid, target: aid, kind: 'affects' });
    }
    // Worker subscribes edges (one per matching worker)
    for (const wid of workersFor(s.type)) {
      const wkey = `worker:${wid}`;
      if (nodes.has(wkey)) {
        links.push({ source: wkey, target: sid, kind: 'subscribes' });
      }
    }
  }

  // 3. Forecasts → evidence signals (recent 20)
  const forecasts = getRecentForecasts(20);
  for (const fc of forecasts) {
    const fid = `forecast:${fc.signal.id}`;
    nodes.set(fid, {
      id: fid,
      label: fc.signal.type,
      group: 'forecast',
      severity: fc.signal.severity,
      val: 5,
    });
    if (fc.signal.asset) {
      const aid = `asset:${fc.signal.asset}`;
      if (!nodes.has(aid)) {
        nodes.set(aid, { id: aid, label: fc.signal.asset, group: 'asset', val: 4 });
      }
      links.push({ source: fid, target: aid, kind: 'cascades' });
    }
    for (const evidenceId of fc.evidenceIds) {
      const sid = `signal:${evidenceId}`;
      if (nodes.has(sid)) {
        links.push({ source: sid, target: fid, kind: 'evidences' });
      }
    }
    // Foresight engine itself as virtual worker
    const foresightId = 'worker:foresight';
    if (!nodes.has(foresightId)) {
      nodes.set(foresightId, { id: foresightId, label: 'Foresight', group: 'worker', val: 7 });
    }
    links.push({ source: foresightId, target: fid, kind: 'predicts' });
  }

  // 4. Outcomes (recent 20) — link workflowId → originating signal type
  const outcomes = getRecentOutcomes(20);
  for (const o of outcomes) {
    const oid = `outcome:${o.executionId}`;
    nodes.set(oid, {
      id: oid,
      label: `${o.workflowId} (${o.label})`,
      group: 'outcome',
      status: o.label,
      val: 4,
    });
    // Best-effort link to a worker by workflow id naming convention
    const inferredWorker = o.workflowId.replace(/-(?:response|workflow|run)$/, '');
    const wkey = `worker:${inferredWorker}`;
    if (nodes.has(wkey)) {
      links.push({ source: wkey, target: oid, kind: 'resolves' });
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    links,
    generatedAt: new Date().toISOString(),
    counts: {
      workers: Array.from(nodes.values()).filter((n) => n.group === 'worker').length,
      signals: Array.from(nodes.values()).filter((n) => n.group === 'signal').length,
      forecasts: Array.from(nodes.values()).filter((n) => n.group === 'forecast').length,
      outcomes: Array.from(nodes.values()).filter((n) => n.group === 'outcome').length,
      assets: Array.from(nodes.values()).filter((n) => n.group === 'asset').length,
    },
  };
}
