// ITSM Operations — Cross-Workflow Correlation (Phase 3.3)
//
// Walks the open cases + the cognition graph and finds correlations:
//   - Two open cases on the same affected asset.
//   - Two open cases linked to the same originating signal cluster.
//   - A case whose subjectRef matches an outcome that is repeating.
//
// Correlations are surfaced at /api/cases/correlations and used by the
// reviewer/meta-monitor to flag suspicious patterns.
//
// Single numeric KPI: correlations_per_hour.

import { listOpenCases, type CaseRecord } from './case-manager';
import { buildCognitionGraph, type CognitionGraph } from './cognition-graph';

export interface CaseCorrelation {
  kind: 'shared-asset' | 'shared-signal' | 'repeated-failure';
  caseIds: string[];
  evidence: string;
  detectedAt: string;
}

const stats = {
  detections: 0,
  startedAt: Date.now(),
};

export function getCorrelationKpi(): {
  detections: number;
  perHour: number;
  uptimeSec: number;
} {
  const uptimeMs = Date.now() - stats.startedAt;
  const perHour = uptimeMs > 0 ? (stats.detections * 3_600_000) / uptimeMs : 0;
  return {
    detections: stats.detections,
    perHour: Math.round(perHour * 100) / 100,
    uptimeSec: Math.round(uptimeMs / 1000),
  };
}

function caseAssetKey(c: CaseRecord): string | null {
  return c.subjectRef.sysId || c.subjectRef.number || null;
}

export async function detectCorrelations(): Promise<CaseCorrelation[]> {
  const cases = await listOpenCases();
  const correlations: CaseCorrelation[] = [];

  // 1. shared-asset — two cases pointing at the same SNOW record.
  const assetMap = new Map<string, CaseRecord[]>();
  for (const c of cases) {
    const key = caseAssetKey(c);
    if (!key) continue;
    const k = `${c.subjectRef.kind}::${key}`;
    const arr = assetMap.get(k) || [];
    arr.push(c);
    assetMap.set(k, arr);
  }
  for (const [k, arr] of assetMap) {
    if (arr.length >= 2) {
      correlations.push({
        kind: 'shared-asset',
        caseIds: arr.map((c) => c.id),
        evidence: `Multiple open cases on ${k}`,
        detectedAt: new Date().toISOString(),
      });
    }
  }

  // 2. shared-signal — cases linked to the same upstream signal id.
  const sigMap = new Map<string, CaseRecord[]>();
  for (const c of cases) {
    for (const sid of c.relatedSignals) {
      const arr = sigMap.get(sid) || [];
      arr.push(c);
      sigMap.set(sid, arr);
    }
  }
  for (const [sid, arr] of sigMap) {
    if (arr.length >= 2) {
      correlations.push({
        kind: 'shared-signal',
        caseIds: arr.map((c) => c.id),
        evidence: `Cases share originating signal ${sid}`,
        detectedAt: new Date().toISOString(),
      });
    }
  }

  // 3. repeated-failure — overlap with cognition-graph outcome nodes.
  const graph: CognitionGraph = buildCognitionGraph();
  const failureOutcomes = graph.nodes.filter(
    (n) => n.group === 'outcome' && (n.status === 'failure' || n.status === 'partial'),
  );
  if (failureOutcomes.length >= 3) {
    // Group by workflowId prefix in the label.
    const wfMap = new Map<string, string[]>();
    for (const n of failureOutcomes) {
      const wf = (n.label.split(' ')[0] || '').trim();
      if (!wf) continue;
      const arr = wfMap.get(wf) || [];
      arr.push(n.id);
      wfMap.set(wf, arr);
    }
    for (const [wf, ids] of wfMap) {
      if (ids.length >= 3) {
        // Find any open cases linked to this workflow.
        const matching = cases.filter((c) => c.relatedWorkflows.includes(wf));
        correlations.push({
          kind: 'repeated-failure',
          caseIds: matching.map((c) => c.id),
          evidence: `Workflow ${wf} has ${ids.length} recent failures/partials`,
          detectedAt: new Date().toISOString(),
        });
      }
    }
  }

  stats.detections += correlations.length;
  return correlations;
}
