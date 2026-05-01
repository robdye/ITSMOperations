import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateTrigger,
  _resetTriggerPolicyState,
  DEFAULT_POLICY_CONFIG,
} from '../trigger-policy';
import type { Signal } from '../signal-router';
import type { WorkerDefinition } from '../agent-harness';

function buildSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig-tp-1',
    source: 'servicenow',
    type: 'incident.insert',
    severity: 'high',
    payload: {},
    occurredAt: new Date().toISOString(),
    origin: 'observed',
    ...overrides,
  };
}

function buildWorker(overrides: Partial<WorkerDefinition> = {}): WorkerDefinition {
  return {
    id: 'incident-manager',
    name: 'Incident Manager',
    itilPractice: 'Incident Management',
    instructions: '',
    tools: [],
    blastRadius: 0.2,
    allowAutonomous: true,
    ...overrides,
  };
}

describe('evaluateTrigger', () => {
  beforeEach(() => {
    _resetTriggerPolicyState();
  });

  it('returns auto when effective confidence ≥ auto threshold and budget available', () => {
    const decision = evaluateTrigger({
      workflowId: 'major-incident-response',
      signal: buildSignal({ confidence: 1.0 }),
      worker: buildWorker({ blastRadius: 0.0, allowAutonomous: true }),
    });

    expect(decision.mode).toBe('auto');
    expect(decision.effectiveConfidence).toBeCloseTo(1.0);
  });

  it('damps confidence by blast radius', () => {
    const decision = evaluateTrigger({
      workflowId: 'wf',
      signal: buildSignal({ confidence: 1.0 }),
      worker: buildWorker({ blastRadius: 1.0 }),
    });

    // 1.0 * (1 - 0.5 * 1.0) = 0.5 → above notify (0.3), below propose (0.6) → notify-only.
    expect(decision.effectiveConfidence).toBeCloseTo(0.5);
    expect(decision.mode).toBe('notify-only');
  });

  it('drops to dry-run when confidence is between propose and auto with low blast', () => {
    const decision = evaluateTrigger({
      workflowId: 'wf',
      signal: buildSignal({ confidence: 0.7 }),
      worker: buildWorker({ blastRadius: 0.0, allowAutonomous: true }),
    });

    expect(decision.effectiveConfidence).toBeCloseTo(0.7);
    expect(decision.mode).toBe('dry-run');
  });

  it('drops to propose when confidence is mid-range with high blast', () => {
    // baseConfidence 0.95, blastRadius 0.7 → 0.95 * (1 - 0.35) = 0.6175
    const decision = evaluateTrigger({
      workflowId: 'wf',
      signal: buildSignal({ confidence: 0.95 }),
      worker: buildWorker({ blastRadius: 0.7, allowAutonomous: true }),
    });

    expect(decision.effectiveConfidence).toBeGreaterThan(DEFAULT_POLICY_CONFIG.proposeThreshold);
    expect(decision.effectiveConfidence).toBeLessThan(DEFAULT_POLICY_CONFIG.autoThreshold);
    expect(decision.mode).toBe('propose');
    expect(decision.approvalPolicy.requireApproval).toBe(true);
  });

  it('returns notify-only when confidence is between notify and propose', () => {
    const decision = evaluateTrigger({
      workflowId: 'wf',
      signal: buildSignal({ confidence: 0.5 }),
      worker: buildWorker({ blastRadius: 0.0 }),
    });

    expect(decision.mode).toBe('notify-only');
  });

  it('suppresses when confidence below notify threshold', () => {
    const decision = evaluateTrigger({
      workflowId: 'wf',
      signal: buildSignal({ confidence: 0.1 }),
      worker: buildWorker({ blastRadius: 0.0 }),
    });

    expect(decision.mode).toBe('suppress');
  });

  it('downgrades autonomous workers to propose when allowAutonomous=false', () => {
    const decision = evaluateTrigger({
      workflowId: 'wf',
      signal: buildSignal({ confidence: 1.0 }),
      worker: buildWorker({ blastRadius: 0.0, allowAutonomous: false }),
    });

    expect(decision.mode).toBe('propose');
    expect(decision.approvalPolicy.requireApproval).toBe(true);
  });

  it('downgrades to propose during change freeze', () => {
    const decision = evaluateTrigger({
      workflowId: 'wf',
      signal: buildSignal({ confidence: 1.0 }),
      worker: buildWorker({ blastRadius: 0.0, allowAutonomous: true }),
      isChangeFreeze: () => true,
    });

    expect(decision.mode).toBe('propose');
  });

  it('downgrades to propose when hourly action budget is exhausted', () => {
    const tenant = 'budget-test-tenant';
    // Burn through the budget.
    for (let i = 0; i < DEFAULT_POLICY_CONFIG.hourlyAutoBudget; i++) {
      const d = evaluateTrigger({
        workflowId: 'wf',
        signal: buildSignal({ id: `auto-${i}`, confidence: 1.0 }),
        worker: buildWorker({ blastRadius: 0.0, allowAutonomous: true }),
        tenantId: tenant,
      });
      expect(d.mode).toBe('auto');
    }

    const overflow = evaluateTrigger({
      workflowId: 'wf',
      signal: buildSignal({ id: 'overflow', confidence: 1.0 }),
      worker: buildWorker({ blastRadius: 0.0, allowAutonomous: true }),
      tenantId: tenant,
    });

    expect(overflow.mode).toBe('propose');
    expect(overflow.reason).toMatch(/budget exhausted/i);
  });

  it('treats predicted signals with default 0.6 confidence', () => {
    const decision = evaluateTrigger({
      workflowId: 'wf',
      signal: buildSignal({ predicted: true }),
      worker: buildWorker({ blastRadius: 0.0, allowAutonomous: true }),
    });

    // 0.6 * (1 - 0) = 0.6 → propose threshold exactly, low blast → dry-run.
    expect(decision.effectiveConfidence).toBeCloseTo(0.6);
    expect(['dry-run', 'propose']).toContain(decision.mode);
  });
});
