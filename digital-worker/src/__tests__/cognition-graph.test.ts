// Phase 9.5 — cognition graph tests

import { describe, it, expect, beforeEach } from 'vitest';
import { signalRouter, type Signal } from '../signal-router';
import { runForesightOnce, _resetForesight } from '../foresight';
import { _resetVerifier, verifyWorkflowOutcome } from '../outcome-verifier';
import { buildCognitionGraph } from '../cognition-graph';

function mkSignal(id: string, type = 'incident.high', asset = 'svc-x'): Signal {
  return {
    id,
    source: 'servicenow',
    type,
    severity: 'high',
    asset,
    payload: { service: asset },
    occurredAt: new Date().toISOString(),
    origin: 'observed',
  } as Signal;
}

describe('cognition-graph', () => {
  beforeEach(() => {
    _resetForesight();
    _resetVerifier();
    signalRouter.reset();
    delete process.env.AUDIT_STORAGE_CONNECTION_STRING;
  });

  it('returns workers, signals and forecasts as connected nodes', async () => {
    // Seed signals + forecast
    const seed: Signal[] = [
      mkSignal('s1'),
      mkSignal('s2'),
      mkSignal('s3'),
    ];
    for (const s of seed) await signalRouter.publish(s);
    await runForesightOnce(seed, { tickMs: 60000, windowMs: 60000, minClusterSize: 3, baseConfidence: 0.6, enabled: true });

    const g = buildCognitionGraph();
    expect(g.counts.workers).toBeGreaterThan(0);
    expect(g.counts.signals).toBeGreaterThanOrEqual(3);
    expect(g.counts.forecasts).toBeGreaterThanOrEqual(1);
    // Every link references a real node id.
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const l of g.links) {
      expect(ids.has(l.source)).toBe(true);
      expect(ids.has(l.target)).toBe(true);
    }
  });

  it('includes outcome nodes after verifyWorkflowOutcome runs', async () => {
    await verifyWorkflowOutcome({
      workflowId: 'incident-manager-response',
      executionId: 'exec-1',
      signal: mkSignal('s9'),
      workflowResult: { status: 'completed' } as any,
    });
    const g = buildCognitionGraph();
    expect(g.counts.outcomes).toBeGreaterThanOrEqual(1);
    const outcomeNode = g.nodes.find((n) => n.group === 'outcome');
    expect(outcomeNode).toBeDefined();
    expect(outcomeNode!.label).toContain('incident-manager-response');
  });
});
