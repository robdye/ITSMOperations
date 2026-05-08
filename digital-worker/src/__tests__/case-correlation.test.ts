// Phase 4 — case-correlation smoke tests.
//
// Pure detection tests over the in-memory case store. We exercise
// shared-asset and shared-signal correlations using openCase() seeds.

import { describe, it, expect } from 'vitest';
import { openCase, addRelatedSignal } from '../case-manager';
import { detectCorrelations, getCorrelationKpi } from '../case-correlation';

describe('case-correlation', () => {
  it('detects two cases on the same subject as shared-asset', async () => {
    const sysId = `INC-corr-${Date.now()}`;
    await openCase({ subjectRef: { kind: 'incident', sysId }, ownerWorkerId: 'incident-manager' });
    await openCase({ subjectRef: { kind: 'incident', sysId }, ownerWorkerId: 'incident-manager' });
    const correlations = await detectCorrelations();
    const sharedAsset = correlations.find((c) => c.kind === 'shared-asset' && c.evidence.includes(sysId));
    expect(sharedAsset).toBeDefined();
    expect(sharedAsset!.caseIds.length).toBeGreaterThanOrEqual(2);
  });

  it('detects two cases linked to the same signal as shared-signal', async () => {
    const sigId = `sig-shared-${Date.now()}`;
    const a = await openCase({
      subjectRef: { kind: 'incident', sysId: `INC-corrA-${Date.now()}` },
      ownerWorkerId: 'incident-manager',
    });
    const b = await openCase({
      subjectRef: { kind: 'incident', sysId: `INC-corrB-${Date.now()}` },
      ownerWorkerId: 'incident-manager',
    });
    await addRelatedSignal(a.id, sigId);
    await addRelatedSignal(b.id, sigId);
    const correlations = await detectCorrelations();
    const sharedSignal = correlations.find(
      (c) => c.kind === 'shared-signal' && c.caseIds.includes(a.id) && c.caseIds.includes(b.id),
    );
    expect(sharedSignal).toBeDefined();
  });

  it('getCorrelationKpi exposes detection counters', () => {
    const kpi = getCorrelationKpi();
    expect(typeof kpi.detections).toBe('number');
    expect(typeof kpi.perHour).toBe('number');
    expect(typeof kpi.uptimeSec).toBe('number');
  });
});
