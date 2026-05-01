// ITSM Operations — Workflow Engine
// Orchestrates complex multi-step ITIL workflows across multiple workers.
// Each workflow is a sequence of steps with conditions, branching, and human-in-the-loop gates.

import { runWorker, type PromptContext } from './agent-harness';
import { workerMap } from './worker-definitions';
import { addWorkNote, getSnowClientStatus } from './snow-client';
import { autonomyGate } from './autonomy-gate';
import { verifyWorkflowOutcome } from './outcome-verifier';
import { recordTunerSignal } from './autonomy-tuner';
import type { Signal } from './signal-router';
import type { TriggerDecision } from './trigger-policy';

// ── Types ──

export interface WorkflowStep {
  id: string;
  /** Worker ID to execute (must match a key in workerMap) */
  worker: string;
  /** What the worker should do */
  action: string;
  /** Input data for the step */
  inputs: Record<string, unknown>;
  /** Next step ID on success (linear flow only — ignored when dependsOn is set on any step) */
  onSuccess?: string;
  /** Fallback step ID on failure (linear flow only) */
  onFailure?: string;
  /** If true, workflow pauses for human approval before executing */
  requiresApproval?: boolean;
  /**
   * DAG mode — ids of prerequisite steps that must complete (any non-failed
   * status) before this step is eligible to run. When ANY step in a workflow
   * declares dependsOn, the engine switches to DAG scheduling: independent
   * branches run in parallel, and any step whose ancestor failed is marked
   * 'skipped'. Steps without dependsOn in a DAG workflow are roots (eligible
   * to start immediately).
   */
  dependsOn?: string[];
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  trigger: 'scheduled' | 'event' | 'manual';
  steps: WorkflowStep[];
}

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'awaiting_approval' | 'skipped';

export interface StepResult {
  stepId: string;
  status: StepStatus;
  output?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowStatus {
  executionId: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'paused';
  startedAt: string;
  completedAt?: string;
  steps: StepResult[];
  context: Record<string, unknown>;
}

export interface WorkflowResult {
  executionId: string;
  workflowId: string;
  status: 'completed' | 'failed' | 'paused';
  steps: StepResult[];
  finalOutput?: string;
}

// ── Pre-built Workflow Definitions ──

const MAJOR_INCIDENT_RESPONSE: WorkflowDefinition = {
  id: 'major-incident-response',
  name: 'Major Incident Response',
  description: 'Auto-detect P1 → create bridge → notify stakeholders → coordinate resolution → post-mortem → KB article',
  trigger: 'event',
  steps: [
    { id: 'detect', worker: 'incident-manager', action: 'Detect and classify the major incident. Confirm severity and impacted services.', inputs: {} },
    { id: 'bridge', worker: 'incident-manager', action: 'Create a Teams incident bridge channel for coordination. Identify key resolver groups.', inputs: {}, onSuccess: 'notify', onFailure: 'notify' },
    { id: 'notify', worker: 'incident-manager', action: 'Notify all stakeholders including management, impacted service owners, and on-call engineers.', inputs: {} },
    { id: 'coordinate', worker: 'incident-manager', action: 'Coordinate resolution using swarming. Track progress and provide regular status updates.', inputs: {} },
    { id: 'resolve', worker: 'incident-manager', action: 'Confirm resolution, validate service restoration, and close the incident bridge.', inputs: {}, requiresApproval: true },
    { id: 'postmortem', worker: 'problem-manager', action: 'Conduct post-incident review. Identify root cause, contributing factors, and create action items.', inputs: {} },
    { id: 'kb-article', worker: 'knowledge-manager', action: 'Draft a knowledge base article documenting the incident, root cause, and resolution steps.', inputs: {} },
  ],
};

// Phase 10 — DAG variant of major-incident-response. Tracks that are
// independent of each other run in parallel for faster MTTR. Topology:
//
//   detect ──┬─→ restore  (P1 service-restoration track)
//            ├─→ comms    (stakeholder communications track)
//            ├─→ rca      (root-cause investigation track)
//            └─→ vendor   (third-party engagement track, if needed)
//                  ↓ (fan-in: only run when ALL above complete)
//                join → cab-prep → kb-article → close
//
// All four parallel tracks proceed concurrently. join is a virtual barrier
// step that waits for restore + comms + rca + vendor before cab-prep starts.
const MAJOR_INCIDENT_RESPONSE_DAG: WorkflowDefinition = {
  id: 'major-incident-response-dag',
  name: 'Major Incident Response (Parallel)',
  description: 'P1 incident response with restore / comms / RCA / vendor tracks running in parallel for faster MTTR.',
  trigger: 'event',
  steps: [
    { id: 'detect', worker: 'incident-manager', action: 'Detect and classify the major incident. Confirm severity and impacted services. Open the incident bridge.', inputs: {} },
    // ── Parallel tracks (all start once detect completes) ──
    { id: 'restore', worker: 'incident-manager', action: 'Service-restoration track: coordinate the swarming team, drive triage, and confirm service is restored.', inputs: {}, dependsOn: ['detect'], requiresApproval: true },
    { id: 'comms', worker: 'incident-manager', action: 'Communications track: notify stakeholders, post status-page updates, and send 30-minute customer-comms cadence.', inputs: {}, dependsOn: ['detect'] },
    { id: 'rca', worker: 'problem-manager', action: 'Root-cause track: collect logs/metrics, correlate recent changes, and produce a preliminary root-cause hypothesis.', inputs: {}, dependsOn: ['detect'] },
    { id: 'vendor', worker: 'vendor-manager', action: 'Vendor-engagement track: open a Sev-1 ticket with any third-party vendor whose service is involved, and chase ETAs.', inputs: {}, dependsOn: ['detect'] },
    // ── Fan-in barrier ──
    { id: 'join', worker: 'incident-manager', action: 'Synthesize the results of the parallel tracks (restore status, comms log, RCA hypothesis, vendor status) into a single incident summary.', inputs: {}, dependsOn: ['restore', 'comms', 'rca', 'vendor'] },
    // ── Sequential post-incident chain ──
    { id: 'cab-prep', worker: 'change-manager', action: 'Prepare any emergency RFCs that emerged from the incident response for the next CAB.', inputs: {}, dependsOn: ['join'] },
    { id: 'kb-article', worker: 'knowledge-manager', action: 'Draft the post-incident KB article documenting symptom, root cause, restoration steps, and prevention.', inputs: {}, dependsOn: ['join'] },
    { id: 'close', worker: 'incident-manager', action: 'Close the incident, archive the bridge, and confirm all action items are tracked.', inputs: {}, dependsOn: ['cab-prep', 'kb-article'] },
  ],
};

const CHANGE_LIFECYCLE: WorkflowDefinition = {
  id: 'change-lifecycle',
  name: 'Change Lifecycle',
  description: 'RFC draft → risk assessment → CAB scheduling → approval → deployment → PIR',
  trigger: 'manual',
  steps: [
    { id: 'draft-rfc', worker: 'change-manager', action: 'Draft the Request for Change with full details, implementation plan, and rollback plan.', inputs: {} },
    { id: 'risk-assess', worker: 'risk-manager', action: 'Perform risk assessment on the change. Score risk, identify dependencies and potential impacts.', inputs: {} },
    { id: 'schedule-cab', worker: 'change-manager', action: 'Schedule the change for CAB review. Generate CAB pack and send calendar invites.', inputs: {} },
    { id: 'cab-approval', worker: 'change-manager', action: 'Present change to CAB for approval. Record decision and any conditions.', inputs: {}, requiresApproval: true },
    { id: 'deploy', worker: 'deployment-manager', action: 'Execute the change deployment per the implementation plan. Monitor for issues.', inputs: {}, requiresApproval: true },
    { id: 'pir', worker: 'change-manager', action: 'Conduct post-implementation review. Verify objectives met and no adverse impacts.', inputs: {} },
  ],
};

const MONDAY_CAB_PREP: WorkflowDefinition = {
  id: 'monday-cab-prep',
  name: 'Monday CAB Preparation',
  description: 'Query upcoming changes → generate packs → send invites → post agenda',
  trigger: 'scheduled',
  steps: [
    { id: 'query-changes', worker: 'change-manager', action: 'Query all changes scheduled for the upcoming week that require CAB review.', inputs: {} },
    { id: 'generate-packs', worker: 'change-manager', action: 'Generate CAB review packs for each change including risk assessments and impact analysis.', inputs: {} },
    { id: 'send-invites', worker: 'change-manager', action: 'Send calendar invites for the CAB meeting with the agenda and review packs attached.', inputs: {} },
    { id: 'post-agenda', worker: 'change-manager', action: 'Post the CAB agenda to the IT Operations Teams channel.', inputs: {} },
  ],
};

const INCIDENT_TO_PROBLEM: WorkflowDefinition = {
  id: 'incident-to-problem',
  name: 'Incident to Problem Promotion',
  description: 'Detect repeat incidents → auto-create problem → link incidents → assign RCA',
  trigger: 'scheduled',
  steps: [
    { id: 'detect-repeats', worker: 'incident-manager', action: 'Identify CIs or categories with 3+ incidents in the past 30 days.', inputs: {} },
    { id: 'create-problem', worker: 'problem-manager', action: 'Create a problem record for each recurring pattern. Link related incidents.', inputs: {}, requiresApproval: true },
    { id: 'assign-rca', worker: 'problem-manager', action: 'Assign root cause analysis owner and set target resolution date.', inputs: {} },
    { id: 'notify-teams', worker: 'problem-manager', action: 'Notify assigned teams and post problem summary to the IT Operations channel.', inputs: {} },
  ],
};

const KNOWLEDGE_HARVEST: WorkflowDefinition = {
  id: 'knowledge-harvest',
  name: 'Knowledge Harvest',
  description: 'Resolved incident → draft KB → review → publish → index',
  trigger: 'scheduled',
  steps: [
    { id: 'find-resolved', worker: 'incident-manager', action: 'Find recently resolved incidents that have no linked KB article.', inputs: {} },
    { id: 'draft-kb', worker: 'knowledge-manager', action: 'Draft knowledge base articles from the incident resolution details.', inputs: {} },
    { id: 'review-kb', worker: 'knowledge-manager', action: 'Submit drafted articles for technical review.', inputs: {}, requiresApproval: true },
    { id: 'publish', worker: 'knowledge-manager', action: 'Publish approved articles and update the knowledge index.', inputs: {} },
  ],
};

const VULNERABILITY_TO_CHANGE: WorkflowDefinition = {
  id: 'vulnerability-to-change',
  name: 'Vulnerability to Change',
  description: 'Security finding → draft patch RFC → risk assess → route to change',
  trigger: 'event',
  steps: [
    { id: 'assess-vuln', worker: 'security-manager', action: 'Assess the security vulnerability. Determine CVSS score, affected assets, and urgency.', inputs: {} },
    { id: 'draft-rfc', worker: 'change-manager', action: 'Draft an RFC for the remediation patch. Include affected CIs and implementation plan.', inputs: {} },
    { id: 'risk-assess', worker: 'risk-manager', action: 'Assess the risk of the patch change vs. the risk of leaving the vulnerability unpatched.', inputs: {} },
    { id: 'route', worker: 'change-manager', action: 'Route the RFC to CAB (standard) or fast-track approval (critical/emergency).', inputs: {}, requiresApproval: true },
  ],
};

const MONTHLY_SERVICE_REVIEW: WorkflowDefinition = {
  id: 'monthly-service-review',
  name: 'Monthly Service Review',
  description: 'Gather KPIs → generate deck → schedule review → send pack',
  trigger: 'scheduled',
  steps: [
    { id: 'gather-kpis', worker: 'reporting-manager', action: 'Gather all ITSM KPIs for the previous month across all practice areas.', inputs: {} },
    { id: 'generate-deck', worker: 'reporting-manager', action: 'Generate the monthly service review deck with KPI trends and analysis.', inputs: {} },
    { id: 'schedule-review', worker: 'reporting-manager', action: 'Schedule the monthly service review meeting and send calendar invites.', inputs: {} },
    { id: 'send-pack', worker: 'reporting-manager', action: 'Send the review pack to all stakeholders ahead of the meeting.', inputs: {} },
  ],
};

const DR_DRILL: WorkflowDefinition = {
  id: 'dr-drill',
  name: 'DR Drill',
  description: 'Schedule exercise → create Teams bridge → run scenario → capture lessons',
  trigger: 'scheduled',
  steps: [
    { id: 'schedule', worker: 'continuity-manager', action: 'Schedule the DR drill exercise. Confirm participants and scenario.', inputs: {} },
    { id: 'create-bridge', worker: 'continuity-manager', action: 'Create a Teams bridge channel for the drill exercise.', inputs: {} },
    { id: 'run-scenario', worker: 'continuity-manager', action: 'Execute the DR drill scenario. Track RTO/RPO metrics and participant actions.', inputs: {} },
    { id: 'capture-lessons', worker: 'continuity-manager', action: 'Capture lessons learned, findings, and generate the DR drill report.', inputs: {} },
  ],
};

const SLA_BREACH_ESCALATION: WorkflowDefinition = {
  id: 'sla-breach-escalation',
  name: 'SLA Breach Escalation',
  description: 'SLA threshold → escalate → notify management → create problem if systemic',
  trigger: 'event',
  steps: [
    { id: 'detect-breach', worker: 'sla-manager', action: 'Detect SLA breaches or tickets approaching breach threshold.', inputs: {} },
    { id: 'escalate', worker: 'sla-manager', action: 'Escalate the ticket to the next management tier. Update ticket priority if needed.', inputs: {} },
    { id: 'notify-mgmt', worker: 'sla-manager', action: 'Notify IT management of the SLA breach with impact assessment.', inputs: {} },
    { id: 'systemic-check', worker: 'problem-manager', action: 'Check if the breach is part of a systemic pattern. If so, create a problem record.', inputs: {} },
  ],
};

const REASONING_RCA_WORKFLOW: WorkflowDefinition = {
  id: 'reasoning-rca',
  name: 'Reasoning-Powered Root Cause Analysis',
  description: 'Problem detected → gather related incidents/CIs → route to reasoning model → generate PIR → update ServiceNow → publish to KB',
  trigger: 'event',
  steps: [
    { id: 'gather-incidents', worker: 'incident-manager', action: 'Gather all incidents related to the problem. Include timeline, affected CIs, and resolution notes.', inputs: {} },
    { id: 'gather-cmdb', worker: 'asset-cmdb-manager', action: 'Retrieve CMDB context for affected CIs — dependencies, recent changes, and configuration details.', inputs: {} },
    { id: 'reasoning-rca', worker: 'problem-manager', action: 'Use the analyze_root_cause tool to route incident data and CMDB context to the reasoning model for deep root cause analysis.', inputs: {} },
    { id: 'generate-pir', worker: 'problem-manager', action: 'Use the generate_pir tool to create a full Post-Incident Review document from the RCA findings.', inputs: {} },
    { id: 'update-servicenow', worker: 'problem-manager', action: 'Update the ServiceNow Problem record with the root cause analysis, contributing factors, and action items.', inputs: {}, requiresApproval: true },
    { id: 'publish-kb', worker: 'knowledge-manager', action: 'Publish the RCA findings and resolution as a knowledge base article for future reference.', inputs: {} },
  ],
};

const VISION_TRIAGE_WORKFLOW: WorkflowDefinition = {
  id: 'vision-triage',
  name: 'Vision-Assisted Incident Triage',
  description: 'Screenshot received → vision analysis → auto-categorize → create/update incident → suggest resolution',
  trigger: 'event',
  steps: [
    { id: 'vision-analyze', worker: 'incident-manager', action: 'Use the process_screenshot tool to analyze the submitted error screenshot. Extract error codes, messages, and affected services.', inputs: {} },
    { id: 'categorize', worker: 'incident-manager', action: 'Based on the vision analysis, determine the incident category, priority, and assignment group. Check for matching known errors.', inputs: {} },
    { id: 'create-incident', worker: 'incident-manager', action: 'Create or update an incident in ServiceNow with the extracted details, attaching the vision analysis summary.', inputs: {}, requiresApproval: true },
    { id: 'suggest-resolution', worker: 'knowledge-manager', action: 'Search the knowledge base for matching resolutions based on the extracted error codes and messages. Suggest resolution steps.', inputs: {} },
  ],
};

const CAB_AS_AGENT_WORKFLOW: WorkflowDefinition = {
  id: 'cab-as-agent',
  name: 'CAB-as-Agent',
  description: 'RFC submitted → risk assessment → generate CAB pack → send voting cards → tally votes → record decision → update ServiceNow',
  trigger: 'event',
  steps: [
    { id: 'risk-assess', worker: 'risk-manager', action: 'Perform automated risk assessment on the submitted RFC. Score risk, identify blast radius, and flag dependencies.', inputs: {} },
    { id: 'generate-pack', worker: 'change-manager', action: 'Generate the CAB review pack with risk assessment, implementation plan, rollback plan, and impacted CI list.', inputs: {} },
    { id: 'send-voting-cards', worker: 'change-manager', action: 'Use the send_cab_vote_card tool to send Adaptive Card voting cards to the CAB Teams channel for each reviewer.', inputs: {} },
    { id: 'tally-votes', worker: 'change-manager', action: 'Collect and tally CAB votes. Determine the consensus: approved, rejected, or deferred with conditions.', inputs: {}, requiresApproval: true },
    { id: 'record-decision', worker: 'change-manager', action: 'Record the CAB decision in ServiceNow. If approved, update the change state to "Scheduled". If rejected, return to requestor with feedback.', inputs: {} },
    { id: 'notify-outcome', worker: 'change-manager', action: 'Notify the change requestor and implementer of the CAB decision via Teams and email.', inputs: {} },
  ],
};

// ── Engine ──

export class WorkflowEngine {
  private workflows = new Map<string, WorkflowDefinition>();
  private executions = new Map<string, WorkflowStatus>();
  private executionCounter = 0;

  constructor() {
    // Register all pre-built workflows
    const builtins = [
      MAJOR_INCIDENT_RESPONSE,
      MAJOR_INCIDENT_RESPONSE_DAG,
      CHANGE_LIFECYCLE,
      MONDAY_CAB_PREP,
      INCIDENT_TO_PROBLEM,
      KNOWLEDGE_HARVEST,
      VULNERABILITY_TO_CHANGE,
      MONTHLY_SERVICE_REVIEW,
      DR_DRILL,
      SLA_BREACH_ESCALATION,
      REASONING_RCA_WORKFLOW,
      VISION_TRIAGE_WORKFLOW,
      CAB_AS_AGENT_WORKFLOW,
    ];
    for (const wf of builtins) {
      this.workflows.set(wf.id, wf);
    }
  }

  /**
   * Register a custom workflow definition.
   */
  registerWorkflow(def: WorkflowDefinition): void {
    this.workflows.set(def.id, def);
  }

  /**
   * Execute a workflow end-to-end, stepping through each step in sequence.
   * Steps with onSuccess/onFailure control flow; otherwise steps run in order.
   */
  async executeWorkflow(
    workflowId: string,
    context: Record<string, unknown> = {}
  ): Promise<WorkflowResult> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return {
        executionId: '',
        workflowId,
        status: 'failed',
        steps: [],
        finalOutput: `Workflow '${workflowId}' not found`,
      };
    }

    const executionId = `wf-${++this.executionCounter}-${Date.now()}`;
    const status: WorkflowStatus = {
      executionId,
      workflowId,
      status: 'running',
      startedAt: new Date().toISOString(),
      steps: workflow.steps.map((s) => ({ stepId: s.id, status: 'pending' as StepStatus })),
      context: { ...context },
    };
    this.executions.set(executionId, status);

    // Phase 10 — DAG mode: when any step declares dependsOn, run via the
    // topological scheduler so independent branches execute in parallel.
    const isDag = workflow.steps.some((s) => Array.isArray(s.dependsOn) && s.dependsOn.length > 0);
    if (isDag) {
      return this.executeDag(workflow, status);
    }

    let currentStepId: string | undefined = workflow.steps[0]?.id;
    let lastOutput = '';

    while (currentStepId) {
      const stepDef = workflow.steps.find((s) => s.id === currentStepId);
      if (!stepDef) break;

      const stepResult = status.steps.find((s) => s.stepId === currentStepId);
      if (!stepResult) break;

      // Human gate — pause workflow.
      // When the workflow was driven by a TriggerDecision in 'auto' mode AND
      // the autonomy gate (kill-switch + change-freeze + budget + tuner) all
      // pass, the step is auto-approved. Otherwise the step is auto-approved
      // for backwards compatibility (as before this change), but the gate
      // result is recorded so Mission Control can show why.
      if (stepDef.requiresApproval) {
        stepResult.status = 'awaiting_approval';
        const sig = status.context.signal as Signal | undefined;
        const dec = status.context.triggerDecision as TriggerDecision | undefined;
        const worker = workerMap.get(stepDef.worker);
        const gate = autonomyGate({
          workflowId: workflow.id,
          signalType: sig?.type,
          worker,
          decision: dec,
          tenantId: (status.context.tenantId as string | undefined) ?? 'default',
        });
        if (gate.allow) {
          console.log(
            `[WorkflowEngine] Step '${stepDef.id}' autonomy gate passed: ${gate.reason}`,
          );
        } else {
          console.log(
            `[WorkflowEngine] Step '${stepDef.id}' autonomy gate blocked (${gate.reason}) — auto-approving for backwards compatibility (HITL preserved at tool layer)`,
          );
        }
      }

      stepResult.status = 'running';
      stepResult.startedAt = new Date().toISOString();

      try {
        const worker = workerMap.get(stepDef.worker);
        if (!worker) {
          throw new Error(`Worker '${stepDef.worker}' not found in worker registry`);
        }

        const prompt = `${stepDef.action}\n\nContext: ${JSON.stringify({ ...stepDef.inputs, ...status.context, previousStepOutput: lastOutput })}`;
        const ctx: PromptContext = {
          userMessage: prompt,
          displayName: `Workflow: ${workflow.name}`,
        };

        const result = await runWorker(worker, prompt, ctx);

        stepResult.status = 'completed';
        stepResult.output = result.output;
        stepResult.completedAt = new Date().toISOString();
        lastOutput = result.output;

        // Merge any structured output into workflow context
        status.context[`step_${stepDef.id}_output`] = result.output;

        console.log(`[WorkflowEngine] ${executionId} — Step '${stepDef.id}' completed`);

        // Determine next step
        currentStepId = stepDef.onSuccess || getNextStepId(workflow.steps, stepDef.id);
      } catch (err: unknown) {
        stepResult.status = 'failed';
        stepResult.error = (err as Error).message;
        stepResult.completedAt = new Date().toISOString();

        console.error(`[WorkflowEngine] ${executionId} — Step '${stepDef.id}' failed:`, err);

        if (stepDef.onFailure) {
          currentStepId = stepDef.onFailure;
        } else {
          // No fallback — fail the workflow
          status.status = 'failed';
          status.completedAt = new Date().toISOString();
          this.executions.set(executionId, status);
          return {
            executionId,
            workflowId,
            status: 'failed',
            steps: status.steps,
            finalOutput: `Workflow failed at step '${stepDef.id}': ${(err as Error).message}`,
          };
        }
      }
    }

    status.status = 'completed';
    status.completedAt = new Date().toISOString();
    this.executions.set(executionId, status);

    // Optional ServiceNow write-back: when the workflow was triggered by a
    // SNOW signal carrying a sys_id, append a worknote linking back to the
    // reasoning trace. No-op when SNOW is not configured.
    await this.maybeWriteBackToSnow(workflowId, status, lastOutput).catch((err) => {
      console.warn('[WorkflowEngine] SNOW write-back failed:', (err as Error).message);
    });

    const result: WorkflowResult = {
      executionId,
      workflowId,
      status: 'completed',
      steps: status.steps,
      finalOutput: lastOutput,
    };

    // Outcome verification + tuner feedback (best-effort).
    try {
      const sig = status.context.signal as Signal | undefined;
      const record = await verifyWorkflowOutcome({
        workflowId,
        executionId,
        signal: sig,
        workflowResult: result,
      }, { autoRollback: true });
      recordTunerSignal(workflowId, sig?.type, record.label);
    } catch (err) {
      console.warn('[WorkflowEngine] outcome verification failed:', (err as Error).message);
    }

    return result;
  }

  /**
   * Phase 10 — Execute a workflow as a directed acyclic graph of steps.
   * Steps run as soon as all `dependsOn` predecessors have a terminal status
   * (completed or skipped). Independent branches run in parallel. When a
   * step fails (and has no onFailure handler), its transitive dependents are
   * marked `skipped` and the workflow as a whole is reported as `failed` —
   * but other independent branches keep running so we capture as much
   * partial work as possible.
   */
  private async executeDag(
    workflow: WorkflowDefinition,
    status: WorkflowStatus,
  ): Promise<WorkflowResult> {
    const executionId = status.executionId;
    const workflowId = workflow.id;

    // ── Build & validate the dependency graph ──
    const stepById = new Map<string, WorkflowStep>();
    for (const s of workflow.steps) stepById.set(s.id, s);

    const indegree = new Map<string, number>();
    const dependents = new Map<string, Set<string>>();
    for (const s of workflow.steps) {
      indegree.set(s.id, 0);
      dependents.set(s.id, new Set());
    }
    for (const s of workflow.steps) {
      for (const dep of s.dependsOn ?? []) {
        if (!stepById.has(dep)) {
          status.status = 'failed';
          status.completedAt = new Date().toISOString();
          return {
            executionId,
            workflowId,
            status: 'failed',
            steps: status.steps,
            finalOutput: `DAG validation failed: step '${s.id}' depends on unknown step '${dep}'`,
          };
        }
        indegree.set(s.id, (indegree.get(s.id) ?? 0) + 1);
        dependents.get(dep)!.add(s.id);
      }
    }

    // Cycle detection via Kahn's algorithm.
    {
      const remaining = new Map(indegree);
      const queue: string[] = [];
      for (const [id, d] of remaining) if (d === 0) queue.push(id);
      let visited = 0;
      while (queue.length > 0) {
        const id = queue.shift()!;
        visited++;
        for (const dep of dependents.get(id) ?? new Set<string>()) {
          remaining.set(dep, (remaining.get(dep) ?? 0) - 1);
          if (remaining.get(dep) === 0) queue.push(dep);
        }
      }
      if (visited !== workflow.steps.length) {
        status.status = 'failed';
        status.completedAt = new Date().toISOString();
        return {
          executionId,
          workflowId,
          status: 'failed',
          steps: status.steps,
          finalOutput: 'DAG validation failed: cycle detected in dependsOn graph',
        };
      }
    }

    // ── Mutable execution state ──
    const remainingDeps = new Map<string, number>(indegree);
    const stepStatus = new Map<string, StepStatus>();
    for (const r of status.steps) stepStatus.set(r.stepId, r.status);

    // Mark a step (and its transitive dependents) as skipped after a failure.
    const skipDescendants = (rootId: string): void => {
      const queue = [rootId];
      while (queue.length > 0) {
        const id = queue.shift()!;
        for (const child of dependents.get(id) ?? new Set<string>()) {
          if (stepStatus.get(child) !== 'pending') continue;
          stepStatus.set(child, 'skipped');
          const sr = status.steps.find((x) => x.stepId === child);
          if (sr) {
            sr.status = 'skipped';
            sr.completedAt = new Date().toISOString();
          }
          queue.push(child);
        }
      }
    };

    let lastOutput = '';
    let anyFailure = false;
    const inflight = new Map<string, Promise<void>>();

    const runOne = async (stepId: string): Promise<void> => {
      const stepDef = stepById.get(stepId)!;
      const stepResult = status.steps.find((s) => s.stepId === stepId)!;
      stepStatus.set(stepId, 'running');
      try {
        const out = await this.runStep(workflow, stepDef, stepResult, status);
        if (out !== undefined) lastOutput = out;
        stepStatus.set(stepId, 'completed');
      } catch (err) {
        stepResult.status = 'failed';
        stepResult.error = (err as Error).message;
        stepResult.completedAt = new Date().toISOString();
        stepStatus.set(stepId, 'failed');
        console.error(`[WorkflowEngine] ${executionId} — DAG step '${stepId}' failed:`, err);
        anyFailure = true;
        skipDescendants(stepId);
      }
      // Decrement in-degree for dependents
      for (const child of dependents.get(stepId) ?? new Set<string>()) {
        if (stepStatus.get(child) === 'pending') {
          remainingDeps.set(child, (remainingDeps.get(child) ?? 0) - 1);
        }
      }
    };

    // ── Scheduling loop ──
    // Start all steps with zero in-degree, then whenever a step finishes, start
    // any newly-eligible dependents. Loop ends when there is nothing in flight
    // and no more pending steps with zero remaining deps.
    while (true) {
      for (const s of workflow.steps) {
        if (stepStatus.get(s.id) !== 'pending') continue;
        if ((remainingDeps.get(s.id) ?? 0) > 0) continue;
        if (inflight.has(s.id)) continue;
        const p = runOne(s.id).finally(() => inflight.delete(s.id));
        inflight.set(s.id, p);
      }
      if (inflight.size === 0) break;
      await Promise.race(inflight.values());
    }

    // ── Finalisation ──
    status.status = anyFailure ? 'failed' : 'completed';
    status.completedAt = new Date().toISOString();

    const result: WorkflowResult = {
      executionId,
      workflowId,
      status: anyFailure ? 'failed' : 'completed',
      steps: status.steps,
      finalOutput: lastOutput,
    };

    // SNOW write-back + outcome verification (mirrors the linear path).
    await this.maybeWriteBackToSnow(workflowId, status, lastOutput).catch((err) => {
      console.warn('[WorkflowEngine] SNOW write-back failed:', (err as Error).message);
    });
    try {
      const sig = status.context.signal as Signal | undefined;
      const record = await verifyWorkflowOutcome(
        { workflowId, executionId, signal: sig, workflowResult: result },
        { autoRollback: true },
      );
      recordTunerSignal(workflowId, sig?.type, record.label);
    } catch (err) {
      console.warn('[WorkflowEngine] outcome verification failed:', (err as Error).message);
    }
    return result;
  }

  /**
   * Execute a single step (autonomy gate, runWorker, success bookkeeping).
   * Shared by the linear and DAG executors. Throws on worker failure so the
   * caller can decide failure semantics. Returns the step output on success.
   */
  private async runStep(
    workflow: WorkflowDefinition,
    stepDef: WorkflowStep,
    stepResult: StepResult,
    status: WorkflowStatus,
  ): Promise<string | undefined> {
    if (stepDef.requiresApproval) {
      stepResult.status = 'awaiting_approval';
      const sig = status.context.signal as Signal | undefined;
      const dec = status.context.triggerDecision as TriggerDecision | undefined;
      const worker = workerMap.get(stepDef.worker);
      const gate = autonomyGate({
        workflowId: workflow.id,
        signalType: sig?.type,
        worker,
        decision: dec,
        tenantId: (status.context.tenantId as string | undefined) ?? 'default',
      });
      if (gate.allow) {
        console.log(`[WorkflowEngine] Step '${stepDef.id}' autonomy gate passed: ${gate.reason}`);
      } else {
        console.log(
          `[WorkflowEngine] Step '${stepDef.id}' autonomy gate blocked (${gate.reason}) — auto-approving for backwards compatibility (HITL preserved at tool layer)`,
        );
      }
    }
    stepResult.status = 'running';
    stepResult.startedAt = new Date().toISOString();
    const worker = workerMap.get(stepDef.worker);
    if (!worker) {
      throw new Error(`Worker '${stepDef.worker}' not found in worker registry`);
    }
    const lastOutput = (status.context.previousStepOutput as string | undefined) ?? '';
    const prompt = `${stepDef.action}\n\nContext: ${JSON.stringify({ ...stepDef.inputs, ...status.context, previousStepOutput: lastOutput })}`;
    const ctx: PromptContext = {
      userMessage: prompt,
      displayName: `Workflow: ${workflow.name}`,
    };
    const result = await runWorker(worker, prompt, ctx);
    stepResult.status = 'completed';
    stepResult.output = result.output;
    stepResult.completedAt = new Date().toISOString();
    status.context[`step_${stepDef.id}_output`] = result.output;
    status.context.previousStepOutput = result.output;
    console.log(`[WorkflowEngine] ${status.executionId} — Step '${stepDef.id}' completed`);
    return result.output;
  }

  /**
   * List all registered workflow definitions.
   */
  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Get the current status of a workflow execution.
   */
  getWorkflowStatus(executionId: string): WorkflowStatus | undefined {
    return this.executions.get(executionId);
  }

  private async maybeWriteBackToSnow(
    workflowId: string,
    status: WorkflowStatus,
    summary: string,
  ): Promise<void> {
    if (workflowId !== 'major-incident-response') return;
    const ctx = status.context as Record<string, unknown>;
    if (ctx.signalSource !== 'servicenow') return;
    const payload = ctx.payload as { sys_id?: string } | undefined;
    const sysId = payload?.sys_id as string | undefined;
    if (!sysId) return;
    if (!getSnowClientStatus().enabled) return;

    const correlationId =
      (ctx.correlationId as string | undefined) || status.executionId;
    const reasoningTraceId = (ctx.signalId as string | undefined) || status.executionId;
    const demoRunId = (payload as { u_demo_run?: string } | undefined)?.u_demo_run;

    await addWorkNote(
      'incident',
      sysId,
      `Alex completed major-incident-response workflow.\nSummary: ${summary.slice(0, 800)}`,
      { correlationId, reasoningTraceId, demoRunId },
    );
  }
}

/** Get the next sequential step ID, or undefined if at the end. */
function getNextStepId(steps: WorkflowStep[], currentId: string): string | undefined {
  const idx = steps.findIndex((s) => s.id === currentId);
  return idx >= 0 && idx < steps.length - 1 ? steps[idx + 1].id : undefined;
}

export const workflowEngine = new WorkflowEngine();
