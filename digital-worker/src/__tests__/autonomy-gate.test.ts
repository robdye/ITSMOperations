import { describe, it, expect, beforeEach } from 'vitest';
import { autonomyGate } from '../autonomy-gate';
import { _resetGovernance, engageKillSwitch, setChangeFreezeWindows } from '../governance';
import { _resetTuner } from '../autonomy-tuner';
import type { TriggerDecision } from '../trigger-policy';
import type { WorkerDefinition } from '../agent-harness';

const decision = (over: Partial<TriggerDecision> = {}): TriggerDecision => ({
  workflowId: 'wf-x',
  mode: 'auto',
  effectiveConfidence: 0.95,
  reason: 'unit-test',
  approvalPolicy: { requireApproval: false },
  ...over,
});

const worker = (over: Partial<WorkerDefinition> = {}): WorkerDefinition => ({
  id: 'incident-manager',
  name: 'Incident Manager',
  itilPractice: 'incident',
  instructions: '',
  tools: [],
  blastRadius: 0.3,
  allowAutonomous: true,
  ...over,
});

describe('autonomy-gate', () => {
  beforeEach(() => {
    _resetGovernance();
    _resetTuner();
    delete process.env.GLOBAL_KILL_SWITCH;
    delete process.env.CHANGE_FREEZE;
  });

  it('allows autonomous action when all guardrails pass', () => {
    const r = autonomyGate({ workflowId: 'wf-x', worker: worker(), decision: decision() });
    expect(r.allow).toBe(true);
  });

  it('blocks when kill-switch is engaged', () => {
    engageKillSwitch('test');
    const r = autonomyGate({ workflowId: 'wf-x', worker: worker(), decision: decision() });
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('kill-switch');
  });

  it('blocks when change-freeze is active', () => {
    const now = Date.now();
    setChangeFreezeWindows([
      { from: new Date(now - 60_000).toISOString(), to: new Date(now + 60_000).toISOString() },
    ]);
    const r = autonomyGate({ workflowId: 'wf-x', worker: worker(), decision: decision(), now });
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('change-freeze');
  });

  it('blocks when worker.allowAutonomous=false', () => {
    const r = autonomyGate({
      workflowId: 'wf-x',
      worker: worker({ allowAutonomous: false }),
      decision: decision(),
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('allowAutonomous=false');
  });

  it('blocks when trigger-policy mode is not auto', () => {
    const r = autonomyGate({ workflowId: 'wf-x', worker: worker(), decision: decision({ mode: 'propose' }) });
    expect(r.allow).toBe(false);
    expect(r.reason).toContain('mode=propose');
  });

  it('blocks once budget is exhausted', () => {
    const cap = 2;
    const a = autonomyGate({ workflowId: 'wf-x', worker: worker(), decision: decision(), hourlyAutoBudget: cap });
    const b = autonomyGate({ workflowId: 'wf-x', worker: worker(), decision: decision(), hourlyAutoBudget: cap });
    const c = autonomyGate({ workflowId: 'wf-x', worker: worker(), decision: decision(), hourlyAutoBudget: cap });
    expect(a.allow).toBe(true);
    expect(b.allow).toBe(true);
    expect(c.allow).toBe(false);
    expect(c.reason).toContain('budget');
  });
});
