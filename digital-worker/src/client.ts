// ITSM Operations Digital Worker — OpenAI Client with Agent 365 SDK

import { configDotenv } from 'dotenv';
configDotenv();

import { Agent, run, OpenAIChatCompletionsModel, setDefaultOpenAIClient } from '@openai/agents';
import { Authorization, TurnContext } from '@microsoft/agents-hosting';
import { McpToolRegistrationService } from '@microsoft/agents-a365-tooling-extensions-openai';
import { agentTools } from './agent-tools';
import { allTools } from './tools';
import { AgenticTokenCacheInstance } from '@microsoft/agents-a365-observability-hosting';
import { configureOpenAIClient, getModelName, isAzureOpenAI, getOpenAIClient } from './openai-config';
import {
  ObservabilityManager, InferenceScope, Builder, InferenceOperationType,
  AgentDetails, TenantDetails, InferenceDetails, Agent365ExporterOptions,
} from '@microsoft/agents-a365-observability';
import { OpenAIAgentsTraceInstrumentor } from '@microsoft/agents-a365-observability-extensions-openai';
import { tokenResolver } from './token-cache';
import { runWorker, type PromptContext } from './agent-harness';
import { classifyIntent } from './worker-registry';

configureOpenAIClient();

if (isAzureOpenAI()) {
  const client = getOpenAIClient();
  if (client) { setDefaultOpenAIClient(client); console.log('[Client] Azure OpenAI client set as default'); }
}

export interface Client {
  invokeAgentWithScope(prompt: string): Promise<string>;
}

const ITSM_INSTRUCTIONS = `You are an ITSM Operations Digital Worker — an autonomous AI agent managing IT Service Management for a financial services organization. You operate 24/7 monitoring incidents, problems, changes, and SLAs.

PERSONA:
- Name: ITSM Operations
- Role: Senior IT Operations Manager & Service Delivery Lead
- Reporting to: ${process.env.MANAGER_NAME || 'the IT Director'}
- Style: Professional, decisive, ITIL V4 aligned, NIST 800-53 compliant

CORE RESPONSIBILITIES:
1. SHIFT HANDOVER (08:00/20:00 daily):
   - P1/P2 incident status and escalation state
   - SLA breach summary and at-risk tickets
   - Pending changes and collision warnings
   - Problem backlog with known errors
   - Overnight incident trends

2. INCIDENT AUTO-TRIAGE:
   - Analyze incident descriptions to suggest category, priority, assignment group
   - Match incidents to known errors in the problem database
   - Check if related changes were recently deployed
   - Suggest knowledge articles for resolution

3. SLA BREACH PREDICTION:
   - Monitor ticket queue depth and average resolution time
   - Predict tickets likely to breach before they do
   - Send proactive alerts to assignment groups

4. CHANGE-INCIDENT CORRELATION:
   - Track changes implemented vs incidents opened
   - Flag incidents opened within 48h of a change on the same CI
   - Recommend rollback when correlation is high

5. TREND ANALYSIS:
   - Incident volume by category/CI over time
   - Recurring patterns that should become problems
   - Seasonal or temporal patterns

6. M365 INTELLIGENCE (via WorkIQ):
   - Search emails for incident escalation threads, change approvals, vendor communications
   - Check calendar for upcoming CAB meetings, incident bridges, RCA sessions
   - Extract action items from post-incident review meetings
   - Search Teams channels for IT Ops alerts and incident discussions
   - Look up people — org charts, escalation paths, SME identification
   - Find runbooks and DR plans in SharePoint/OneDrive
   - Triage inbox for urgent ITSM items needing attention
   - Correlate M365 communications with ServiceNow ticket activity

IMPORTANT: Use real data from ServiceNow. Never use placeholder text. Be specific with ticket numbers, CI names, and timestamps.
When the user asks about communications, emails, meetings, people, or documents, use the WorkIQ M365 tools.
When correlating incidents with communications, combine ServiceNow data with M365 email/Teams search.`;

export const a365Observability = ObservabilityManager.configure((builder: Builder) => {
  const opts = new Agent365ExporterOptions();
  opts.maxQueueSize = 10;
  builder.withService('ITSM Operations Digital Worker', '1.0.0').withExporterOptions(opts);
  if (process.env.Use_Custom_Resolver === 'true') { builder.withTokenResolver(tokenResolver as any); }
  else { builder.withTokenResolver(((a: string, t: string) => AgenticTokenCacheInstance.getObservabilityToken(a, t)) as any); }
});

const instrumentor = new OpenAIAgentsTraceInstrumentor({ enabled: true, tracerName: 'itsm-operations-worker', tracerVersion: '1.0.0' });
a365Observability.start();
instrumentor.enable();

const toolService = new McpToolRegistrationService();

export async function getClient(authorization: Authorization, authHandlerName: string, turnContext: TurnContext, displayName = 'unknown'): Promise<Client> {
  const modelName = getModelName();
  console.log(`[Client] Creating ITSM Operations agent with model: ${modelName}`);
  const config: any = { name: 'ITSM Operations', instructions: ITSM_INSTRUCTIONS };
  if (isAzureOpenAI()) { config.model = new OpenAIChatCompletionsModel(getOpenAIClient(), modelName); }
  else { config.model = modelName; }

  const agent = new Agent(config);

  // Register all tools (uses new modular tool registry)
  agent.tools = [...allTools];
  console.log(`[Client] Registered ${agent.tools.length} function tools on agent`);

  return new OpenAIClient(agent);
}

/**
 * Create a worker-aware client that routes to the appropriate ITIL 4 worker.
 * The worker is selected based on intent classification of the user's message.
 */
export async function getWorkerClient(displayName = 'unknown'): Promise<WorkerClient> {
  return new WorkerClient(displayName);
}

export async function getStandaloneClient(): Promise<Client> {
  const modelName = getModelName();
  console.log(`[Client] Creating standalone ITSM Operations agent with model: ${modelName}`);
  const config: any = { name: 'ITSM Operations', instructions: ITSM_INSTRUCTIONS };
  if (isAzureOpenAI()) { config.model = new OpenAIChatCompletionsModel(getOpenAIClient(), modelName); }
  else { config.model = modelName; }

  const agent = new Agent(config);

  // Register all tools for standalone/scheduled use (uses new modular tool registry)
  agent.tools = [...allTools];
  console.log(`[Client] Registered ${agent.tools.length} function tools on standalone agent`);

  return new OpenAIClient(agent);
}

class OpenAIClient implements Client {
  agent: Agent;
  constructor(agent: Agent) { this.agent = agent; }

  async invokeAgent(prompt: string): Promise<string> {
    try {
      const result = await run(this.agent, prompt);
      return result.finalOutput || "Sorry, I couldn't generate a response.";
    } catch (error) {
      console.error('OpenAI agent error:', error);
      return `Error: ${(error as any).message || error}`;
    }
  }

  async invokeAgentWithScope(prompt: string): Promise<string> {
    let response = '';
    const scope = InferenceScope.start(
      { operationName: InferenceOperationType.CHAT, model: this.agent.model.toString() } as any,
      { agentId: 'itsm-operations-worker', agentName: 'ITSM Operations', conversationId: `conv-${Date.now()}` } as any,
      { tenantId: process.env.connections__service_connection__settings__tenantId || 'default-tenant' } as any,
    );
    try {
      await scope.withActiveSpanAsync(async () => {
        response = await this.invokeAgent(prompt);
        scope.recordOutputMessages([response]);
        scope.recordInputMessages([prompt]);
        scope.recordFinishReasons(['stop']);
      });
    } finally { scope.dispose(); }
    return response;
  }
}

/**
 * Worker-aware client that routes to ITIL 4 child workers.
 * Classifies intent and runs the appropriate worker via the agent harness.
 */
class WorkerClient implements Client {
  private displayName: string;
  constructor(displayName: string) { this.displayName = displayName; }

  async invokeAgentWithScope(prompt: string): Promise<string> {
    const classification = classifyIntent(prompt);
    console.log(`[WorkerClient] Routed to ${classification.worker.id} (${classification.confidence}): ${classification.reason}`);

    const ctx: PromptContext = {
      userMessage: prompt,
      displayName: this.displayName,
    };

    const result = await runWorker(classification.worker, prompt, ctx);
    return result.output;
  }
}
