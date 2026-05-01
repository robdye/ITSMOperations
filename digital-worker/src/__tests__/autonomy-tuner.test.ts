import { describe, it, expect, beforeEach } from 'vitest';
import { getTunedThresholds, recordTunerSignal, _resetTuner } from '../autonomy-tuner';
import { verifyWorkflowOutcome, _resetVerifier, registerProbe } from '../outcome-verifier';

describe('autonomy-tuner', () => {
  beforeEach(() => {
    _resetTuner();
    _resetVerifier();
  });

  it('falls back to defaults when not warmed up', () => {
    const t = getTunedThresholds('wf-x', 'incident.high');
    expect(t.warmedUp).toBe(false);
    expect(t.autoThreshold).toBeCloseTo(0.85, 5);
    expect(t.proposeThreshold).toBeCloseTo(0.6, 5);
  });

  it('raises auto threshold after sustained failures', async () => {
    registerProbe('wf-x', async () => ({ label: 'failure' }));
    for (let i = 0; i < 6; i++) {
      const rec = await verifyWorkflowOutcome({
        workflowId: 'wf-x',
        executionId: `e-${i}`,
        workflowResult: { executionId: `e-${i}`, workflowId: 'wf-x', status: 'completed', steps: [] },
        signal: {
          id: `s-${i}`, source: 'servicenow', type: 'incident.high', severity: 'high', payload: {},
          occurredAt: new Date().toISOString(), origin: 'observed',
        },
      });
      recordTunerSignal('wf-x', 'incident.high', rec.label);
    }
    const t = getTunedThresholds('wf-x', 'incident.high');
    expect(t.warmedUp).toBe(true);
    expect(t.autoThreshold).toBeGreaterThan(0.85);
  });

  it('lowers auto threshold after sustained successes', async () => {
    registerProbe('wf-x', async () => ({ label: 'success' }));
    for (let i = 0; i < 8; i++) {
      const rec = await verifyWorkflowOutcome({
        workflowId: 'wf-x',
        executionId: `e-${i}`,
        workflowResult: { executionId: `e-${i}`, workflowId: 'wf-x', status: 'completed', steps: [] },
        signal: {
          id: `s-${i}`, source: 'servicenow', type: 'incident.medium', severity: 'medium', payload: {},
          occurredAt: new Date().toISOString(), origin: 'observed',
        },
      });
      recordTunerSignal('wf-x', 'incident.medium', rec.label);
    }
    const t = getTunedThresholds('wf-x', 'incident.medium');
    expect(t.warmedUp).toBe(true);
    expect(t.autoThreshold).toBeLessThan(0.85);
  });
});
