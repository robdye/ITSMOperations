// ITSM Operations — Agent Framework Abstraction Layer
// Provides a framework-agnostic interface for agent execution.
// Currently backed by @openai/agents; designed for migration to
// Microsoft Agent Framework (Semantic Kernel + AutoGen) when GA.

import { Agent, run, OpenAIChatCompletionsModel } from '@openai/agents';
import { getModelForTask, detectTaskType, isAzureOpenAI, getOpenAIClient, getModelName } from './openai-config';
import type { WorkerDefinition } from './agent-harness';

// ── Framework-Agnostic Interfaces ──

export interface AgentConfig {
  name: string;
  instructions: string;
  tools: any[];
  model?: string;
  maxIterations?: number;
}

export interface AgentResult {
  output: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; result?: string }>;
  tokenUsage?: { input: number; output: number };
  durationMs: number;
}

export interface AgentRouter {
  route(message: string): Promise<{
    workerId: string;
    confidence: number;
    reason: string;
  }>;
}

export interface AgentExecutor {
  execute(config: AgentConfig, prompt: string): Promise<AgentResult>;
}

// ── OpenAI Agents Executor (current implementation) ──

export class OpenAIAgentExecutor implements AgentExecutor {
  async execute(config: AgentConfig, prompt: string): Promise<AgentResult> {
    const startTime = Date.now();
    
    const agentConfig: any = {
      name: config.name,
      instructions: config.instructions,
    };

    const modelName = config.model || getModelName();
    if (isAzureOpenAI()) {
      agentConfig.model = new OpenAIChatCompletionsModel(getOpenAIClient(), modelName);
    } else {
      agentConfig.model = modelName;
    }

    const agent = new Agent(agentConfig);
    agent.tools = [...config.tools];

    try {
      const result = await run(agent, prompt);
      return {
        output: result.finalOutput || "Sorry, I couldn't generate a response.",
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        output: `Error: ${(error as Error).message}`,
        durationMs: Date.now() - startTime,
      };
    }
  }
}

// ── LLM-Based Router (replaces regex classifyIntent) ──

export class LlmAgentRouter implements AgentRouter {
  private workers: WorkerDefinition[];
  private executor: AgentExecutor;

  constructor(workers: WorkerDefinition[], executor: AgentExecutor) {
    this.workers = workers;
    this.executor = executor;
  }

  async route(message: string): Promise<{ workerId: string; confidence: number; reason: string }> {
    const workerList = this.workers
      .map(w => `- ${w.id}: ${w.name} (${w.itilPractice}) — ${w.instructions.substring(0, 100)}...`)
      .join('\n');

    const routingPrompt = `You are an ITSM intent classifier. Given a user message, determine which ITIL 4 worker should handle it.

Available workers:
${workerList}

User message: "${message}"

Respond in this exact JSON format (no markdown, no code fences):
{"workerId": "<worker-id>", "confidence": <0.0-1.0>, "reason": "<brief reason>"}

If the message is general or cross-practice, use "command-center".
If you're unsure, use "command-center" with low confidence.`;

    try {
      const result = await this.executor.execute(
        {
          name: 'intent-router',
          instructions: 'You are a precise intent classifier. Always respond with valid JSON only.',
          tools: [],
          model: getModelForTask('routing'),
        },
        routingPrompt
      );

      // Parse the JSON response
      const cleaned = result.output.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      
      return {
        workerId: parsed.workerId || 'command-center',
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
        reason: parsed.reason || 'LLM classification',
      };
    } catch (error) {
      console.error('[LlmRouter] Classification failed, falling back to command-center:', error);
      return {
        workerId: 'command-center',
        confidence: 0.3,
        reason: `LLM router error: ${(error as Error).message}. Falling back to Command Center.`,
      };
    }
  }
}

// ── Hybrid Router (regex fast-path + LLM fallback) ──

import { classifyIntent as regexClassify } from './worker-registry';

export class HybridAgentRouter implements AgentRouter {
  private llmRouter: LlmAgentRouter;
  private useLlmForLowConfidence: boolean;

  constructor(workers: WorkerDefinition[], executor: AgentExecutor, useLlmForLowConfidence = true) {
    this.llmRouter = new LlmAgentRouter(workers, executor);
    this.useLlmForLowConfidence = useLlmForLowConfidence;
  }

  async route(message: string): Promise<{ workerId: string; confidence: number; reason: string }> {
    // Fast path: regex classification
    const regexResult = regexClassify(message);
    
    // If regex is confident, use it (no LLM cost)
    if (regexResult.confidence === 'high') {
      return {
        workerId: regexResult.worker.id,
        confidence: 0.9,
        reason: `[regex] ${regexResult.reason}`,
      };
    }

    // If regex has medium confidence and LLM fallback is disabled, use regex
    if (regexResult.confidence === 'medium' && !this.useLlmForLowConfidence) {
      return {
        workerId: regexResult.worker.id,
        confidence: 0.6,
        reason: `[regex] ${regexResult.reason}`,
      };
    }

    // Low/medium confidence: fall back to LLM router
    if (this.useLlmForLowConfidence) {
      console.log(`[HybridRouter] Regex confidence ${regexResult.confidence} for "${message.substring(0, 60)}..." — using LLM router`);
      try {
        const llmResult = await this.llmRouter.route(message);
        return {
          ...llmResult,
          reason: `[llm] ${llmResult.reason} (regex suggested: ${regexResult.worker.id} at ${regexResult.confidence})`,
        };
      } catch (err) {
        // LLM failed — fall back to regex result
        return {
          workerId: regexResult.worker.id,
          confidence: regexResult.confidence === 'medium' ? 0.6 : 0.3,
          reason: `[regex-fallback] ${regexResult.reason}`,
        };
      }
    }

    return {
      workerId: regexResult.worker.id,
      confidence: 0.3,
      reason: `[regex] ${regexResult.reason}`,
    };
  }
}

// ── Factory ──

let defaultExecutor: AgentExecutor | null = null;

export function getExecutor(): AgentExecutor {
  if (!defaultExecutor) {
    defaultExecutor = new OpenAIAgentExecutor();
  }
  return defaultExecutor;
}

export function createRouter(workers: WorkerDefinition[], mode: 'regex' | 'llm' | 'hybrid' = 'hybrid'): AgentRouter {
  const executor = getExecutor();
  switch (mode) {
    case 'llm':
      return new LlmAgentRouter(workers, executor);
    case 'hybrid':
      return new HybridAgentRouter(workers, executor);
    default:
      // Wrap the regex classifier in the AgentRouter interface
      return {
        async route(message: string) {
          const result = regexClassify(message);
          const confMap: Record<string, number> = { high: 0.9, medium: 0.6, low: 0.3 };
          return {
            workerId: result.worker.id,
            confidence: confMap[result.confidence],
            reason: `[regex] ${result.reason}`,
          };
        },
      };
  }
}
