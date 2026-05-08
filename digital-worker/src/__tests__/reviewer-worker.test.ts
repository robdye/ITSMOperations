// Phase 4 — reviewer-worker smoke tests.
//
// Deterministic safety-rule tests covering all four inspect() rules:
//   1. destructive verbs
//   2. change-RFC missing rollback
//   3. major-incident claiming resolution without evidence
//   4. high blast radius (>=0.8) without named approver/CAB

import { describe, it, expect } from 'vitest';
import {
  reviewPlan,
  requiresReview,
  requireReviewIfBlastRadius,
  getReviewerKpi,
  type ReviewablePlan,
} from '../reviewer-worker';

const baseplan = (overrides: Partial<ReviewablePlan> = {}): ReviewablePlan => ({
  workflowId: 'demo-workflow',
  workerId: 'demo-worker',
  blastRadius: 0.1,
  plan: {},
  ...overrides,
});

describe('reviewer-worker', () => {
  it('passes a benign plan', async () => {
    const v = await reviewPlan(baseplan());
    expect(v.ok).toBe(true);
    expect(v.blocking).toBe(false);
    expect(v.concerns.length).toBe(0);
  });

  it('blocks a destructive verb in the plan', async () => {
    const v = await reviewPlan(baseplan({ plan: { sql: 'drop table users' } }));
    expect(v.ok).toBe(false);
    expect(v.blocking).toBe(true);
    expect(v.concerns.some((c) => c.includes('destructive verb'))).toBe(true);
  });

  it('blocks a change RFC missing rollback', async () => {
    const v = await reviewPlan(baseplan({ workflowId: 'change-rfc', plan: { steps: ['apply patch'] } }));
    expect(v.ok).toBe(false);
    expect(v.concerns.some((c) => c.includes('rollback'))).toBe(true);
  });

  it('blocks a major-incident claim of resolution without evidence', async () => {
    const v = await reviewPlan(
      baseplan({
        workflowId: 'major-incident-response',
        outputs: { claims_resolved: true },
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.concerns.some((c) => c.includes('lacks evidence'))).toBe(true);
  });

  it('blocks high blast-radius (>=0.8) without an approver', async () => {
    const v = await reviewPlan(
      baseplan({ blastRadius: 0.9, plan: { description: 'restart prod cluster' } }),
    );
    expect(v.ok).toBe(false);
    expect(v.concerns.some((c) => c.includes('high blast radius'))).toBe(true);
  });

  it('requiresReview honours REVIEWER_BLAST_THRESHOLD (default 0.5)', () => {
    expect(requiresReview(0.1)).toBe(false);
    expect(requiresReview(0.6)).toBe(true);
  });

  it('requireReviewIfBlastRadius returns null for low blast', async () => {
    const v = await requireReviewIfBlastRadius(baseplan({ blastRadius: 0.1 }));
    expect(v).toBeNull();
  });

  it('requireReviewIfBlastRadius runs review when blast meets threshold', async () => {
    const v = await requireReviewIfBlastRadius(baseplan({ blastRadius: 0.6 }));
    expect(v).not.toBeNull();
  });

  it('getReviewerKpi exposes review counters', () => {
    const kpi = getReviewerKpi();
    expect(kpi).toMatchObject({
      reviews: expect.any(Number),
      blocked: expect.any(Number),
      passed: expect.any(Number),
      blockRate: expect.any(Number),
      uptimeSec: expect.any(Number),
    });
  });
});
