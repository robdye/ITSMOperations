/**
 * Azure AI Foundry Agent Service — Promotes high-traffic ITIL workers
 * to Foundry-managed Agents with persistent threads, runs, and tools.
 *
 * Provides Connected Agents A2A delegation from the Command Center.
 */

// Foundry Agent Service config
const FOUNDRY_ENDPOINT = process.env.FOUNDRY_ENDPOINT || '';
const FOUNDRY_API_KEY = process.env.FOUNDRY_API_KEY || '';
const FOUNDRY_API_VERSION = '2024-12-01-preview';

export interface FoundryAgent {
  id: string;
  name: string;
  workerId: string; // maps to our WorkerDefinition id
  instructions: string;
  model: string;
  tools: FoundryTool[];
}

export interface FoundryTool {
  type: 'function' | 'code_interpreter' | 'file_search' | 'azure_ai_search';
  function?: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface FoundryThread {
  id: string;
  created_at: number;
  metadata: Record<string, string>;
}

export interface FoundryRun {
  id: string;
  thread_id: string;
  agent_id: string;
  status: 'queued' | 'in_progress' | 'requires_action' | 'completed' | 'failed' | 'cancelled';
  last_error?: { code: string; message: string };
}

export interface FoundryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: Array<{ type: 'text'; text: { value: string } }>;
}

// Registry of workers promoted to Foundry Agents
const foundryAgentMap = new Map<string, string>(); // workerId → foundryAgentId

/**
 * Check if Foundry Agent Service is configured.
 */
export function isFoundryEnabled(): boolean {
  return !!(FOUNDRY_ENDPOINT && FOUNDRY_API_KEY);
}

/**
 * Internal fetch helper for Foundry API.
 */
async function foundryFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${FOUNDRY_ENDPOINT}${path}?api-version=${FOUNDRY_API_VERSION}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'api-key': FOUNDRY_API_KEY,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Foundry API error (${res.status}): ${errorText}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Create or get a Foundry Agent for a worker.
 */
export async function ensureFoundryAgent(
  workerId: string,
  name: string,
  instructions: string,
  model: string = 'gpt-4o',
  tools: FoundryTool[] = [],
): Promise<string> {
  // Return cached agent ID if already created
  const cached = foundryAgentMap.get(workerId);
  if (cached) return cached;

  if (!isFoundryEnabled()) {
    throw new Error('Foundry Agent Service not configured');
  }

  console.log(`[Foundry] Creating agent for worker: ${workerId}`);

  const agent = await foundryFetch<{ id: string }>('/assistants', {
    method: 'POST',
    body: JSON.stringify({
      name,
      instructions,
      model,
      tools,
      metadata: { workerId, source: 'itsm-operations' },
    }),
  });

  foundryAgentMap.set(workerId, agent.id);
  console.log(`[Foundry] Agent created: ${agent.id} for worker ${workerId}`);
  return agent.id;
}

/**
 * Create a new thread for a conversation.
 */
export async function createThread(metadata?: Record<string, string>): Promise<FoundryThread> {
  return foundryFetch<FoundryThread>('/threads', {
    method: 'POST',
    body: JSON.stringify({ metadata }),
  });
}

/**
 * Add a message to a thread.
 */
export async function addMessage(threadId: string, content: string, role: 'user' = 'user'): Promise<FoundryMessage> {
  return foundryFetch<FoundryMessage>(`/threads/${threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role, content }),
  });
}

/**
 * Create and poll a run on a thread.
 */
export async function createAndPollRun(
  threadId: string,
  agentId: string,
  additionalInstructions?: string,
): Promise<FoundryRun> {
  const run = await foundryFetch<FoundryRun>(`/threads/${threadId}/runs`, {
    method: 'POST',
    body: JSON.stringify({
      assistant_id: agentId,
      additional_instructions: additionalInstructions,
    }),
  });

  // Poll until complete
  let current = run;
  const maxPolls = 60;
  for (let i = 0; i < maxPolls; i++) {
    if (['completed', 'failed', 'cancelled'].includes(current.status)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
    current = await foundryFetch<FoundryRun>(`/threads/${threadId}/runs/${current.id}`);
  }

  return current;
}

/**
 * Get messages from a thread (latest first).
 */
export async function getMessages(threadId: string, limit: number = 10): Promise<FoundryMessage[]> {
  const result = await foundryFetch<{ data: FoundryMessage[] }>(
    `/threads/${threadId}/messages`
  );
  return result.data.slice(0, limit);
}

/**
 * Execute a worker task via Foundry Agent Service.
 * This is the main entry point for delegating to Foundry-managed workers.
 */
export async function executeViaFoundry(
  workerId: string,
  agentId: string,
  userMessage: string,
  conversationId?: string,
): Promise<{ response: string; threadId: string; runId: string }> {
  // Create or reuse thread
  const thread = await createThread({
    workerId,
    conversationId: conversationId || 'ephemeral',
    source: 'itsm-command-center',
  });

  // Add user message
  await addMessage(thread.id, userMessage);

  // Run agent
  const run = await createAndPollRun(thread.id, agentId);

  if (run.status !== 'completed') {
    throw new Error(`Foundry run failed: ${run.status} — ${run.last_error?.message || 'unknown'}`);
  }

  // Get response
  const messages = await getMessages(thread.id, 1);
  const assistantMsg = messages.find(m => m.role === 'assistant');
  const response = assistantMsg?.content?.[0]?.text?.value || 'No response from agent';

  return { response, threadId: thread.id, runId: run.id };
}

// Workers promoted to Foundry (the 5 highest-traffic)
export const FOUNDRY_PROMOTED_WORKERS = [
  'incident-manager',
  'change-manager',
  'problem-manager',
  'knowledge-manager',
  'finops-manager',
] as const;

/**
 * Check if a worker should be delegated to Foundry.
 */
export function isFoundryPromoted(workerId: string): boolean {
  return isFoundryEnabled() && FOUNDRY_PROMOTED_WORKERS.includes(workerId as any);
}

/**
 * Get Foundry service status.
 */
export function getFoundryStatus(): {
  enabled: boolean;
  endpoint: string;
  promotedWorkers: readonly string[];
  activeAgents: number;
} {
  return {
    enabled: isFoundryEnabled(),
    endpoint: FOUNDRY_ENDPOINT ? new URL(FOUNDRY_ENDPOINT).hostname : 'not-configured',
    promotedWorkers: FOUNDRY_PROMOTED_WORKERS,
    activeAgents: foundryAgentMap.size,
  };
}
