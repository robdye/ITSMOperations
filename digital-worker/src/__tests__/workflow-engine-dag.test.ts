// Phase 10 — DAG executor tests for the workflow engine.
// These tests mock the heavy dependencies (runWorker, outcome-verifier, snow,
// autonomy-gate, tuner) so we can exercise the scheduling logic directly:
//   - parallel-track execution with fan-in / join
//   - cycle detection at validation time
//   - dependency on unknown step is rejected
//   - failure isolation: when a step fails, its descendants are skipped but
//     independent branches keep running
//   - linear (non-DAG) workflows still execute sequentially (regression)

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const runWorkerMock = vi.fn();

vi.mock('../agent-harness', () => ({
  runWorker: (...args: unknown[]) => runWorkerMock(...args),
}));

vi.mock('../snow-client', () => ({
  addWorkNote: vi.fn().mockResolvedValue(undefined),
  getSnowClientStatus: () => ({ enabled: false }),
}));

vi.mock('../outcome-verifier', () => ({
  verifyWorkflowOutcome: vi.fn().mockResolvedValue({ label: 'success' }),
}));

vi.mock('../autonomy-tuner', () => ({
  recordTunerSignal: vi.fn(),
}));

vi.mock('../autonomy-gate', () => ({
  autonomyGate: () => ({ allow: true, reason: 'test' }),
}));

vi.mock('../worker-definitions', () => {
  const fakeWorker = {
    id: 'incident-manager',
    name: 'Incident Manager',
    itilPractice: 'incident',
    instructions: '',
    tools: [],
    blastRadius: 0.3,
    allowAutonomous: true,
  };
  const map = new Map<string, typeof fakeWorker>();
  for (const id of [
    'incident-manager',
    'problem-manager',
    'change-manager',
    'knowledge-manager',
    'vendor-manager',
    'risk-manager',
    'deployment-manager',
  ]) {
    map.set(id, { ...fakeWorker, id });
  }
  return { workerMap: map };
});

import { WorkflowEngine, type WorkflowDefinition } from '../workflow-engine';

// ── Helpers ────────────────────────────────────────────────────────────────

const ok = (output: string) => ({ output, workerId: 'incident-manager', crossPractice: false });

beforeEach(() => {
  runWorkerMock.mockReset();
  runWorkerMock.mockImplementation(async (worker: { id: string }) =>
    ok(`ran:${worker.id}`),
  );
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('WorkflowEngine DAG executor', () => {
  it('runs independent branches in parallel and joins on a fan-in', async () => {
    // Track the order in which steps started running so we can prove that
    // restore/comms/rca all started before any of them finished.
    const startedAt = new Map<string, number>();
    const finishedAt = new Map<string, number>();
    let tick = 0;
    runWorkerMock.mockImplementation(async (worker: { id: string }, prompt: string) => {
      const stepIdMatch = prompt.match(/step:([a-z0-9-]+)/);
      const stepId = stepIdMatch?.[1] ?? worker.id;
      startedAt.set(stepId, tick++);
      // Yield to the event loop so concurrent steps actually overlap.
      await new Promise((r) => setImmediate(r));
      finishedAt.set(stepId, tick++);
      return ok(`done:${stepId}`);
    });

    const wf: WorkflowDefinition = {
      id: 'fan-out-fan-in',
      name: 'Fan out / fan in',
      description: 'parallel A/B/C joining at D',
      trigger: 'manual',
      steps: [
        { id: 'detect', worker: 'incident-manager', action: 'step:detect', inputs: {} },
        { id: 'a', worker: 'incident-manager', action: 'step:a', inputs: {}, dependsOn: ['detect'] },
        { id: 'b', worker: 'problem-manager', action: 'step:b', inputs: {}, dependsOn: ['detect'] },
        { id: 'c', worker: 'change-manager', action: 'step:c', inputs: {}, dependsOn: ['detect'] },
        { id: 'join', worker: 'incident-manager', action: 'step:join', inputs: {}, dependsOn: ['a', 'b', 'c'] },
      ],
    };

    const engine = new WorkflowEngine();
    engine.registerWorkflow(wf);
    const result = await engine.executeWorkflow('fan-out-fan-in');

    expect(result.status).toBe('completed');
    expect(result.steps.every((s) => s.status === 'completed')).toBe(true);

    // detect must finish before a/b/c start
    expect(finishedAt.get('detect')!).toBeLessThan(startedAt.get('a')!);
    expect(finishedAt.get('detect')!).toBeLessThan(startedAt.get('b')!);
    expect(finishedAt.get('detect')!).toBeLessThan(startedAt.get('c')!);

    // a/b/c must all have started before any of them finished (parallel)
    const earliestFinish = Math.min(
      finishedAt.get('a')!,
      finishedAt.get('b')!,
      finishedAt.get('c')!,
    );
    const latestStart = Math.max(
      startedAt.get('a')!,
      startedAt.get('b')!,
      startedAt.get('c')!,
    );
    expect(latestStart).toBeLessThan(earliestFinish);

    // join must run AFTER all three parallel tracks finish
    expect(startedAt.get('join')!).toBeGreaterThan(finishedAt.get('a')!);
    expect(startedAt.get('join')!).toBeGreaterThan(finishedAt.get('b')!);
    expect(startedAt.get('join')!).toBeGreaterThan(finishedAt.get('c')!);
  });

  it('rejects DAG with a cycle', async () => {
    const wf: WorkflowDefinition = {
      id: 'cyclic',
      name: 'Cyclic',
      description: 'a→b→a',
      trigger: 'manual',
      steps: [
        { id: 'a', worker: 'incident-manager', action: 'a', inputs: {}, dependsOn: ['b'] },
        { id: 'b', worker: 'incident-manager', action: 'b', inputs: {}, dependsOn: ['a'] },
      ],
    };
    const engine = new WorkflowEngine();
    engine.registerWorkflow(wf);
    const result = await engine.executeWorkflow('cyclic');
    expect(result.status).toBe('failed');
    expect(result.finalOutput).toMatch(/cycle/i);
    // No steps should have run
    expect(runWorkerMock).not.toHaveBeenCalled();
  });

  it('rejects DAG with dependsOn pointing to unknown step', async () => {
    const wf: WorkflowDefinition = {
      id: 'dangling',
      name: 'Dangling',
      description: 'a depends on ghost',
      trigger: 'manual',
      steps: [
        { id: 'a', worker: 'incident-manager', action: 'a', inputs: {}, dependsOn: ['ghost'] },
      ],
    };
    const engine = new WorkflowEngine();
    engine.registerWorkflow(wf);
    const result = await engine.executeWorkflow('dangling');
    expect(result.status).toBe('failed');
    expect(result.finalOutput).toMatch(/unknown step/i);
  });

  it('skips descendants of a failed step but lets independent branches finish', async () => {
    runWorkerMock.mockImplementation(async (worker: { id: string }, prompt: string) => {
      // Make step 'b' fail; everything else succeeds.
      if (prompt.includes('step:b')) {
        throw new Error('synthetic-b-failure');
      }
      return ok(`done:${prompt}`);
    });

    const wf: WorkflowDefinition = {
      id: 'partial-fail',
      name: 'Partial fail',
      description: 'one branch fails, the other completes',
      trigger: 'manual',
      steps: [
        { id: 'root', worker: 'incident-manager', action: 'step:root', inputs: {} },
        // Branch B fails — its descendant b-child must be skipped
        { id: 'b', worker: 'incident-manager', action: 'step:b', inputs: {}, dependsOn: ['root'] },
        { id: 'b-child', worker: 'incident-manager', action: 'step:bchild', inputs: {}, dependsOn: ['b'] },
        // Independent branch C must still complete
        { id: 'c', worker: 'change-manager', action: 'step:c', inputs: {}, dependsOn: ['root'] },
        { id: 'c-child', worker: 'change-manager', action: 'step:cchild', inputs: {}, dependsOn: ['c'] },
      ],
    };
    const engine = new WorkflowEngine();
    engine.registerWorkflow(wf);
    const result = await engine.executeWorkflow('partial-fail');

    expect(result.status).toBe('failed');
    const byId = new Map(result.steps.map((s) => [s.stepId, s.status]));
    expect(byId.get('root')).toBe('completed');
    expect(byId.get('b')).toBe('failed');
    expect(byId.get('b-child')).toBe('skipped');
    expect(byId.get('c')).toBe('completed');
    expect(byId.get('c-child')).toBe('completed');
  });

  it('regression — workflows without dependsOn execute linearly via the legacy path', async () => {
    const calledOrder: string[] = [];
    runWorkerMock.mockImplementation(async (_worker: { id: string }, prompt: string) => {
      const m = prompt.match(/step:([a-z0-9-]+)/);
      calledOrder.push(m?.[1] ?? 'unknown');
      return ok('linear-ok');
    });
    const wf: WorkflowDefinition = {
      id: 'linear',
      name: 'Linear',
      description: 'no dependsOn, must run in array order',
      trigger: 'manual',
      steps: [
        { id: 's1', worker: 'incident-manager', action: 'step:s1', inputs: {} },
        { id: 's2', worker: 'incident-manager', action: 'step:s2', inputs: {} },
        { id: 's3', worker: 'incident-manager', action: 'step:s3', inputs: {} },
      ],
    };
    const engine = new WorkflowEngine();
    engine.registerWorkflow(wf);
    const result = await engine.executeWorkflow('linear');
    expect(result.status).toBe('completed');
    expect(calledOrder).toEqual(['s1', 's2', 's3']);
  });

  it('built-in major-incident-response-dag is a valid DAG', async () => {
    const engine = new WorkflowEngine();
    const all = engine.listWorkflows();
    const dag = all.find((w) => w.id === 'major-incident-response-dag');
    expect(dag).toBeDefined();
    // The 4 parallel tracks all depend solely on detect
    const restore = dag!.steps.find((s) => s.id === 'restore');
    const comms = dag!.steps.find((s) => s.id === 'comms');
    const rca = dag!.steps.find((s) => s.id === 'rca');
    const vendor = dag!.steps.find((s) => s.id === 'vendor');
    expect(restore?.dependsOn).toEqual(['detect']);
    expect(comms?.dependsOn).toEqual(['detect']);
    expect(rca?.dependsOn).toEqual(['detect']);
    expect(vendor?.dependsOn).toEqual(['detect']);
    // join fans them back in
    const join = dag!.steps.find((s) => s.id === 'join');
    expect(new Set(join?.dependsOn ?? [])).toEqual(new Set(['restore', 'comms', 'rca', 'vendor']));
  });
});
