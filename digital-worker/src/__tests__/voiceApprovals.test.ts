// Phase 4 — voiceApprovals smoke tests.
//
// Pure-function tests over classifyVoiceIntent: deny/approve/hold/unknown
// across happy + edge cases (negation, empty, whitespace).

import { describe, it, expect } from 'vitest';
import {
  classifyVoiceIntent,
  getVoiceApprovalKpi,
} from '../voice/voiceApprovals';

describe('voiceApprovals: classifyVoiceIntent', () => {
  it('returns "approve" for clear approve phrases', () => {
    const cases = [
      'yes go ahead',
      'approve it',
      'looks good, proceed',
      'signed off',
      'ship it',
    ];
    for (const u of cases) {
      const r = classifyVoiceIntent(u);
      expect(r.intent).toBe('approve');
      expect(r.confidence).toBeGreaterThan(0.5);
    }
  });

  it('returns "deny" for clear deny phrases', () => {
    const cases = [
      'reject it',
      'deny that',
      'declined',
      'no go',
      'cancel this',
      'kill it',
    ];
    for (const u of cases) {
      const r = classifyVoiceIntent(u);
      expect(r.intent).toBe('deny');
    }
  });

  it('returns "hold" for delay phrases', () => {
    const cases = ['hold on', 'not yet', 'give me a minute', 'check back'];
    for (const u of cases) {
      const r = classifyVoiceIntent(u);
      expect(r.intent).toBe('hold');
    }
  });

  it('returns "unknown" for empty / whitespace / nonsense input', () => {
    expect(classifyVoiceIntent('').intent).toBe('unknown');
    expect(classifyVoiceIntent('   ').intent).toBe('unknown');
    expect(classifyVoiceIntent('the quick brown fox').intent).toBe('unknown');
    expect(classifyVoiceIntent(null as unknown as string).intent).toBe('unknown');
  });

  it('treats negated approve phrases as unknown (safer than auto-approve)', () => {
    const r = classifyVoiceIntent('no, not really');
    expect(r.intent).toBe('unknown');
  });

  it('emits a confidence in [0, 1] for every classification', () => {
    const cases = ['yes', 'no', 'hold on', 'random text', ''];
    for (const u of cases) {
      const r = classifyVoiceIntent(u);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('voiceApprovals: KPI surface', () => {
  it('getVoiceApprovalKpi exposes the documented shape', () => {
    const kpi = getVoiceApprovalKpi();
    expect(kpi).toMatchObject({
      utterancesProcessed: expect.any(Number),
      resolved: expect.any(Number),
      resolutionRate: expect.any(Number),
      byIntent: expect.objectContaining({
        approve: expect.any(Number),
        deny: expect.any(Number),
        hold: expect.any(Number),
        unknown: expect.any(Number),
      }),
      uptimeSec: expect.any(Number),
    });
  });
});
