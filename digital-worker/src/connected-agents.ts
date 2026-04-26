/**
 * Connected Agents — Agent-to-Agent (A2A) communication layer.
 * Enables the Command Center to delegate to external agents
 * and allows partner agents to discover ITSM capabilities.
 */

import crypto from 'crypto';

export interface ConnectedAgent {
  id: string;
  name: string;
  endpoint: string;
  capabilities: string[];
  status: 'active' | 'inactive' | 'degraded';
  lastHealthCheck?: string;
}

export interface A2AMessage {
  from: string;
  to: string;
  intent: string;
  payload: Record<string, unknown>;
  correlationId: string;
  timestamp: string;
}

export interface A2AResponse {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  correlationId: string;
}

// Registry of connected agents
const connectedAgents = new Map<string, ConnectedAgent>();

/**
 * Register the ServiceNow first-party agent for A2A delegation.
 * Uses the SNOW_INSTANCE env var to build the agent endpoint.
 */
export function registerServiceNowAgent(): void {
  const snowInstance = process.env.SNOW_INSTANCE || '';
  if (!snowInstance) {
    console.log('[A2A] SNOW_INSTANCE not set — ServiceNow agent not registered');
    return;
  }

  const agent: ConnectedAgent = {
    id: 'servicenow-agent',
    name: 'ServiceNow Virtual Agent',
    endpoint: snowInstance,
    capabilities: [
      'incident-management',
      'change-management',
      'knowledge-management',
      'service-catalog',
      'live-chat',
      'agent-workspace',
    ],
    status: 'active',
    lastHealthCheck: new Date().toISOString(),
  };

  registerAgent(agent);
}

/**
 * Register an external agent for A2A communication.
 */
export function registerAgent(agent: ConnectedAgent): void {
  connectedAgents.set(agent.id, agent);
  console.log(`[A2A] Registered agent: ${agent.name} (${agent.id})`);
}

/**
 * Deregister an agent.
 */
export function deregisterAgent(agentId: string): void {
  connectedAgents.delete(agentId);
  console.log(`[A2A] Deregistered agent: ${agentId}`);
}

/**
 * Get all registered connected agents.
 */
export function getConnectedAgents(): ConnectedAgent[] {
  return Array.from(connectedAgents.values());
}

/**
 * Find agents that can handle a specific capability.
 */
export function findAgentsByCapability(capability: string): ConnectedAgent[] {
  return Array.from(connectedAgents.values()).filter(
    a => a.status === 'active' && a.capabilities.some(c => c.toLowerCase().includes(capability.toLowerCase()))
  );
}

/**
 * Send a message to a connected agent via HTTP.
 */
export async function sendA2AMessage(message: A2AMessage): Promise<A2AResponse> {
  const agent = connectedAgents.get(message.to);
  if (!agent) {
    return {
      success: false,
      error: `Agent not found: ${message.to}`,
      correlationId: message.correlationId,
    };
  }

  if (agent.status !== 'active') {
    return {
      success: false,
      error: `Agent ${agent.name} is ${agent.status}`,
      correlationId: message.correlationId,
    };
  }

  try {
    const res = await fetch(`${agent.endpoint}/a2a/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!res.ok) {
      return {
        success: false,
        error: `Agent responded with ${res.status}`,
        correlationId: message.correlationId,
      };
    }

    const data = await res.json() as Record<string, unknown>;
    return {
      success: true,
      data,
      correlationId: message.correlationId,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to reach agent: ${(err as Error).message}`,
      correlationId: message.correlationId,
    };
  }
}

/**
 * Health check all connected agents.
 */
export async function healthCheckAll(): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  for (const [id, agent] of connectedAgents.entries()) {
    try {
      const res = await fetch(`${agent.endpoint}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      const healthy = res.ok;
      results.set(id, healthy);
      agent.status = healthy ? 'active' : 'degraded';
      agent.lastHealthCheck = new Date().toISOString();
    } catch {
      results.set(id, false);
      agent.status = 'inactive';
      agent.lastHealthCheck = new Date().toISOString();
    }
  }

  return results;
}

// A2A endpoint handler for Express (incoming messages from partner agents)
export function createA2AHandler() {
  return async (req: any, res: any) => {
    const message = req.body as A2AMessage;

    if (!message?.intent || !message?.from) {
      return res.status(400).json({ error: 'Invalid A2A message: requires intent and from fields' });
    }

    console.log(`[A2A] Incoming message from ${message.from}: ${message.intent}`);

    // Route to appropriate internal handler
    const response: A2AResponse = {
      success: true,
      correlationId: message.correlationId || crypto.randomUUID(),
      data: {
        received: true,
        intent: message.intent,
        message: `ITSM Operations acknowledged: ${message.intent}`,
      },
    };

    res.json(response);
  };
}

/**
 * NLWeb discovery endpoint — returns agent capabilities in structured format.
 */
export function getDiscoveryManifest(): Record<string, unknown> {
  return {
    name: 'ITSM Operations Digital Worker',
    version: '3.0.0',
    description: 'ITIL 4-aligned IT Service Management multi-agent system',
    capabilities: [
      'incident-management',
      'change-management',
      'problem-management',
      'knowledge-management',
      'asset-management',
      'service-catalog',
      'sla-management',
      'security-operations',
      'finops-management',
    ],
    protocols: ['a2a', 'mcp', 'servicenow'],
    endpoints: {
      a2a: '/api/a2a/message',
      discovery: '/api/a2a/discover',
      health: '/health',
    },
    connectedAgents: getConnectedAgents().map(a => ({
      id: a.id,
      name: a.name,
      capabilities: a.capabilities,
      status: a.status,
    })),
  };
}
