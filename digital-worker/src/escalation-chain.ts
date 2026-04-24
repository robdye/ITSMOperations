// ITSM Operations — Escalation Chain
// Auto-escalates when workers fail, timeout, or tickets stall.
// Chain: Worker → Command Center → Human (Teams + Email)

import { runWorker, type PromptContext, type HarnessResult } from './agent-harness';
import { workerMap, commandCenter } from './worker-definitions';

// ── Escalation Levels ──

export type EscalationLevel = 'worker' | 'command-center' | 'human';

export interface EscalationEvent {
  id: string;
  originalWorkerId: string;
  currentLevel: EscalationLevel;
  reason: string;
  context: string;
  attempts: number;
  timestamp: Date;
  resolution?: string;
}

// ── Escalation Config ──

const MAX_WORKER_RETRIES = 2;
const ESCALATION_TIMEOUT_MS = 60_000; // 1 minute per worker attempt

// ── In-memory escalation log (replaced by audit-trail in production) ──

const escalationLog: EscalationEvent[] = [];
export const MAX_ESCALATION_LOG = 500;

export function getEscalationLog(): EscalationEvent[] {
  return [...escalationLog];
}

export function getActiveEscalations(): EscalationEvent[] {
  return escalationLog.filter(e => !e.resolution);
}

// ── Core Escalation Logic ──

/**
 * Execute a worker with automatic escalation on failure.
 * Level 1: Retry the worker (up to MAX_WORKER_RETRIES)
 * Level 2: Escalate to Command Center
 * Level 3: Escalate to human (returns escalation message for Teams/email)
 */
export async function executeWithEscalation(
  workerId: string,
  prompt: string,
  ctx?: PromptContext,
): Promise<HarnessResult & { escalated: boolean; escalationLevel: EscalationLevel }> {
  const worker = workerMap.get(workerId);
  if (!worker) {
    throw new Error(`Unknown worker: ${workerId}`);
  }

  const escalationId = `esc-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  let attempts = 0;

  // Level 1: Try the worker directly (with retries)
  while (attempts < MAX_WORKER_RETRIES) {
    attempts++;
    try {
      const result = await runWorker(worker, prompt, ctx);
      // Check for error responses
      if (!result.output.startsWith('Error in ')) {
        return { ...result, escalated: false, escalationLevel: 'worker' };
      }
      console.warn(`[Escalation] Worker ${workerId} returned error (attempt ${attempts}/${MAX_WORKER_RETRIES})`);
    } catch (err) {
      console.warn(`[Escalation] Worker ${workerId} threw (attempt ${attempts}/${MAX_WORKER_RETRIES}):`, err);
    }
  }

  // Level 2: Escalate to Command Center
  console.log(`[Escalation] ${workerId} failed after ${MAX_WORKER_RETRIES} attempts → Command Center`);

  const escalationEvent: EscalationEvent = {
    id: escalationId,
    originalWorkerId: workerId,
    currentLevel: 'command-center',
    reason: `Worker ${workerId} failed after ${MAX_WORKER_RETRIES} attempts`,
    context: prompt.substring(0, 500),
    attempts,
    timestamp: new Date(),
  };
  escalationLog.push(escalationEvent);
  if (escalationLog.length > MAX_ESCALATION_LOG) escalationLog.shift();

  try {
    const ccPrompt = `[ESCALATION from ${worker.name}]\n\nThe ${worker.name} worker failed to handle this request after ${MAX_WORKER_RETRIES} attempts.\n\nOriginal request: ${prompt}\n\nPlease handle this cross-practice or escalate to a human operator if needed.`;
    const ccResult = await runWorker(commandCenter, ccPrompt, ctx);

    if (!ccResult.output.startsWith('Error in ')) {
      escalationEvent.resolution = 'Handled by Command Center';
      return { ...ccResult, escalated: true, escalationLevel: 'command-center' };
    }
  } catch (err) {
    console.error('[Escalation] Command Center also failed:', err);
  }

  // Level 3: Escalate to human
  console.log(`[Escalation] Command Center also failed → Human escalation`);
  escalationEvent.currentLevel = 'human';

  const humanMessage = formatHumanEscalation(escalationEvent, prompt);

  return {
    output: humanMessage,
    workerId: 'escalation-chain',
    crossPractice: true,
    escalated: true,
    escalationLevel: 'human',
  };
}

/**
 * Format the escalation message for human operators.
 */
function formatHumanEscalation(event: EscalationEvent, originalPrompt: string): string {
  return `🚨 **Human Escalation Required**\n\n` +
    `**Escalation ID**: ${event.id}\n` +
    `**Original Worker**: ${event.originalWorkerId}\n` +
    `**Reason**: ${event.reason}\n` +
    `**Attempts**: ${event.attempts} worker + 1 Command Center\n` +
    `**Timestamp**: ${event.timestamp.toISOString()}\n\n` +
    `**Original Request**:\n${originalPrompt.substring(0, 500)}\n\n` +
    `This request could not be handled automatically. Please review and take manual action.\n` +
    `The IT Operations Manager has been notified via Teams and email.`;
}

/**
 * Generate a stale ticket escalation event.
 * Called by scheduled routines when tickets sit without updates.
 */
export function createStaleTicketEscalation(
  ticketNumber: string,
  workerId: string,
  hoursSinceUpdate: number,
): EscalationEvent {
  const event: EscalationEvent = {
    id: `esc-stale-${Date.now()}`,
    originalWorkerId: workerId,
    currentLevel: hoursSinceUpdate > 8 ? 'human' : 'command-center',
    reason: `Ticket ${ticketNumber} has had no update for ${hoursSinceUpdate} hours`,
    context: `Stale ticket: ${ticketNumber}`,
    attempts: 0,
    timestamp: new Date(),
  };
  escalationLog.push(event);
  if (escalationLog.length > MAX_ESCALATION_LOG) escalationLog.shift();
  return event;
}
