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
import { getModelName, isAzureOpenAI, getOpenAIClient, getModelForTask, detectTaskType } from './openai-config';
import { classifyTool, type HitlClassification } from './hitl';
import { getTunedModel } from './copilot-tuning';

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
 */
export async function runWorker(
  worker: WorkerDefinition,
  prompt: string,
  ctx?: PromptContext
): Promise<HarnessResult> {
  const taskType = detectTaskType(worker.id, prompt);
  const agent = createWorkerAgent(worker, ctx, taskType);
  console.log(`[Harness] Worker ${worker.id} using model: ${getModelForTask(taskType)} (task: ${taskType})`);

  // Build the full prompt with history if available
  let fullPrompt = prompt;
  if (ctx?.history) {
    fullPrompt = `${prompt}\n\nConversation history:\n${ctx.history}`;
  }
  if (ctx?.enrichedData) {
    fullPrompt = `${prompt}\n\nRelevant data:\n${ctx.enrichedData}`;
  }

  try {
    const result = await run(agent, fullPrompt);
    return {
      output: result.finalOutput || "Sorry, I couldn't generate a response.",
      workerId: worker.id,
      crossPractice: false,
    };
  } catch (error) {
    console.error(`[Harness] Worker ${worker.id} error:`, error);
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
