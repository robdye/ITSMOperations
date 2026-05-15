// ITSM Operations — Evidence Pack (Pattern 3)
//
// Persists a per-action audit record with the full decision trail: actor,
// roles, action, risk, gate decision, tool calls, result, verifier outcome,
// timestamps, correlation IDs. Reuses the existing Cosmos `audit` container
// with `recordType: 'evidence'` as a discriminator (no new infrastructure,
// no breaking change to AuditEntry consumers).
//
// Falls back to in-memory when Cosmos is not configured.

import { storeAuditEntry, type AuditEntry } from './cosmos-store';
import { sanitizeParams } from './audit-trail';
import { POLICY_VERSION, type RolePolicyDecision, type ActionRisk } from './role-policy';

export interface EvidencePack {
  /** Stable id used in callers (e.g. agent-harness threading). */
  id: string;
  recordType: 'evidence';

  // Actor
  actor: string;
  actorRoles: string[];
  roleSource: 'graph' | 'a2a-env' | 'autonomous-config' | 'fallback' | 'cache';

  // Request
  workerId: string;
  workerName?: string;
  requestedAction: string;
  toolName: string;
  parameters?: Record<string, unknown> | string;
  actionRisk: ActionRisk;
  mode?: 'auto' | 'propose' | 'notify' | 'monitor';

  // Decision
  gateDecision: RolePolicyDecision;
  gateReason: string;
  policyVersion: string;
  leverEngaged?: 'kill-switch' | 'change-freeze' | 'force-mode-auto';

  // Execution (filled in incrementally)
  toolCalls?: Array<{ name: string; ms?: number; ok?: boolean }>;
  result?: { ok: boolean; summary?: string };
  verifierOutcome?: 'success' | 'partial' | 'inconclusive' | 'failure';
  evidenceLinks?: Array<{ kind: 'snow' | 'log' | 'screenshot' | 'url'; href: string }>;

  // Timing
  startedAt: string;
  completedAt?: string;
  durationMs?: number;

  // Correlation
  correlationId?: string;
  conversationId?: string;
  executionId?: string;
  signalId?: string;
  scenarioId?: string;
}

const MAX_IN_MEMORY = 500;
const inMemoryEvidence: EvidencePack[] = [];

function pushInMemory(pack: EvidencePack): void {
  inMemoryEvidence.push(pack);
  if (inMemoryEvidence.length > MAX_IN_MEMORY) inMemoryEvidence.shift();
}

/**
 * Persist an evidence pack to the Cosmos `audit` container under
 * `recordType: 'evidence'`. Best-effort — never throws. Returns the
 * full pack (with sanitized parameters) so callers can attach the id to
 * their own records.
 */
export async function recordEvidence(input: Omit<EvidencePack, 'recordType' | 'startedAt' | 'id'> & {
  id?: string;
  startedAt?: string;
}): Promise<EvidencePack> {
  const id = input.id || `evidence-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const startedAt = input.startedAt || new Date().toISOString();
  const completedAt = input.completedAt || new Date().toISOString();
  const durationMs = input.durationMs ?? new Date(completedAt).getTime() - new Date(startedAt).getTime();

  // Sanitize parameters — never persist raw secrets/tokens.
  let safeParams: Record<string, unknown> | string | undefined = input.parameters;
  if (safeParams && typeof safeParams === 'object') {
    try {
      safeParams = JSON.parse(sanitizeParams(JSON.stringify(safeParams))) as Record<string, unknown>;
    } catch {
      // leave as-is on parse failure
    }
  } else if (typeof safeParams === 'string') {
    safeParams = sanitizeParams(safeParams);
  }

  const pack: EvidencePack = {
    ...input,
    id,
    recordType: 'evidence',
    startedAt,
    completedAt,
    durationMs,
    parameters: safeParams,
    policyVersion: input.policyVersion || POLICY_VERSION,
  };

  // Adapt to the existing AuditEntry shape for Cosmos (it's schemaless — extra
  // fields persist alongside; the discriminator is `recordType`).
  const auditDoc: AuditEntry & EvidencePack = {
    ...pack,
    action: input.requestedAction || input.toolName,
    userId: pack.actor,
    detail: `${pack.gateDecision}: ${pack.gateReason}`,
    timestamp: pack.startedAt,
  };

  try {
    await storeAuditEntry(auditDoc as unknown as AuditEntry);
  } catch (err) {
    console.warn('[EvidencePack] Cosmos write failed, in-memory only:', (err as Error)?.message);
  }
  pushInMemory(pack);
  return pack;
}

/** Read-only snapshot for `/api/evidence` debug endpoints + tests. */
export function getRecentEvidence(limit = 50): EvidencePack[] {
  return inMemoryEvidence.slice(-limit);
}

/** Test helper. */
export function _resetEvidence(): void {
  inMemoryEvidence.length = 0;
}
