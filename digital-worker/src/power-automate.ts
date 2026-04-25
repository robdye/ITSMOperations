/**
 * Power Automate — Complex multi-step approval workflows.
 * Triggers Power Automate flows via HTTP connector for:
 * - CAB voting with escalation and parallel approvals
 * - Multi-step change approval chains
 * - Emergency change fast-track with duty manager sign-off
 */

// ── Configuration ──
const FLOW_ENDPOINTS = {
  cabVoting: process.env.POWER_AUTOMATE_CAB_VOTING_URL || '',
  changeApproval: process.env.POWER_AUTOMATE_CHANGE_APPROVAL_URL || '',
  emergencyChange: process.env.POWER_AUTOMATE_EMERGENCY_CHANGE_URL || '',
  incidentEscalation: process.env.POWER_AUTOMATE_INCIDENT_ESCALATION_URL || '',
} as const;

type FlowType = keyof typeof FLOW_ENDPOINTS;

// ── Types ──
export interface FlowTrigger {
  flowType: FlowType;
  data: Record<string, unknown>;
  callbackUrl?: string;
  correlationId?: string;
}

export interface FlowResult {
  triggered: boolean;
  flowRunId?: string;
  flowType: FlowType;
  error?: string;
  method: 'power-automate' | 'fallback';
}

export interface CabVotingRequest {
  changeNumber: string;
  changeTitle: string;
  risk: 'high' | 'medium' | 'low';
  impact: string;
  implementationPlan: string;
  rollbackPlan: string;
  cabMembers: string[]; // UPNs
  votingDeadline: string; // ISO datetime
  requiredApprovals: number;
}

export interface ChangeApprovalRequest {
  changeNumber: string;
  changeTitle: string;
  type: 'Normal' | 'Standard' | 'Emergency';
  approvalChain: Array<{
    stage: number;
    approver: string;
    role: string;
  }>;
  description: string;
}

export interface EscalationRequest {
  incidentNumber: string;
  currentPriority: string;
  targetPriority: string;
  reason: string;
  escalateTo: string; // UPN of duty manager
  slaBreach: boolean;
}

// ── Flow Triggering ──

/**
 * Trigger a Power Automate flow via HTTP connector.
 */
export async function triggerFlow(trigger: FlowTrigger): Promise<FlowResult> {
  const endpoint = FLOW_ENDPOINTS[trigger.flowType];

  if (!endpoint) {
    console.warn(`[PowerAutomate] No endpoint configured for ${trigger.flowType}`);
    return logFallback(trigger);
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...trigger.data,
        correlationId: trigger.correlationId || crypto.randomUUID(),
        callbackUrl: trigger.callbackUrl,
        source: 'itsm-digital-worker',
        triggeredAt: new Date().toISOString(),
      }),
    });

    if (res.ok || res.status === 202) {
      const body = await res.json().catch(() => ({})) as Record<string, string>;
      console.log(`[PowerAutomate] Flow ${trigger.flowType} triggered successfully`);
      return {
        triggered: true,
        flowRunId: body.flowRunId || body.id || 'accepted',
        flowType: trigger.flowType,
        method: 'power-automate',
      };
    }

    const errorText = await res.text();
    console.error(`[PowerAutomate] Flow ${trigger.flowType} failed (${res.status}): ${errorText}`);
    return {
      triggered: false,
      flowType: trigger.flowType,
      error: `HTTP ${res.status}: ${errorText.slice(0, 200)}`,
      method: 'power-automate',
    };
  } catch (err) {
    console.error(`[PowerAutomate] Flow ${trigger.flowType} error:`, (err as Error).message);
    return logFallback(trigger);
  }
}

function logFallback(trigger: FlowTrigger): FlowResult {
  console.log(`[PowerAutomate:Fallback] Would trigger ${trigger.flowType}:`, JSON.stringify(trigger.data).slice(0, 200));
  return {
    triggered: false,
    flowType: trigger.flowType,
    error: 'Flow endpoint not configured',
    method: 'fallback',
  };
}

// ── Convenience Functions ──

import crypto from 'crypto';

export async function triggerCabVoting(request: CabVotingRequest): Promise<FlowResult> {
  return triggerFlow({
    flowType: 'cabVoting',
    data: {
      changeNumber: request.changeNumber,
      changeTitle: request.changeTitle,
      risk: request.risk,
      impact: request.impact,
      implementationPlan: request.implementationPlan,
      rollbackPlan: request.rollbackPlan,
      cabMembers: request.cabMembers,
      votingDeadline: request.votingDeadline,
      requiredApprovals: request.requiredApprovals,
    },
    correlationId: `cab-${request.changeNumber}`,
  });
}

export async function triggerChangeApproval(request: ChangeApprovalRequest): Promise<FlowResult> {
  return triggerFlow({
    flowType: 'changeApproval',
    data: {
      changeNumber: request.changeNumber,
      changeTitle: request.changeTitle,
      type: request.type,
      approvalChain: request.approvalChain,
      description: request.description,
    },
    correlationId: `chg-${request.changeNumber}`,
  });
}

export async function triggerIncidentEscalation(request: EscalationRequest): Promise<FlowResult> {
  return triggerFlow({
    flowType: 'incidentEscalation',
    data: {
      incidentNumber: request.incidentNumber,
      currentPriority: request.currentPriority,
      targetPriority: request.targetPriority,
      reason: request.reason,
      escalateTo: request.escalateTo,
      slaBreach: request.slaBreach,
    },
    correlationId: `esc-${request.incidentNumber}`,
  });
}

// ── Flow Callback Handler ──

export interface FlowCallback {
  flowRunId: string;
  flowType: string;
  status: 'Succeeded' | 'Failed' | 'Cancelled' | 'TimedOut';
  outputs: Record<string, unknown>;
  correlationId: string;
}

type FlowCallbackHandler = (callback: FlowCallback) => Promise<void>;
const callbackHandlers = new Map<string, FlowCallbackHandler>();

export function onFlowCallback(flowType: string, handler: FlowCallbackHandler): void {
  callbackHandlers.set(flowType, handler);
}

export async function handleFlowCallback(callback: FlowCallback): Promise<boolean> {
  const handler = callbackHandlers.get(callback.flowType);
  if (handler) {
    await handler(callback);
    return true;
  }
  console.warn(`[PowerAutomate] No handler for flow type: ${callback.flowType}`);
  return false;
}

// ── Status ──

export function getPowerAutomateStatus(): {
  configuredFlows: string[];
  unconfiguredFlows: string[];
} {
  const configured: string[] = [];
  const unconfigured: string[] = [];

  for (const [flow, url] of Object.entries(FLOW_ENDPOINTS)) {
    if (url) configured.push(flow);
    else unconfigured.push(flow);
  }

  return { configuredFlows: configured, unconfiguredFlows: unconfigured };
}
