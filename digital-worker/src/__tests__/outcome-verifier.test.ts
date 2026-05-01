import { describe, it, expect, beforeEach } from 'vitest';
import {
  verifyWorkflowOutcome,
  registerProbe,
  registerRollback,
  getRecentOutcomes,
  getRollingSuccessRate,
  _resetVerifier,
} from '../outcome-verifier';
import type { WorkflowResult } from '../workflow-engine';

const baseResult = (status: WorkflowResult['status'] = 'completed'): WorkflowResult => ({
  executionId: 'exec-1',
  workflowId: 'wf-x',
  status,
  steps: [],
  finalOutput: 'ok',
});

describe('outcome-verifier', () => {
  beforeEach(() => {
    _resetVerifier();
  });

  it('default probe labels completed workflows as success', async () => {
    const rec = await verifyWorkflowOutcome({
      workflowId: 'wf-x',
      executionId: 'exec-1',
      workflowResult: baseResult('completed'),
    });
    expect(rec.label).toBe('success');
    expect(getRecentOutcomes(10)[0].label).toBe('success');
    expect(getRollingSuccessRate('wf-x').successes).toBe(1);
  });

  it('default probe labels paused workflows as partial', async () => {
    const rec = await verifyWorkflowOutcome({
      workflowId: 'wf-x',
      executionId: 'exec-1',
      workflowResult: baseResult('paused'),
    });
    expect(rec.label).toBe('partial');
  });

  it('runs registered rollback handler on label="failure" when autoRollback', async () => {
    let rolledBack = false;
    registerRollback('wf-x', async () => {
      rolledBack = true;
    });
    registerProbe('wf-x', async () => ({ label: 'failure', notes: 'probe fail' }));
    const rec = await verifyWorkflowOutcome(
      {
        workflowId: 'wf-x',
        executionId: 'exec-2',
        workflowResult: baseResult('completed'),
      },
      { autoRollback: true },
    );
    expect(rec.label).toBe('failure');
    expect(rec.rolledBack).toBe(true);
    expect(rolledBack).toBe(true);
  });

  it('survives a probe that throws — labels inconclusive', async () => {
    registerProbe('wf-x', async () => {
      throw new Error('probe boom');
    });
    const rec = await verifyWorkflowOutcome({
      workflowId: 'wf-x',
      executionId: 'exec-3',
      workflowResult: baseResult('completed'),
    });
    expect(rec.label).toBe('inconclusive');
    expect(rec.notes).toContain('probe boom');
  });
});
