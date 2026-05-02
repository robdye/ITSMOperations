// ITSM Operations — Agent Harness
// Declarative agent factory/executor for ITIL 4 child workers.
// NOT a custom LLM loop — configures and runs the existing @openai/agents Agent.
//
// Pattern: Each child worker is an AgentDefinition. The harness:
// 1. Builds worker-specific instructions (system prompt)
// 2. Filters tools to the worker's domain + shared capability packs
// 3. Creates an @openai/agents Agent with the scoped config
// 4. Runs via the existing `run()` function
// 5. Returns the result

import { Agent, run, OpenAIChatCompletionsModel } from '@openai/agents';
import type { TurnContext } from '@microsoft/agents-hosting';
import { getModelName, isAzureOpenAI, getOpenAIClient, getModelForTask, detectTaskType } from './openai-config';
import { classifyTool, type HitlClassification } from './hitl';
import { getTunedModel } from './copilot-tuning';
import { logToolCall, logToolResult, logError, logOutcome, startConversation } from './reasoning-trace';

/**
 * Runtime context passed to every tool's execute() handler via
 * `runContext.context`. Tools that talk to M365 MCP servers read
 * `turnContext` to mint OBO tokens; absence means the tool runs autonomously
 * (no user session) and should fall back to direct Graph.
 */
export interface WorkerRunContext {
  /** Live Microsoft Agents SDK TurnContext, when this run was initiated by
   * a real user message. `undefined` for cron / signal-router / mission
   * control / voice-only paths. */
  turnContext?: TurnContext;
  /** Echo of PromptContext.displayName for tool diagnostics. */
  displayName?: string;
  /** Echo of PromptContext.requesterEmail. */
  requesterEmail?: string;
}

// ── Worker Definition ──

export interface WorkerDefinition {
  /** Unique worker ID matching ITIL 4 practice */
  id: string;
  /** Display name */
  name: string;
  /** ITIL 4 practice this worker implements */
  itilPractice: string;
  /** Worker-specific instructions (system prompt) */
  instructions: string;
  /** Tools available to this worker */
  tools: any[];
  /** Max agentic iterations (default 10) */
  maxIterations?: number;
  /**
   * Blast radius of this worker's autonomous actions in [0, 1].
   * 0 = harmless, 1 = wide impact / irreversible. Used by trigger-policy
   * to dampen effective confidence: confidence * (1 - 0.5 * blastRadius).
   * Optional. Defaults to 0.5 when unset.
   */
  blastRadius?: number;
  /**
   * Whether the worker is permitted to take autonomous actions when the
   * trigger-policy decision allows it. When false, all autonomous decisions
   * downgrade to 'propose' regardless of confidence.
   * Optional. Defaults to false (status quo: all writes are HITL-gated).
   */
  allowAutonomous?: boolean;
  /**
   * Human-readable summary of what the worker may do unattended, what it
   * needs approval for, and what is forbidden. Surfaced in mission-control.
   */
  statementOfAutonomy?: string;
}

// ── Prompt Context ──

export interface PromptContext {
  /** The user's original message */
  userMessage: string;
  /** Conversation history (if any) */
  history?: string;
  /** Pre-fetched data from ServiceNow (if any) */
  enrichedData?: string;
  /** Display name of the user */
  displayName?: string;
  /** Resolved email address of the user */
  requesterEmail?: string;
  /** Live TurnContext for OBO token minting (M365 MCP wrappers). */
  turnContext?: TurnContext;
}

// ── Harness Result ──

export interface HarnessResult {
  /** The final response text */
  output: string;
  /** Which worker handled it */
  workerId: string;
  /** Whether the request was cross-practice (routed to orchestrator) */
  crossPractice: boolean;
}

// ── Core Harness Functions ──

/**
 * Create an @openai/agents Agent configured for a specific ITIL 4 worker.
 * Does NOT run the agent — just builds it with scoped tools and instructions.
 */
export function createWorkerAgent(worker: WorkerDefinition, ctx?: PromptContext, taskType?: string): Agent {
  let instructions = worker.instructions;

  // Inject context if provided
  if (ctx?.displayName) {
    instructions += `\n\nYou are speaking with: ${ctx.displayName}`;
  }
  if (ctx?.requesterEmail) {
    instructions += `\nRequester email: ${ctx.requesterEmail}`;
    instructions += `\nIf the user asks to email \"me\" or \"myself\", use this requester email as the recipient unless they explicitly provide a different address.`;
  }

  const config: any = {
    name: worker.name,
    instructions,
  };

  // Model routing: tuned model override > task-specific model > default
  const tunedModel = getTunedModel(worker.id);
  const modelName = tunedModel || (taskType ? getModelForTask(taskType) : getModelName());
  if (isAzureOpenAI()) {
    config.model = new OpenAIChatCompletionsModel(getOpenAIClient(), modelName);
  } else {
    config.model = modelName;
  }

  const agent = new Agent(config);
  agent.tools = [...worker.tools];
  return agent;
}

/**
 * Run a worker agent with the given prompt.
 * Uses the existing @openai/agents `run()` — no custom loop.
 *
 * Subscribes to the agent's lifecycle hooks so every tool call is recorded
 * in the reasoning-trace store. This is what populates the Mission Control
 * "Agent Activity" panel — without these hooks the panel would stay empty
 * because the OpenAI Agents SDK doesn't push events to our trace store.
 */
export async function runWorker(
  worker: WorkerDefinition,
  prompt: string,
  ctx?: PromptContext,
  conversationId?: string
): Promise<HarnessResult> {
  const taskType = detectTaskType(worker.id, prompt);
  const agent = createWorkerAgent(worker, ctx, taskType);
  console.log(`[Harness] Worker ${worker.id} using model: ${getModelForTask(taskType)} (task: ${taskType})`);

  const convId = conversationId || startConversation();
  const toolStartTimes = new Map<string, number>();
  const tStart = Date.now();

  // Bridge agent SDK lifecycle → our reasoning-trace store. Best-effort —
  // never let a hook throw escape into the run.
  try {
    (agent as any).on?.('agent_tool_start', (_ctxRun: any, tool: any, details: any) => {
      try {
        const callId = details?.toolCall?.id || details?.toolCall?.callId || `${tool?.name}-${Date.now()}`;
        toolStartTimes.set(callId, Date.now());
        const argsRaw = details?.toolCall?.arguments;
        let args: Record<string, unknown> = {};
        if (typeof argsRaw === 'string') {
          try { args = JSON.parse(argsRaw); } catch { args = { raw: argsRaw }; }
        } else if (argsRaw && typeof argsRaw === 'object') {
          args = argsRaw as Record<string, unknown>;
        }
        logToolCall(convId, worker.id, tool?.name || 'unknown', args);
      } catch { /* ignore */ }
    });
    (agent as any).on?.('agent_tool_end', (_ctxRun: any, tool: any, result: any, details: any) => {
      try {
        const callId = details?.toolCall?.id || details?.toolCall?.callId || `${tool?.name}-end`;
        const started = toolStartTimes.get(callId) || Date.now();
        const dur = Date.now() - started;
        const summary = typeof result === 'string' ? result : JSON.stringify(result ?? null);
        logToolResult(convId, worker.id, tool?.name || 'unknown', summary, dur);
      } catch { /* ignore */ }
    });
  } catch { /* hooks not supported on this Agent build — skip silently */ }

  // Build the full prompt with history if available
  let fullPrompt = prompt;
  if (ctx?.history) {
    fullPrompt = `${prompt}\n\nConversation history:\n${ctx.history}`;
  }
  if (ctx?.enrichedData) {
    fullPrompt = `${prompt}\n\nRelevant data:\n${ctx.enrichedData}`;
  }

  // Build the run-time context the tool layer reads via `runContext.context`.
  // The MCP-first pattern threads TurnContext into MCP OBO so the agent can
  // act as the signed-in user when a turn is active.
  const workerContext: WorkerRunContext = {
    turnContext: ctx?.turnContext,
    displayName: ctx?.displayName,
    requesterEmail: ctx?.requesterEmail,
  };

  try {
    const result = await run(agent, fullPrompt, { context: workerContext });
    const output = result.finalOutput || "Sorry, I couldn't generate a response.";
    try { logOutcome(convId, worker.id, output, Date.now() - tStart); } catch { /* ignore */ }
    return {
      output,
      workerId: worker.id,
      crossPractice: false,
    };
  } catch (error) {
    console.error(`[Harness] Worker ${worker.id} error:`, error);
    try { logError(convId, worker.id, (error as Error).message || String(error)); } catch { /* ignore */ }
    return {
      output: `Error in ${worker.name}: ${(error as any).message || error}`,
      workerId: worker.id,
      crossPractice: false,
    };
  }
}

/**
 * Run the orchestrator (Command Center) for cross-practice or general requests.
 * Gets ALL tools and the orchestrator instructions.
 */
export async function runOrchestrator(
  orchestrator: WorkerDefinition,
  prompt: string,
  ctx?: PromptContext
): Promise<HarnessResult> {
  const result = await runWorker(orchestrator, prompt, ctx);
  return { ...result, crossPractice: true };
}

/**
 * Get the HITL risk summary for a worker's tools.
 * Useful for Command Center to display which operations require confirmation.
 */
export function getWorkerRiskProfile(worker: WorkerDefinition): {
  reads: string[];
  writes: string[];
  notifies: string[];
} {
  const toolNames = worker.tools.map((t: any) => t.name || 'unknown');
  return {
    reads: toolNames.filter((n: string) => !classifyTool(n).requiresConfirmation),
    writes: toolNames.filter((n: string) => classifyTool(n).level === 'write'),
    notifies: toolNames.filter((n: string) => classifyTool(n).level === 'notify'),
  };
}

// Re-export delegation and escalation for convenience
export { delegateToWorker, canDelegate, getDelegationTargets } from './worker-delegation';
export { executeWithEscalation, getEscalationLog, getActiveEscalations } from './escalation-chain';
