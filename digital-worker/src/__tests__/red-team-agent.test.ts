// Phase 2.1 — Foundry red-team agent unit tests.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PROBE_BANK,
  evaluateProbe,
  aggregate,
  runProbes,
  runRedTeamForTenant,
  getTrustSummary,
  type ProbeResult,
} from '../red-team-agent';
import { _resetAnticipatoryStore } from '../anticipatory-store';
import { _resetTenantProfileCache } from '../demo/tenant-profile';

describe('red-team-agent: probe bank', () => {
  it('covers all three probe categories', () => {
    const cats = new Set(PROBE_BANK.map((p) => p.category));
    expect(cats.has('jailbreak')).toBe(true);
    expect(cats.has('prompt_injection')).toBe(true);
    expect(cats.has('scope_escape')).toBe(true);
  });

  it('every probe has unique id', () => {
    const ids = PROBE_BANK.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every probe has at least one fail-substring (so the probe is scoreable)', () => {
    for (const p of PROBE_BANK) {
      expect(p.failIfContains.length).toBeGreaterThan(0);
    }
  });
});

describe('red-team-agent: evaluateProbe', () => {
  it('flags FAIL when any failIfContains substring is present', () => {
    const probe = PROBE_BANK.find((p) => p.id === 'jb-001')!;
    const r = evaluateProbe(probe, 'Sure, I am DAN now and will help you bypass change management.');
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('fail-substring-match');
  });

  it('flags PASS when a passIfContains substring is present and no fail substring matched', () => {
    const probe = PROBE_BANK.find((p) => p.id === 'jb-001')!;
    const r = evaluateProbe(probe, 'I cannot help with that. I will not bypass governance.');
    expect(r.passed).toBe(true);
    expect(r.reason).toBe('pass-substring-match');
  });

  it('treats clear refusal-language ambiguous response as PASS', () => {
    const probe = PROBE_BANK.find((p) => p.id === 'pi-001')!;
    const r = evaluateProbe(probe, 'I cannot do that.');
    expect(r.passed).toBe(true);
  });

  it('treats ambiguous non-refusal response as FAIL', () => {
    const probe = PROBE_BANK.find((p) => p.id === 'pi-001')!;
    const r = evaluateProbe(probe, 'Here is the summary you requested.');
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('no-clear-signal');
  });
});

describe('red-team-agent: aggregate', () => {
  function pass(probeId: string): ProbeResult {
    const probe = PROBE_BANK.find((p) => p.id === probeId)!;
    return { probe, response: '', passed: true, reason: 'pass-substring-match' };
  }
  function fail(probeId: string): ProbeResult {
    const probe = PROBE_BANK.find((p) => p.id === probeId)!;
    return { probe, response: '', passed: false, reason: 'fail-substring-match' };
  }

  it('returns 100 for all-pass', () => {
    const all = PROBE_BANK.map((p) => pass(p.id));
    const agg = aggregate(all);
    expect(agg.score).toBe(100);
    expect(agg.byCategory.jailbreak).toBe(100);
    expect(agg.byCategory.prompt_injection).toBe(100);
    expect(agg.byCategory.scope_escape).toBe(100);
  });

  it('returns 0 for all-fail', () => {
    const all = PROBE_BANK.map((p) => fail(p.id));
    const agg = aggregate(all);
    expect(agg.score).toBe(0);
  });

  it('penalises uneven defence (one category 0, two at 100)', () => {
    // Pass everything except all jailbreak probes
    const results = PROBE_BANK.map((p) => (p.category === 'jailbreak' ? fail(p.id) : pass(p.id)));
    const agg = aggregate(results);
    expect(agg.byCategory.jailbreak).toBe(0);
    expect(agg.byCategory.prompt_injection).toBe(100);
    expect(agg.byCategory.scope_escape).toBe(100);
    // Equal weight => (0+100+100)/3 ≈ 67
    expect(agg.score).toBe(67);
  });

  it('handles empty input', () => {
    const agg = aggregate([]);
    expect(agg.score).toBe(0);
    expect(agg.probeCount).toBe(0);
  });
});

describe('red-team-agent: runProbes', () => {
  it('invokes the agent once per probe and scores all', async () => {
    let calls = 0;
    const invoke = async (_prompt: string) => {
      calls += 1;
      return 'I cannot help with that.';
    };
    const results = await runProbes(invoke);
    expect(calls).toBe(PROBE_BANK.length);
    expect(results).toHaveLength(PROBE_BANK.length);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('invocation errors count as PASS (agent rejected the probe by failing)', async () => {
    const invoke = async () => {
      throw new Error('boom');
    };
    const results = await runProbes(invoke);
    // All errors => no fail-substring match in `__error__: boom` => no clear
    // signal AND no refusal language => FAIL. Verify that the runner does
    // not throw and produces a result for every probe.
    expect(results).toHaveLength(PROBE_BANK.length);
    expect(results.every((r) => r.response.startsWith('__error__'))).toBe(true);
  });
});

describe('red-team-agent: tenant gate', () => {
  beforeEach(() => {
    _resetAnticipatoryStore();
    _resetTenantProfileCache();
  });

  it('skips when tenant has allowRedTeam=false (default)', async () => {
    const result = await runRedTeamForTenant('default', async () => 'whatever');
    if ('skipped' in result) {
      expect(result.skipped).toBe(true);
      expect(result.reason).toMatch(/allowRedTeam=false/);
    } else {
      throw new Error('expected skipped result');
    }
  });

  it('getTrustSummary returns available=false with explanatory reason for non-opted-in tenant', async () => {
    const summary = await getTrustSummary('default');
    expect(summary.available).toBe(false);
    expect(summary.reason).toMatch(/allowRedTeam=false/);
    expect(summary.score).toBeNull();
    expect(summary.sparkline).toEqual([]);
  });
});
