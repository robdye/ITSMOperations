/**
 * Power Automate Flow Definitions — ITSM Workflow Templates.
 * Defines flow templates as JSON and provides management functions
 * to deploy and trigger flows via the Power Automate Management API.
 */

import crypto from 'crypto';

// ── Configuration ──

const POWER_AUTOMATE_ENV = process.env.POWER_AUTOMATE_ENVIRONMENT || '';
const POWER_AUTOMATE_API_BASE = process.env.POWER_AUTOMATE_API_BASE
  || 'https://api.flow.microsoft.com';
const POWER_AUTOMATE_TOKEN = process.env.POWER_AUTOMATE_TOKEN || '';

// HTTP trigger URLs for deployed flows (populated after deployment or from env)
const FLOW_TRIGGER_URLS: Record<string, string> = {
  cabVoting: process.env.POWER_AUTOMATE_CAB_VOTING_URL || '',
  changeApprovalChain: process.env.POWER_AUTOMATE_CHANGE_APPROVAL_URL || '',
  escalation: process.env.POWER_AUTOMATE_INCIDENT_ESCALATION_URL || '',
  emergencyChange: process.env.POWER_AUTOMATE_EMERGENCY_CHANGE_URL || '',
};

// ── Types ──

export interface FlowTemplate {
  name: string;
  displayName: string;
  description: string;
  trigger: FlowTrigger;
  actions: FlowAction[];
}

export interface FlowTrigger {
  type: 'http' | 'schedule' | 'manual';
  method?: string;
  schema?: Record<string, unknown>;
  frequency?: string;
  interval?: number;
}

export interface FlowAction {
  name: string;
  type: string;
  description: string;
  inputs: Record<string, unknown>;
  runAfter?: string[];
  conditions?: FlowCondition[];
}

export interface FlowCondition {
  field: string;
  operator: 'equals' | 'notEquals' | 'greaterThan' | 'contains';
  value: string | number | boolean;
}

export interface DeployFlowResult {
  flowName: string;
  success: boolean;
  flowId?: string;
  triggerUrl?: string;
  error?: string;
}

// ── Flow Templates ──

/** CAB Voting — parallel approval across CAB members with deadline */
export const cabVotingFlow: FlowTemplate = {
  name: 'cabVoting',
  displayName: 'ITSM CAB Voting',
  description: 'Parallel approval workflow for Change Advisory Board voting with quorum and deadline enforcement.',
  trigger: {
    type: 'http',
    method: 'POST',
    schema: {
      type: 'object',
      properties: {
        changeNumber: { type: 'string' },
        changeTitle: { type: 'string' },
        risk: { type: 'string', enum: ['high', 'medium', 'low'] },
        impact: { type: 'string' },
        implementationPlan: { type: 'string' },
        rollbackPlan: { type: 'string' },
        cabMembers: { type: 'array', items: { type: 'string' } },
        votingDeadline: { type: 'string', format: 'date-time' },
        requiredApprovals: { type: 'integer' },
        correlationId: { type: 'string' },
      },
      required: ['changeNumber', 'changeTitle', 'cabMembers', 'requiredApprovals'],
    },
  },
  actions: [
    {
      name: 'initializeVoteTracking',
      type: 'InitializeVariable',
      description: 'Initialize vote count and results tracking variables.',
      inputs: {
        variables: [
          { name: 'approvedCount', type: 'Integer', value: 0 },
          { name: 'rejectedCount', type: 'Integer', value: 0 },
          { name: 'voteResults', type: 'Array', value: [] },
        ],
      },
    },
    {
      name: 'sendParallelApprovals',
      type: 'ApplyToEach_Parallel',
      description: 'Send approval requests to all CAB members in parallel.',
      runAfter: ['initializeVoteTracking'],
      inputs: {
        from: '@triggerBody().cabMembers',
        actions: {
          sendApproval: {
            type: 'StartAndWaitForApproval',
            inputs: {
              approvalType: 'Basic',
              title: 'CAB Vote: @{triggerBody().changeTitle}',
              assignedTo: '@{items(\'sendParallelApprovals\')}',
              details: 'Change: @{triggerBody().changeNumber}\nRisk: @{triggerBody().risk}\nImpact: @{triggerBody().impact}\n\nImplementation Plan:\n@{triggerBody().implementationPlan}\n\nRollback Plan:\n@{triggerBody().rollbackPlan}',
              itemLink: '@{triggerBody().changeUrl}',
            },
          },
          trackVote: {
            type: 'AppendToArrayVariable',
            runAfter: ['sendApproval'],
            inputs: {
              name: 'voteResults',
              value: {
                voter: '@{items(\'sendParallelApprovals\')}',
                outcome: '@{body(\'sendApproval\').outcome}',
                comments: '@{body(\'sendApproval\').comments}',
                respondedAt: '@{utcNow()}',
              },
            },
          },
        },
      },
    },
    {
      name: 'evaluateQuorum',
      type: 'Condition',
      description: 'Check if enough approvals were received to meet quorum.',
      runAfter: ['sendParallelApprovals'],
      conditions: [
        { field: 'approvedCount', operator: 'greaterThan', value: '@triggerBody().requiredApprovals' },
      ],
      inputs: {
        expression: {
          greaterThanOrEquals: [
            '@length(filter(variables(\'voteResults\'), item => item.outcome == \'Approve\'))',
            '@triggerBody().requiredApprovals',
          ],
        },
        ifTrue: {
          postCallbackApproved: {
            type: 'Http',
            inputs: {
              method: 'POST',
              uri: '@triggerBody().callbackUrl',
              body: {
                changeNumber: '@triggerBody().changeNumber',
                status: 'Approved',
                votes: '@variables(\'voteResults\')',
                correlationId: '@triggerBody().correlationId',
              },
            },
          },
        },
        ifFalse: {
          postCallbackRejected: {
            type: 'Http',
            inputs: {
              method: 'POST',
              uri: '@triggerBody().callbackUrl',
              body: {
                changeNumber: '@triggerBody().changeNumber',
                status: 'Rejected',
                votes: '@variables(\'voteResults\')',
                correlationId: '@triggerBody().correlationId',
              },
            },
          },
        },
      },
    },
  ],
};

/** Change Approval Chain — sequential multi-stage approval */
export const changeApprovalChainFlow: FlowTemplate = {
  name: 'changeApprovalChain',
  displayName: 'ITSM Change Approval Chain',
  description: 'Sequential multi-stage approval chain for change requests. Each stage must approve before the next is triggered.',
  trigger: {
    type: 'http',
    method: 'POST',
    schema: {
      type: 'object',
      properties: {
        changeNumber: { type: 'string' },
        changeTitle: { type: 'string' },
        type: { type: 'string', enum: ['Normal', 'Standard', 'Emergency'] },
        description: { type: 'string' },
        approvalChain: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              stage: { type: 'integer' },
              approver: { type: 'string' },
              role: { type: 'string' },
            },
          },
        },
        correlationId: { type: 'string' },
      },
      required: ['changeNumber', 'changeTitle', 'approvalChain'],
    },
  },
  actions: [
    {
      name: 'initializeStageTracking',
      type: 'InitializeVariable',
      description: 'Track the current stage and overall approval status.',
      inputs: {
        variables: [
          { name: 'currentStage', type: 'Integer', value: 0 },
          { name: 'overallStatus', type: 'String', value: 'InProgress' },
          { name: 'stageResults', type: 'Array', value: [] },
        ],
      },
    },
    {
      name: 'iterateApprovalChain',
      type: 'ApplyToEach_Sequential',
      description: 'Process each approval stage sequentially. Stop on rejection.',
      runAfter: ['initializeStageTracking'],
      inputs: {
        from: '@triggerBody().approvalChain',
        actions: {
          checkNotRejected: {
            type: 'Condition',
            inputs: {
              expression: { equals: ['@variables(\'overallStatus\')', 'InProgress'] },
            },
          },
          sendStageApproval: {
            type: 'StartAndWaitForApproval',
            inputs: {
              approvalType: 'Basic',
              title: 'Change Approval Stage @{items(\'iterateApprovalChain\').stage}: @{triggerBody().changeTitle}',
              assignedTo: '@{items(\'iterateApprovalChain\').approver}',
              details: 'Change: @{triggerBody().changeNumber}\nType: @{triggerBody().type}\nRole: @{items(\'iterateApprovalChain\').role}\n\n@{triggerBody().description}',
            },
          },
          recordStageResult: {
            type: 'AppendToArrayVariable',
            runAfter: ['sendStageApproval'],
            inputs: {
              name: 'stageResults',
              value: {
                stage: '@{items(\'iterateApprovalChain\').stage}',
                approver: '@{items(\'iterateApprovalChain\').approver}',
                role: '@{items(\'iterateApprovalChain\').role}',
                outcome: '@{body(\'sendStageApproval\').outcome}',
                respondedAt: '@{utcNow()}',
              },
            },
          },
          updateStatusOnReject: {
            type: 'SetVariable',
            runAfter: ['sendStageApproval'],
            conditions: [{ field: 'outcome', operator: 'equals', value: 'Reject' }],
            inputs: { name: 'overallStatus', value: 'Rejected' },
          },
        },
      },
    },
    {
      name: 'sendFinalCallback',
      type: 'Http',
      description: 'Post the final approval chain result back to the ITSM worker.',
      runAfter: ['iterateApprovalChain'],
      inputs: {
        method: 'POST',
        uri: '@triggerBody().callbackUrl',
        body: {
          changeNumber: '@triggerBody().changeNumber',
          status: '@variables(\'overallStatus\')',
          stages: '@variables(\'stageResults\')',
          correlationId: '@triggerBody().correlationId',
        },
      },
    },
  ],
};

/** Escalation Flow — incident priority escalation with duty manager notification */
export const escalationFlow: FlowTemplate = {
  name: 'escalation',
  displayName: 'ITSM Incident Escalation',
  description: 'Escalates an incident to a duty manager via Teams and email, with SLA breach urgency tagging.',
  trigger: {
    type: 'http',
    method: 'POST',
    schema: {
      type: 'object',
      properties: {
        incidentNumber: { type: 'string' },
        currentPriority: { type: 'string' },
        targetPriority: { type: 'string' },
        reason: { type: 'string' },
        escalateTo: { type: 'string' },
        slaBreach: { type: 'boolean' },
        correlationId: { type: 'string' },
      },
      required: ['incidentNumber', 'escalateTo', 'reason'],
    },
  },
  actions: [
    {
      name: 'determineUrgency',
      type: 'Condition',
      description: 'Check if this is an SLA breach escalation requiring urgent handling.',
      inputs: {
        expression: { equals: ['@triggerBody().slaBreach', true] },
        ifTrue: { urgencyTag: 'SLA_BREACH_URGENT' },
        ifFalse: { urgencyTag: 'NORMAL' },
      },
    },
    {
      name: 'sendTeamsNotification',
      type: 'PostMessageToTeamsChannel',
      description: 'Post an escalation alert to the duty manager in Teams.',
      runAfter: ['determineUrgency'],
      inputs: {
        channel: '@{parameters(\'opsChannelId\')}',
        message: {
          subject: '🚨 Escalation: @{triggerBody().incidentNumber}',
          body: '<b>Incident:</b> @{triggerBody().incidentNumber}<br/><b>From:</b> P@{triggerBody().currentPriority} → P@{triggerBody().targetPriority}<br/><b>Reason:</b> @{triggerBody().reason}<br/><b>SLA Breach:</b> @{triggerBody().slaBreach}',
          importance: '@{if(triggerBody().slaBreach, \'High\', \'Normal\')}',
        },
      },
    },
    {
      name: 'sendEscalationEmail',
      type: 'SendEmail_V2',
      description: 'Email the duty manager with escalation details.',
      runAfter: ['determineUrgency'],
      inputs: {
        to: '@{triggerBody().escalateTo}',
        subject: '[ITSM Escalation] @{triggerBody().incidentNumber} - @{if(triggerBody().slaBreach, \'SLA BREACH\', \'Priority Change\')}',
        body: 'Incident @{triggerBody().incidentNumber} requires your attention.\n\nPriority change: P@{triggerBody().currentPriority} → P@{triggerBody().targetPriority}\nReason: @{triggerBody().reason}\nSLA Breach: @{triggerBody().slaBreach}',
        importance: '@{if(triggerBody().slaBreach, \'High\', \'Normal\')}',
      },
    },
    {
      name: 'requestApproval',
      type: 'StartAndWaitForApproval',
      description: 'Request duty manager approval for the escalation.',
      runAfter: ['sendTeamsNotification', 'sendEscalationEmail'],
      inputs: {
        approvalType: 'Basic',
        title: 'Approve Escalation: @{triggerBody().incidentNumber}',
        assignedTo: '@{triggerBody().escalateTo}',
        details: 'Approve priority escalation from P@{triggerBody().currentPriority} to P@{triggerBody().targetPriority}?\n\nReason: @{triggerBody().reason}',
      },
    },
    {
      name: 'postCallback',
      type: 'Http',
      description: 'Return escalation result to ITSM worker.',
      runAfter: ['requestApproval'],
      inputs: {
        method: 'POST',
        uri: '@triggerBody().callbackUrl',
        body: {
          incidentNumber: '@triggerBody().incidentNumber',
          approved: '@{equals(body(\'requestApproval\').outcome, \'Approve\')}',
          approver: '@triggerBody().escalateTo',
          comments: '@{body(\'requestApproval\').comments}',
          correlationId: '@triggerBody().correlationId',
        },
      },
    },
  ],
};

/** Emergency Change Flow — fast-track approval with auto-escalation timer */
export const emergencyChangeFlow: FlowTemplate = {
  name: 'emergencyChange',
  displayName: 'ITSM Emergency Change',
  description: 'Fast-track emergency change approval with duty manager sign-off and auto-escalation on timeout.',
  trigger: {
    type: 'http',
    method: 'POST',
    schema: {
      type: 'object',
      properties: {
        changeNumber: { type: 'string' },
        changeTitle: { type: 'string' },
        justification: { type: 'string' },
        implementationPlan: { type: 'string' },
        rollbackPlan: { type: 'string' },
        dutyManager: { type: 'string' },
        backupManager: { type: 'string' },
        timeoutMinutes: { type: 'integer' },
        correlationId: { type: 'string' },
      },
      required: ['changeNumber', 'changeTitle', 'justification', 'dutyManager'],
    },
  },
  actions: [
    {
      name: 'sendUrgentTeamsAlert',
      type: 'PostAdaptiveCardToTeamsChannel',
      description: 'Post an urgent adaptive card to the ops channel for visibility.',
      inputs: {
        channel: '@{parameters(\'opsChannelId\')}',
        card: {
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: '🚨 EMERGENCY CHANGE', size: 'Large', weight: 'Bolder', color: 'Attention' },
            { type: 'TextBlock', text: '@{triggerBody().changeNumber}: @{triggerBody().changeTitle}' },
            { type: 'TextBlock', text: 'Justification: @{triggerBody().justification}', wrap: true },
          ],
        },
      },
    },
    {
      name: 'requestDutyManagerApproval',
      type: 'StartAndWaitForApproval',
      description: 'Request emergency approval from the primary duty manager with a short timeout.',
      runAfter: ['sendUrgentTeamsAlert'],
      inputs: {
        approvalType: 'BasicAwaitAll',
        title: '🚨 EMERGENCY CHANGE: @{triggerBody().changeTitle}',
        assignedTo: '@{triggerBody().dutyManager}',
        details: 'Change: @{triggerBody().changeNumber}\n\nJustification: @{triggerBody().justification}\n\nImplementation Plan:\n@{triggerBody().implementationPlan}\n\nRollback Plan:\n@{triggerBody().rollbackPlan}',
        enableNotifications: true,
        enableReassignment: true,
      },
    },
    {
      name: 'checkForTimeout',
      type: 'Condition',
      description: 'If primary manager did not respond, escalate to backup manager.',
      runAfter: ['requestDutyManagerApproval'],
      conditions: [
        { field: 'outcome', operator: 'equals', value: 'Approve' },
      ],
      inputs: {
        expression: {
          or: [
            { equals: ['@body(\'requestDutyManagerApproval\').outcome', 'Approve'] },
            { equals: ['@body(\'requestDutyManagerApproval\').outcome', 'Reject'] },
          ],
        },
        ifTrue: {
          postResult: {
            type: 'Http',
            inputs: {
              method: 'POST',
              uri: '@triggerBody().callbackUrl',
              body: {
                changeNumber: '@triggerBody().changeNumber',
                approved: '@{equals(body(\'requestDutyManagerApproval\').outcome, \'Approve\')}',
                approver: '@triggerBody().dutyManager',
                escalated: false,
                correlationId: '@triggerBody().correlationId',
              },
            },
          },
        },
        ifFalse: {
          escalateToBackup: {
            type: 'StartAndWaitForApproval',
            inputs: {
              approvalType: 'Basic',
              title: '🚨 ESCALATED EMERGENCY CHANGE: @{triggerBody().changeTitle}',
              assignedTo: '@{triggerBody().backupManager}',
              details: 'Primary duty manager did not respond. Please review.\n\nChange: @{triggerBody().changeNumber}\nJustification: @{triggerBody().justification}',
            },
          },
          postEscalatedResult: {
            type: 'Http',
            runAfter: ['escalateToBackup'],
            inputs: {
              method: 'POST',
              uri: '@triggerBody().callbackUrl',
              body: {
                changeNumber: '@triggerBody().changeNumber',
                approved: '@{equals(body(\'escalateToBackup\').outcome, \'Approve\')}',
                approver: '@triggerBody().backupManager',
                escalated: true,
                correlationId: '@triggerBody().correlationId',
              },
            },
          },
        },
      },
    },
  ],
};

/** All flow templates indexed by name */
export const FLOW_TEMPLATES: Record<string, FlowTemplate> = {
  cabVoting: cabVotingFlow,
  changeApprovalChain: changeApprovalChainFlow,
  escalation: escalationFlow,
  emergencyChange: emergencyChangeFlow,
};

// ── Deployment ──

/**
 * Deploy all flow templates to Power Automate via the Management API.
 * Creates new flows or updates existing ones.
 */
export async function deployFlows(): Promise<DeployFlowResult[]> {
  if (!POWER_AUTOMATE_ENV) {
    console.warn('[PowerAutomateFlows] POWER_AUTOMATE_ENVIRONMENT not set — skipping deployment');
    return Object.keys(FLOW_TEMPLATES).map((name) => ({
      flowName: name,
      success: false,
      error: 'POWER_AUTOMATE_ENVIRONMENT not configured',
    }));
  }

  if (!POWER_AUTOMATE_TOKEN) {
    console.warn('[PowerAutomateFlows] POWER_AUTOMATE_TOKEN not set — skipping deployment');
    return Object.keys(FLOW_TEMPLATES).map((name) => ({
      flowName: name,
      success: false,
      error: 'POWER_AUTOMATE_TOKEN not configured',
    }));
  }

  const results: DeployFlowResult[] = [];

  for (const [name, template] of Object.entries(FLOW_TEMPLATES)) {
    try {
      const result = await deploySingleFlow(template);
      results.push(result);
    } catch (err) {
      results.push({
        flowName: name,
        success: false,
        error: (err as Error).message,
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  console.log(`[PowerAutomateFlows] Deployed ${succeeded}/${results.length} flows`);
  return results;
}

async function deploySingleFlow(template: FlowTemplate): Promise<DeployFlowResult> {
  const apiUrl = `${POWER_AUTOMATE_API_BASE}/providers/Microsoft.ProcessSimple/environments/${POWER_AUTOMATE_ENV}/flows`;

  const flowDefinition = {
    properties: {
      displayName: template.displayName,
      definition: {
        '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0.0',
        triggers: {
          manual: {
            type: template.trigger.type === 'http' ? 'Request' : template.trigger.type,
            kind: 'Http',
            inputs: {
              method: template.trigger.method || 'POST',
              schema: template.trigger.schema || {},
            },
          },
        },
        actions: buildActionsMap(template.actions),
      },
      state: 'Started',
    },
  };

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${POWER_AUTOMATE_TOKEN}`,
    },
    body: JSON.stringify(flowDefinition),
  });

  if (res.ok || res.status === 201) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const flowId = (body.name as string) || '';
    console.log(`[PowerAutomateFlows] Deployed flow '${template.displayName}' (${flowId})`);
    return {
      flowName: template.name,
      success: true,
      flowId,
    };
  }

  const errorText = await res.text();
  console.error(`[PowerAutomateFlows] Deploy failed for '${template.name}': ${res.status} ${errorText.slice(0, 300)}`);
  return {
    flowName: template.name,
    success: false,
    error: `HTTP ${res.status}: ${errorText.slice(0, 200)}`,
  };
}

function buildActionsMap(actions: FlowAction[]): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const action of actions) {
    map[action.name] = {
      type: action.type,
      inputs: action.inputs,
      runAfter: action.runAfter
        ? Object.fromEntries(action.runAfter.map((dep) => [dep, ['Succeeded']]))
        : {},
      description: action.description,
    };
  }
  return map;
}

// ── Trigger ──

/**
 * Trigger a deployed Power Automate flow by name via its HTTP trigger URL.
 */
export async function triggerFlow(
  flowName: string,
  payload: Record<string, unknown>,
): Promise<{ success: boolean; flowRunId?: string; error?: string }> {
  const url = FLOW_TRIGGER_URLS[flowName];
  if (!url) {
    console.warn(`[PowerAutomateFlows] No trigger URL for flow '${flowName}'. Configure via environment variable.`);
    return { success: false, error: `No trigger URL configured for '${flowName}'` };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        correlationId: (payload.correlationId as string) || crypto.randomUUID(),
        source: 'itsm-digital-worker',
        triggeredAt: new Date().toISOString(),
      }),
    });

    if (res.ok || res.status === 202) {
      const body = (await res.json().catch(() => ({}))) as Record<string, string>;
      console.log(`[PowerAutomateFlows] Flow '${flowName}' triggered successfully`);
      return { success: true, flowRunId: body.flowRunId || body.id || 'accepted' };
    }

    const errorText = await res.text();
    return { success: false, error: `HTTP ${res.status}: ${errorText.slice(0, 200)}` };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
