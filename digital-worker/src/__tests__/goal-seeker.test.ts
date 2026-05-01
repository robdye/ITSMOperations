import { describe, it, expect, beforeEach } from 'vitest';
import { planForGoal, pursueGoal, _resetGoalSeeker, getRegisteredRecipes } from '../goal-seeker';

class FakeEngine {
  calls: string[] = [];
  fail = new Set<string>();
  async executeWorkflow(workflowId: string, _ctx: Record<string, unknown> = {}) {
    this.calls.push(workflowId);
    if (this.fail.has(workflowId)) {
      return { executionId: `e-${workflowId}`, workflowId, status: 'failed' as const, steps: [], finalOutput: 'fail' };
    }
    return { executionId: `e-${workflowId}`, workflowId, status: 'completed' as const, steps: [], finalOutput: 'ok' };
  }
}

describe('goal-seeker', () => {
  beforeEach(() => {
    _resetGoalSeeker();
  });

  it('matches a known recipe by keyword', () => {
    const plan = planForGoal('we need to restore service x ASAP');
    expect(plan.steps[0].workflowId).toBe('major-incident-response');
  });

  it('falls through to a default plan for novel goals', () => {
    const plan = planForGoal('bake a cake');
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('pursues a multi-step plan and reports success', async () => {
    const engine = new FakeEngine() as any;
    const report = await pursueGoal(engine, 'restore service x');
    expect(report.status).toBe('success');
    expect(engine.calls).toContain('major-incident-response');
    expect(engine.calls).toContain('knowledge-harvest');
  });

  it('uses the onFailure fallback when a step fails', async () => {
    const engine = new FakeEngine() as any;
    engine.fail.add('major-incident-response');
    const report = await pursueGoal(engine, 'restore service x');
    expect(report.attempted.some((s: { status: string }) => s.status === 'failed')).toBe(true);
    expect(engine.calls).toContain('reasoning-rca');
  });

  it('exposes the registered recipe catalog', () => {
    expect(getRegisteredRecipes().length).toBeGreaterThan(0);
  });
});
