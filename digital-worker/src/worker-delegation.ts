// ITSM Operations — Worker-to-Worker Delegation
// Enables ITIL practice chain-of-command:
// Monitoring → Incident (exception detected)
// Incident → Problem (recurring pattern)
// Problem → Change (permanent fix proposal)
// Change → Release (deployment coordination)
// Any → Knowledge (KB article creation)
// Any → Command Center (cross-practice escalation)

import { runWorker, type PromptContext, type HarnessResult } from './agent-harness';
import { workerMap } from './worker-definitions';

// ── Delegation Rules ──
// Maps source worker → allowed target workers with delegation context

export interface DelegationRule {
  sourceWorker: string;
  targetWorker: string;
  trigger: string;  // Description of when this delegation fires
  promptTemplate: (context: string) => string;
}

export const DELEGATION_RULES: DelegationRule[] = [
  {
    sourceWorker: 'monitoring-manager',
    targetWorker: 'incident-manager',
    trigger: 'Exception event detected that requires incident creation',
    promptTemplate: (ctx) => `[AUTO-DELEGATION from Monitoring Manager]\n\nA monitoring exception has been detected that requires an incident to be created.\n\nEvent Details:\n${ctx}\n\nPlease create an incident for this exception and assign to the appropriate team.`,
  },
  {
    sourceWorker: 'incident-manager',
    targetWorker: 'problem-manager',
    trigger: 'Recurring incidents detected on same CI (3+ in 30 days)',
    promptTemplate: (ctx) => `[AUTO-DELEGATION from Incident Manager]\n\nRecurring incident pattern detected that warrants problem investigation.\n\nPattern Details:\n${ctx}\n\nPlease create a problem record, begin root cause analysis, and link the related incidents.`,
  },
  {
    sourceWorker: 'problem-manager',
    targetWorker: 'change-manager',
    trigger: 'Permanent fix identified, change proposal needed',
    promptTemplate: (ctx) => `[AUTO-DELEGATION from Problem Manager]\n\nA permanent fix has been identified for a known error. A change request is needed.\n\nFix Details:\n${ctx}\n\nPlease create a change request for this permanent fix with appropriate risk assessment.`,
  },
  {
    sourceWorker: 'change-manager',
    targetWorker: 'release-manager',
    trigger: 'Change approved and ready for deployment coordination',
    promptTemplate: (ctx) => `[AUTO-DELEGATION from Change Manager]\n\nAn approved change is ready for release coordination.\n\nChange Details:\n${ctx}\n\nPlease coordinate the deployment schedule and readiness checks.`,
  },
  {
    sourceWorker: 'incident-manager',
    targetWorker: 'knowledge-manager',
    trigger: 'Resolution found for incident with no existing KB article',
    promptTemplate: (ctx) => `[AUTO-DELEGATION from Incident Manager]\n\nAn incident was resolved with a novel solution that should be documented.\n\nResolution Details:\n${ctx}\n\nPlease create a knowledge base article documenting this resolution for future self-service.`,
  },
  {
    sourceWorker: 'sla-manager',
    targetWorker: 'incident-manager',
    trigger: 'SLA breach imminent — escalation needed',
    promptTemplate: (ctx) => `[AUTO-DELEGATION from SLA Manager]\n\nAn SLA breach is imminent and requires immediate escalation.\n\nSLA Details:\n${ctx}\n\nPlease escalate the associated tickets and ensure they are prioritized for immediate resolution.`,
  },
  {
    sourceWorker: 'security-manager',
    targetWorker: 'change-manager',
    trigger: 'Security vulnerability requires emergency change',
    promptTemplate: (ctx) => `[AUTO-DELEGATION from Security Manager]\n\nA security vulnerability has been identified that requires an emergency change.\n\nVulnerability Details:\n${ctx}\n\nPlease create an emergency change request and fast-track through ECAB.`,
  },
  {
    sourceWorker: 'vendor-manager',
    targetWorker: 'asset-cmdb-manager',
    trigger: 'Contract expiry requires asset review',
    promptTemplate: (ctx) => `[AUTO-DELEGATION from Vendor Manager]\n\nA vendor contract is expiring and the associated assets need review.\n\nContract Details:\n${ctx}\n\nPlease review all assets under this contract and flag any that need migration or replacement.`,
  },
];

// ── Delegation Result ──

export interface DelegationResult {
  delegationId: string;
  sourceWorker: string;
  targetWorker: string;
  trigger: string;
  result: HarnessResult;
  timestamp: Date;
}

// ── Delegation Execution ──

/**
 * Delegate a task from one worker to another following ITIL chain-of-command.
 * Returns the delegated worker's response.
 */
export async function delegateToWorker(
  sourceWorkerId: string,
  targetWorkerId: string,
  context: string,
  displayName?: string,
): Promise<DelegationResult> {
  const targetWorker = workerMap.get(targetWorkerId);
  if (!targetWorker) {
    throw new Error(`Unknown target worker: ${targetWorkerId}`);
  }

  // Find matching rule (optional — delegation can also be ad-hoc)
  const rule = DELEGATION_RULES.find(
    r => r.sourceWorker === sourceWorkerId && r.targetWorker === targetWorkerId
  );

  const prompt = rule
    ? rule.promptTemplate(context)
    : `[DELEGATION from ${sourceWorkerId}]\n\n${context}`;

  const ctx: PromptContext = {
    userMessage: context,
    displayName: displayName || 'System (auto-delegation)',
  };

  console.log(`[Delegation] ${sourceWorkerId} → ${targetWorkerId}: ${rule?.trigger || 'ad-hoc delegation'}`);

  const result = await runWorker(targetWorker, prompt, ctx);

  return {
    delegationId: `del-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    sourceWorker: sourceWorkerId,
    targetWorker: targetWorkerId,
    trigger: rule?.trigger || 'Ad-hoc delegation',
    result,
    timestamp: new Date(),
  };
}

/**
 * Check if a delegation rule exists between two workers.
 */
export function canDelegate(sourceWorkerId: string, targetWorkerId: string): boolean {
  return DELEGATION_RULES.some(
    r => r.sourceWorker === sourceWorkerId && r.targetWorker === targetWorkerId
  );
}

/**
 * Get all possible delegation targets for a given source worker.
 */
export function getDelegationTargets(sourceWorkerId: string): Array<{ targetWorker: string; trigger: string }> {
  return DELEGATION_RULES
    .filter(r => r.sourceWorker === sourceWorkerId)
    .map(r => ({ targetWorker: r.targetWorker, trigger: r.trigger }));
}
