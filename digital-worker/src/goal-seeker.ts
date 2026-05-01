// ITSM Operations — Goal Seeker (Pillar 5 of the Anticipatory-Alex architecture)
//
// Given a high-level objective ("restore service X", "investigate cluster of
// auth failures", "stage Patch Tuesday RFCs") the goal-seeker decomposes the
// objective into a *plan* — an ordered sequence of workflow invocations and
// optional decision branches. It re-plans on failure and falls through to
// the next viable workflow.
//
// This is intentionally a small, explicit planner: it consumes a short
// catalog of objective→plan recipes and uses the LLM only for novel
// objectives (via runWorker on the orchestrator). Every step routes through
// the existing workflow-engine + trigger-policy so all guardrails apply.

import type { WorkflowEngine } from './workflow-engine';

// ── Types ──

export interface GoalStep {
  workflowId: string;
  description: string;
  /** Optional context to pass into the workflow execution. */
  context?: Record<string, unknown>;
  /** Optional fallback workflowId on failure. */
  onFailure?: string;
}

export interface GoalPlan {
  goal: string;
  steps: GoalStep[];
}

export interface GoalRunReport {
  goal: string;
  attempted: Array<{
    step: GoalStep;
    status: 'completed' | 'failed' | 'paused';
    finalOutput?: string;
  }>;
  status: 'success' | 'partial' | 'failed';
}

// ── Recipe catalog ──

const recipes = new Map<string, GoalPlan>();

export function registerRecipe(matcher: string, plan: GoalPlan): void {
  recipes.set(matcher.toLowerCase(), plan);
}

export function _resetGoalSeeker(): void {
  recipes.clear();
  registerDefaultRecipes();
}

export function getRegisteredRecipes(): GoalPlan[] {
  return [...recipes.values()];
}

function registerDefaultRecipes(): void {
  registerRecipe('restore service', {
    goal: 'restore service',
    steps: [
      {
        workflowId: 'major-incident-response',
        description: 'Triage, bridge, notify, coordinate restore.',
        onFailure: 'reasoning-rca',
      },
      {
        workflowId: 'reasoning-rca',
        description: 'If incident response paused, run reasoning-RCA in parallel.',
      },
      {
        workflowId: 'knowledge-harvest',
        description: 'Capture knowledge from the resolution.',
      },
    ],
  });
  registerRecipe('cluster of auth failures', {
    goal: 'cluster of auth failures',
    steps: [
      {
        workflowId: 'incident-to-problem',
        description: 'Promote recurring incidents to a problem record.',
      },
      {
        workflowId: 'reasoning-rca',
        description: 'Run reasoning-RCA on the new problem.',
      },
      {
        workflowId: 'knowledge-harvest',
        description: 'Publish findings as KB.',
      },
    ],
  });
  registerRecipe('patch tuesday', {
    goal: 'patch tuesday',
    steps: [
      {
        workflowId: 'vulnerability-to-change',
        description: 'Draft RFCs for security findings.',
      },
      {
        workflowId: 'monday-cab-prep',
        description: 'Schedule CAB review.',
      },
    ],
  });
}

registerDefaultRecipes();

// ── Planner ──

export function planForGoal(goal: string): GoalPlan {
  const lower = goal.toLowerCase();
  for (const [matcher, plan] of recipes) {
    if (lower.includes(matcher)) return plan;
  }
  // Default no-op plan for novel goals — caller can then escalate to the
  // orchestrator for LLM planning. We return a single-step probe.
  return {
    goal,
    steps: [
      {
        workflowId: 'major-incident-response',
        description: `No recipe registered for goal "${goal}" — defaulting to incident response triage.`,
      },
    ],
  };
}

// ── Executor ──

export interface PursueOptions {
  context?: Record<string, unknown>;
  /** Stop on first failure. Default false: try fallbacks. */
  stopOnFailure?: boolean;
}

export async function pursueGoal(
  engine: WorkflowEngine,
  goal: string,
  opts: PursueOptions = {}
): Promise<GoalRunReport> {
  const plan = planForGoal(goal);
  const report: GoalRunReport = {
    goal,
    attempted: [],
    status: 'failed',
  };
  let anyOk = false;
  let allOk = true;
  for (const step of plan.steps) {
    const merged = { ...(opts.context ?? {}), ...(step.context ?? {}) };
    let result;
    try {
      result = await engine.executeWorkflow(step.workflowId, merged);
    } catch (err) {
      report.attempted.push({ step, status: 'failed', finalOutput: (err as Error).message });
      allOk = false;
      if (opts.stopOnFailure) break;
      if (step.onFailure) {
        try {
          const fb = await engine.executeWorkflow(step.onFailure, merged);
          report.attempted.push({
            step: { ...step, workflowId: step.onFailure, description: `fallback for ${step.workflowId}` },
            status: fb.status,
            finalOutput: fb.finalOutput,
          });
          if (fb.status === 'completed') anyOk = true;
        } catch (fallbackErr) {
          report.attempted.push({
            step: { ...step, workflowId: step.onFailure, description: `fallback for ${step.workflowId}` },
            status: 'failed',
            finalOutput: (fallbackErr as Error).message,
          });
        }
      }
      continue;
    }
    report.attempted.push({ step, status: result.status, finalOutput: result.finalOutput });
    if (result.status === 'completed') anyOk = true;
    else allOk = false;
    if (result.status === 'failed' && opts.stopOnFailure) break;
  }
  report.status = allOk && anyOk ? 'success' : anyOk ? 'partial' : 'failed';
  return report;
}
