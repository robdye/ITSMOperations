// ITSM Operations — Reviewer Worker (Phase 3.4)
//
// A second-pair-of-eyes worker that reviews the proposed plan / outputs
// of a workflow before they commit to source-of-truth systems. By
// default this is enabled for ANY worker whose `blastRadius` is ≥ 0.5.
//
// The reviewer:
//   - Loads the plan / outputs from the workflow execution context.
//   - Runs deterministic safety checks (no obvious destructive verbs
//     in unauthorized fields, RFC includes rollback plan, change has a
//     CAB approver, etc.).
//   - Emits a verdict { ok, concerns[], blocking? } that the trigger
//     decision can fold in.
//
// Wire-up: callers invoke `requireReviewIfBlastRadius()` ONLY when
// `worker.blastRadius >= REVIEWER_THRESHOLD` (default 0.5). The verdict
// is returned synchronously; if blocking, the workflow drops to
// `propose` mode so a human signs off.
//
// Single numeric KPI: review_block_rate.

import { logAuditEntry } from './audit-trail';

export interface ReviewVerdict {
  ok: boolean;
  blocking: boolean;
  concerns: string[];
  reviewedAt: string;
}

export interface ReviewablePlan {
  workflowId: string;
  workerId: string;
  blastRadius: number;
  plan?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  signalSummary?: string;
}

const REVIEWER_THRESHOLD = Number(process.env.REVIEWER_BLAST_THRESHOLD || 0.5);
const reviewerKpi = {
  reviews: 0,
  blocked: 0,
  passed: 0,
  startedAt: Date.now(),
};

export function getReviewerKpi(): {
  reviews: number;
  blocked: number;
  passed: number;
  blockRate: number;
  uptimeSec: number;
} {
  const blockRate = reviewerKpi.reviews > 0 ? reviewerKpi.blocked / reviewerKpi.reviews : 0;
  return {
    reviews: reviewerKpi.reviews,
    blocked: reviewerKpi.blocked,
    passed: reviewerKpi.passed,
    blockRate: Math.round(blockRate * 1000) / 1000,
    uptimeSec: Math.round((Date.now() - reviewerKpi.startedAt) / 1000),
  };
}

export function requiresReview(blastRadius: number): boolean {
  return blastRadius >= REVIEWER_THRESHOLD;
}

/** Deterministic safety checks. */
function inspect(plan: ReviewablePlan): string[] {
  const concerns: string[] = [];
  const stringified = JSON.stringify(plan.plan || plan.outputs || {}).toLowerCase();

  // 1. Destructive verbs in unauthorised fields.
  const dangerous = ['drop table', 'delete from', 'rm -rf', 'truncate', 'shutdown -h', 'force-delete'];
  for (const v of dangerous) {
    if (stringified.includes(v)) concerns.push(`destructive verb detected: "${v}"`);
  }

  // 2. Change RFC must mention rollback plan.
  if (plan.workflowId.includes('change') && plan.plan) {
    const planText = JSON.stringify(plan.plan).toLowerCase();
    if (!planText.includes('rollback')) {
      concerns.push('change plan missing rollback');
    }
  }

  // 3. Major incident response should never claim resolution without
  // worknote / KB linkage in outputs.
  if (plan.workflowId === 'major-incident-response' && plan.outputs) {
    const o = plan.outputs as Record<string, unknown>;
    if (o['claims_resolved'] && !o['evidence_url'] && !o['kb_sys_id']) {
      concerns.push('major-incident claim of resolution lacks evidence URL or KB');
    }
  }

  // 4. blastRadius >= 0.8 with no approver listed → block.
  if (plan.blastRadius >= 0.8 && plan.plan) {
    const planText = JSON.stringify(plan.plan).toLowerCase();
    if (!planText.includes('approver') && !planText.includes('cab')) {
      concerns.push('high blast radius (>=0.8) without named approver/CAB');
    }
  }

  return concerns;
}

export async function reviewPlan(plan: ReviewablePlan): Promise<ReviewVerdict> {
  reviewerKpi.reviews += 1;
  const concerns = inspect(plan);
  const blocking = concerns.length > 0;
  if (blocking) {
    reviewerKpi.blocked += 1;
  } else {
    reviewerKpi.passed += 1;
  }
  const verdict: ReviewVerdict = {
    ok: !blocking,
    blocking,
    concerns,
    reviewedAt: new Date().toISOString(),
  };
  await logAuditEntry({
    workerId: 'reviewer-worker',
    workerName: 'Reviewer Worker',
    toolName: `review.${plan.workflowId}`,
    riskLevel: blocking ? 'block' : 'read',
    triggeredBy: plan.signalSummary || plan.workerId,
    triggerType: 'escalation',
    parameters: JSON.stringify({ workflowId: plan.workflowId, blastRadius: plan.blastRadius }),
    resultSummary: blocking ? `BLOCKED: ${concerns.join('; ')}` : 'review passed',
    requiredConfirmation: false,
    durationMs: 0,
  }).catch(() => {});
  return verdict;
}

/**
 * Convenience wrapper: returns null when no review is required, the verdict
 * otherwise.
 */
export async function requireReviewIfBlastRadius(plan: ReviewablePlan): Promise<ReviewVerdict | null> {
  if (!requiresReview(plan.blastRadius)) return null;
  return reviewPlan(plan);
}
