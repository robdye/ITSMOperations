import { describe, it, expect, beforeEach } from 'vitest';
import { SignalRouter, when, type Signal } from '../signal-router';

function buildSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig-1',
    source: 'servicenow',
    type: 'incident.insert',
    severity: 'high',
    payload: {},
    occurredAt: new Date().toISOString(),
    origin: 'observed',
    ...overrides,
  };
}

describe('SignalRouter', () => {
  let router: SignalRouter;

  beforeEach(() => {
    router = new SignalRouter();
  });

  it('routes a matching signal to a subscribed workflow', async () => {
    let calls = 0;
    router.subscribe({
      workflowId: 'wf-a',
      predicate: when.source('servicenow'),
      handler: () => {
        calls++;
      },
    });

    const decisions = await router.publish(buildSignal());

    expect(calls).toBe(1);
    expect(decisions).toEqual([
      { signalId: 'sig-1', workflowId: 'wf-a', matched: true },
    ]);
  });

  it('does not route when predicate fails', async () => {
    let calls = 0;
    router.subscribe({
      workflowId: 'wf-a',
      predicate: when.source('jira'),
      handler: () => {
        calls++;
      },
    });

    const decisions = await router.publish(buildSignal());

    expect(calls).toBe(0);
    expect(decisions).toHaveLength(0);
  });

  it('dedupes identical signal ids within the 5-minute window', async () => {
    let calls = 0;
    router.subscribe({
      workflowId: 'wf-a',
      predicate: when.source('servicenow'),
      handler: () => {
        calls++;
      },
    });

    await router.publish(buildSignal({ id: 'dup-1' }));
    const second = await router.publish(buildSignal({ id: 'dup-1' }));

    expect(calls).toBe(1);
    expect(second).toEqual([
      { signalId: 'dup-1', workflowId: '*', matched: false, suppressedReason: 'duplicate' },
    ]);
  });

  it('suppresses re-fires within a per-subscription cooldown window', async () => {
    let calls = 0;
    router.subscribe({
      workflowId: 'wf-a',
      cooldownMs: 60_000,
      predicate: when.source('servicenow'),
      handler: () => {
        calls++;
      },
    });

    await router.publish(buildSignal({ id: 'a' }));
    const second = await router.publish(buildSignal({ id: 'b' }));

    expect(calls).toBe(1);
    expect(second).toEqual([
      { signalId: 'b', workflowId: 'wf-a', matched: true, suppressedReason: 'cooldown' },
    ]);
  });

  it('honours minSeverity composite predicates', async () => {
    let calls = 0;
    router.subscribe({
      workflowId: 'wf-major-incident',
      predicate: when.all(
        when.source('servicenow'),
        (s) => s.type.startsWith('incident.'),
        when.minSeverity('high'),
      ),
      handler: () => {
        calls++;
      },
    });

    await router.publish(buildSignal({ id: 'low', severity: 'medium' }));
    await router.publish(buildSignal({ id: 'high', severity: 'high' }));
    await router.publish(buildSignal({ id: 'crit', severity: 'critical' }));

    expect(calls).toBe(2);
  });

  it('records routed signals and decisions for the dashboard', async () => {
    router.subscribe({
      workflowId: 'wf-a',
      predicate: when.source('servicenow'),
    });

    await router.publish(buildSignal({ id: 'one' }));
    await router.publish(buildSignal({ id: 'two' }));

    expect(router.getRecentSignals().map((s) => s.id)).toEqual(['two', 'one']);
    expect(router.getRecentDecisions().map((d) => d.workflowId)).toEqual(['wf-a', 'wf-a']);
  });
});
