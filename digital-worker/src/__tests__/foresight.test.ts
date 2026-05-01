import { describe, it, expect, beforeEach } from 'vitest';
import {
  runForesightOnce,
  setCIGraph,
  downstreamOf,
  _resetForesight,
  DEFAULT_FORESIGHT_CONFIG,
  mineClusters,
  propagateFromMonitoring,
} from '../foresight';
import type { Signal } from '../signal-router';

function sig(over: Partial<Signal>): Signal {
  return {
    id: `s-${Math.random()}`,
    source: 'servicenow',
    type: 'incident.high',
    severity: 'high',
    payload: {},
    occurredAt: new Date().toISOString(),
    confidence: 1,
    origin: 'observed',
    ...over,
  };
}

describe('foresight', () => {
  beforeEach(() => {
    _resetForesight();
  });

  it('mineClusters emits a major-incident-predicted forecast when ≥ minClusterSize matches', () => {
    const now = Date.now();
    const signals = [
      sig({ id: 's1', type: 'incident.high', source: 'servicenow', asset: 'svc-a', occurredAt: new Date(now - 1000).toISOString() }),
      sig({ id: 's2', type: 'incident.high', source: 'servicenow', asset: 'svc-a', occurredAt: new Date(now - 2000).toISOString() }),
      sig({ id: 's3', type: 'incident.high', source: 'servicenow', asset: 'svc-a', occurredAt: new Date(now - 3000).toISOString() }),
    ];
    const out = mineClusters(signals, DEFAULT_FORESIGHT_CONFIG, now);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].signal.origin).toBe('predicted');
    expect(out[0].signal.predicted).toBe(true);
    expect(out[0].signal.type).toBe('incident.major-predicted');
    expect((out[0].signal.confidence ?? 0)).toBeLessThan(1);
  });

  it('does not emit a forecast for clusters below the minimum size', () => {
    const now = Date.now();
    const signals = [
      sig({ id: 's1', type: 'incident.high', source: 'servicenow', occurredAt: new Date(now - 1000).toISOString() }),
      sig({ id: 's2', type: 'incident.high', source: 'servicenow', occurredAt: new Date(now - 2000).toISOString() }),
    ];
    const out = mineClusters(signals, DEFAULT_FORESIGHT_CONFIG, now);
    expect(out.length).toBe(0);
  });

  it('propagateFromMonitoring forecasts cascade incidents on downstream CIs', () => {
    setCIGraph([
      { id: 'svc-a' },
      { id: 'svc-b', dependsOn: ['svc-a'] },
      { id: 'svc-c', dependsOn: ['svc-b'] },
    ]);
    expect(downstreamOf('svc-a').sort()).toEqual(['svc-b', 'svc-c'].sort());
    const now = Date.now();
    const out = propagateFromMonitoring([
      sig({ id: 'm1', source: 'monitor', type: 'monitor.degraded', asset: 'svc-a', occurredAt: new Date(now).toISOString() }),
    ], DEFAULT_FORESIGHT_CONFIG, now);
    expect(out.length).toBe(2);
    const targets = out.map((f) => f.signal.asset).sort();
    expect(targets).toEqual(['svc-b', 'svc-c'].sort());
  });

  it('runForesightOnce publishes forecasts to the signal router', async () => {
    const now = Date.now();
    const tick = await runForesightOnce(
      [
        sig({ id: 's1', occurredAt: new Date(now - 1000).toISOString() }),
        sig({ id: 's2', occurredAt: new Date(now - 2000).toISOString() }),
        sig({ id: 's3', occurredAt: new Date(now - 3000).toISOString() }),
      ],
      DEFAULT_FORESIGHT_CONFIG,
      now,
    );
    expect(tick.forecasted.length).toBeGreaterThan(0);
  });
});
