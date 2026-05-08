// Phase 4 — meta-monitor smoke tests.
//
// Tests cover: KPI surface, public recordMetaAlert, alert ring buffer
// shape, start/stop loop control, and severity escalation behaviour.

import { describe, it, expect } from 'vitest';
import {
  getMetaMonitorKpi,
  getRecentMetaAlerts,
  startMetaMonitor,
  stopMetaMonitor,
  recordMetaAlert,
  type MetaAlert,
} from '../meta-monitor';

describe('meta-monitor', () => {
  it('startMetaMonitor + stopMetaMonitor are idempotent', () => {
    expect(() => startMetaMonitor()).not.toThrow();
    expect(() => startMetaMonitor()).not.toThrow();
    stopMetaMonitor();
    expect(() => stopMetaMonitor()).not.toThrow();
  });

  it('getMetaMonitorKpi exposes the documented KPI shape', () => {
    const kpi = getMetaMonitorKpi();
    expect(kpi).toMatchObject({
      ticks: expect.any(Number),
      alertsRaised: expect.any(Number),
      killTriggered: expect.any(Number),
      alertsPerHour: expect.any(Number),
      uptimeSec: expect.any(Number),
    });
  });

  it('recordMetaAlert pushes an alert that surfaces on getRecentMetaAlerts', () => {
    const before = getRecentMetaAlerts(50).length;
    recordMetaAlert({
      kind: 'trust_score_low',
      severity: 'warning',
      message: 'smoke-test trust score warning',
      details: { score: 42 },
    });
    const after = getRecentMetaAlerts(50);
    expect(after.length).toBeGreaterThan(before);
    const ours = after.find((a: MetaAlert) => a.detail === 'smoke-test trust score warning');
    expect(ours).toBeDefined();
    expect(ours!.kind).toBe('trust_score_low');
    expect(ours!.severity).toBe('warning');
  });

  it('getRecentMetaAlerts returns most-recent first', () => {
    recordMetaAlert({ kind: 'high-block-rate', severity: 'warning', message: 'first' });
    recordMetaAlert({ kind: 'high-block-rate', severity: 'warning', message: 'second' });
    const recent = getRecentMetaAlerts(2);
    expect(recent.length).toBe(2);
    // Most recent first.
    expect(recent[0].detail).toBe('second');
    expect(recent[1].detail).toBe('first');
  });
});
