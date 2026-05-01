// Phase 9.4 — experiential incident memory tests

import { describe, it, expect, beforeEach } from 'vitest';
import type { Signal } from '../signal-router';
import {
  tokenize,
  jaccard,
  recordExperience,
  findPriorPattern,
  getExperientialMemory,
  _resetExperiential,
} from '../experiential-memory';

function mkSignal(overrides: Partial<Signal>): Signal {
  return {
    id: overrides.id ?? `sig-${Math.random().toString(36).slice(2, 8)}`,
    source: overrides.source ?? 'servicenow',
    type: overrides.type ?? 'incident.high',
    severity: overrides.severity ?? 'high',
    asset: overrides.asset,
    payload: overrides.payload ?? { service: 'api', region: 'eus' },
    occurredAt: overrides.occurredAt ?? new Date().toISOString(),
    origin: overrides.origin ?? 'observed',
  } as Signal;
}

describe('experiential-memory', () => {
  beforeEach(() => {
    _resetExperiential();
    delete process.env.AUDIT_STORAGE_CONNECTION_STRING;
  });

  it('tokenizes a signal into a non-empty bag of strings', () => {
    const s = mkSignal({ asset: 'svc-payments', payload: { region: 'eus', latency: 1200 } });
    const t = tokenize(s);
    expect(t).toContain('type:incident.high');
    expect(t).toContain('sev:high');
    expect(t).toContain('asset:svc-payments');
    expect(t.length).toBeGreaterThan(3);
  });

  it('jaccard returns 1.0 for identical token bags and 0 for disjoint', () => {
    const a = ['a', 'b', 'c'];
    const b = ['a', 'b', 'c'];
    const c = ['x', 'y', 'z'];
    expect(jaccard(a, b)).toBeCloseTo(1, 5);
    expect(jaccard(a, c)).toBe(0);
  });

  it('records a fingerprint and finds similar prior patterns', () => {
    const past = mkSignal({ id: 'old1', asset: 'svc-payments', payload: { region: 'eus' } });
    recordExperience(past, 'success', 5 * 60 * 1000);
    const newer = mkSignal({ id: 'new1', asset: 'svc-payments', payload: { region: 'eus' } });
    const result = findPriorPattern(newer, { topK: 3, minSimilarity: 0.3 });
    expect(result.matches.length).toBe(1);
    expect(result.attempts).toBe(1);
    expect(result.successRate).toBe(1);
    expect(result.suggestedConfidenceDelta).toBeGreaterThan(0);
    expect(result.avgResolutionMs).toBe(5 * 60 * 1000);
  });

  it('produces a negative confidence delta when prior patterns failed', () => {
    for (let i = 0; i < 3; i++) {
      recordExperience(mkSignal({ id: `f${i}`, asset: 'svc-orders', payload: { region: 'eus' } }), 'failure');
    }
    const result = findPriorPattern(
      mkSignal({ id: 'curr', asset: 'svc-orders', payload: { region: 'eus' } }),
      { minSimilarity: 0.3 },
    );
    expect(result.matches.length).toBe(3);
    expect(result.successRate).toBe(0);
    expect(result.suggestedConfidenceDelta).toBeLessThan(0);
  });

  it('does not match dissimilar signals at high precision threshold', () => {
    recordExperience(
      mkSignal({
        id: 'a',
        type: 'change.implemented',
        asset: 'svc-billing',
        source: 'azure-devops',
        payload: { rolloutId: 'r-42', region: 'wus' },
      }),
      'success',
    );
    const result = findPriorPattern(
      mkSignal({
        id: 'b',
        type: 'incident.high',
        asset: 'svc-payments',
        source: 'servicenow',
        payload: { ticket: 'INC-9999', region: 'eus' },
      }),
      { minSimilarity: 0.7 },
    );
    expect(result.matches.length).toBe(0);
    expect(result.attempts).toBe(0);
    expect(result.suggestedConfidenceDelta).toBe(0);
  });

  it('getExperientialMemory returns reverse-chronological entries', () => {
    recordExperience(mkSignal({ id: 'first' }), 'success');
    recordExperience(mkSignal({ id: 'second' }), 'failure');
    const recent = getExperientialMemory(10);
    expect(recent.length).toBe(2);
    expect(recent[0].signalId).toBe('second');
    expect(recent[1].signalId).toBe('first');
  });
});
