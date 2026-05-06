// ITSM Operations — Case Manager (Phase 3.1)
//
// Long-running unit of work that owns the lifecycle of one
// real-world subject (incident, change, vulnerability, knowledge
// gap, etc.). A Case is the persistent thing Alex thinks about
// across multiple workflows, approvals, voice calls, and shifts.
//
// Backend: Cosmos DB container `AlexCases` (partition key /tenantId).
// Falls back to in-memory map when Cosmos is not configured.
// Multi-tenant by /tenantId per the hard rule "tenant-isolated".
//
// Single numeric KPI per hard rule #1: surfaced at /api/cases/kpi.

import { CosmosClient, Container } from '@azure/cosmos';
import { logAuditEntry } from './audit-trail';

// ── Types ──

export type CaseState = 'open' | 'waiting' | 'blocked' | 'closed';

export interface CaseActivity {
  ts: string;
  kind: 'state' | 'note' | 'signal' | 'workflow' | 'approval' | 'enrichment' | 'reminder';
  by?: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface CaseApproval {
  approvalId: string;
  requestedAt: string;
  approver?: string;
  decidedAt?: string;
  decision?: 'approved' | 'denied' | 'pending';
  reason?: string;
}

export interface CaseEnrichment {
  source: string;
  ts: string;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface CaseRecord {
  id: string;
  tenantId: string;
  subjectRef: {
    kind: string;
    sysId?: string;
    number?: string;
    url?: string;
  };
  ownerWorkerId: string;
  state: CaseState;
  slaClock?: {
    breachAt?: string;
    pausedAt?: string;
    elapsedMs?: number;
  };
  relatedSignals: string[];
  relatedWorkflows: string[];
  pendingApprovals: CaseApproval[];
  notes: CaseActivity[];
  enrichments: CaseEnrichment[];
  nextReminderAt?: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  closeReason?: string;
}

// ── Backend ──

const COSMOS_CONNECTION_STRING = process.env.COSMOS_CONNECTION_STRING || '';
const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT || '';
const COSMOS_KEY = process.env.COSMOS_KEY || '';
const COSMOS_DATABASE = process.env.COSMOS_DATABASE || 'itsm';
const CASES_CONTAINER = process.env.COSMOS_CASES_CONTAINER || 'AlexCases';

let client: CosmosClient | null = null;
let container: Container | null = null;
let initialized = false;
let cosmosReady = false;
const memCases = new Map<string, CaseRecord>(); // id → record (fallback)

const caseKpi = {
  total: 0,
  byState: { open: 0, waiting: 0, blocked: 0, closed: 0 } as Record<CaseState, number>,
  remindersDue: 0,
  startedAt: Date.now(),
};

export function getCaseKpi(): {
  total: number;
  open: number;
  closed: number;
  byState: Record<CaseState, number>;
  remindersDue: number;
  uptimeSec: number;
} {
  return {
    total: caseKpi.total,
    open: caseKpi.byState.open + caseKpi.byState.waiting + caseKpi.byState.blocked,
    closed: caseKpi.byState.closed,
    byState: { ...caseKpi.byState },
    remindersDue: caseKpi.remindersDue,
    uptimeSec: Math.round((Date.now() - caseKpi.startedAt) / 1000),
  };
}

export async function initCaseManager(): Promise<void> {
  if (initialized) return;
  initialized = true;
  if (!COSMOS_CONNECTION_STRING && !COSMOS_ENDPOINT) {
    console.log('[CaseManager] No Cosmos configured — using in-memory store');
    return;
  }
  try {
    if (COSMOS_CONNECTION_STRING) {
      client = new CosmosClient(COSMOS_CONNECTION_STRING);
    } else if (COSMOS_ENDPOINT && COSMOS_KEY) {
      client = new CosmosClient({ endpoint: COSMOS_ENDPOINT, key: COSMOS_KEY });
    } else {
      const { DefaultAzureCredential } = await import('@azure/identity');
      client = new CosmosClient({
        endpoint: COSMOS_ENDPOINT,
        aadCredentials: new DefaultAzureCredential(),
      });
    }
    const { database } = await client.databases.createIfNotExists({ id: COSMOS_DATABASE });
    const { container: c } = await database.containers.createIfNotExists({
      id: CASES_CONTAINER,
      partitionKey: { paths: ['/tenantId'] },
      defaultTtl: -1, // explicit per-doc TTL only
    });
    container = c;
    cosmosReady = true;
    console.log(`[CaseManager] Connected to Cosmos container ${CASES_CONTAINER}`);
  } catch (err) {
    console.error('[CaseManager] Cosmos init failed — using in-memory fallback:', (err as Error).message);
    cosmosReady = false;
  }
}

// ── Persistence helpers ──

async function persist(record: CaseRecord): Promise<void> {
  memCases.set(record.id, record);
  if (cosmosReady && container) {
    try {
      await container.items.upsert(record);
    } catch (err) {
      console.warn('[CaseManager] cosmos upsert failed:', (err as Error).message);
    }
  }
}

async function loadById(id: string, tenantId: string): Promise<CaseRecord | null> {
  const cached = memCases.get(id);
  if (cached) return cached;
  if (cosmosReady && container) {
    try {
      const { resource } = await container.item(id, tenantId).read<CaseRecord>();
      if (resource) {
        memCases.set(resource.id, resource);
        return resource;
      }
    } catch {
      // not found
    }
  }
  return null;
}

function tenantOf(): string {
  return process.env.TENANT_ID || 'default';
}

function recomputeStateKpi(record: CaseRecord, prevState?: CaseState): void {
  if (prevState && prevState !== record.state) {
    caseKpi.byState[prevState] = Math.max(0, caseKpi.byState[prevState] - 1);
    caseKpi.byState[record.state] = (caseKpi.byState[record.state] || 0) + 1;
  }
}

// ── Public API ──

export interface OpenCaseInput {
  subjectRef: CaseRecord['subjectRef'];
  ownerWorkerId: string;
  initialNote?: string;
  slaBreachAt?: string;
  signalId?: string;
  workflowId?: string;
}

export async function openCase(input: OpenCaseInput): Promise<CaseRecord> {
  await initCaseManager();
  const now = new Date().toISOString();
  const id = `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = tenantOf();
  const record: CaseRecord = {
    id,
    tenantId,
    subjectRef: input.subjectRef,
    ownerWorkerId: input.ownerWorkerId,
    state: 'open',
    slaClock: input.slaBreachAt ? { breachAt: input.slaBreachAt } : undefined,
    relatedSignals: input.signalId ? [input.signalId] : [],
    relatedWorkflows: input.workflowId ? [input.workflowId] : [],
    pendingApprovals: [],
    notes: input.initialNote
      ? [{ ts: now, kind: 'note', text: input.initialNote }]
      : [],
    enrichments: [],
    createdAt: now,
    updatedAt: now,
  };
  caseKpi.total += 1;
  caseKpi.byState.open += 1;
  await persist(record);
  await logAuditEntry({
    workerId: 'case-manager',
    workerName: 'Case Manager',
    toolName: 'openCase',
    riskLevel: 'write',
    triggeredBy: input.signalId || 'system',
    triggerType: 'scheduled',
    parameters: JSON.stringify({ id, subject: input.subjectRef }),
    resultSummary: `case opened (owner=${input.ownerWorkerId})`,
    requiredConfirmation: false,
    durationMs: 0,
  }).catch(() => {});
  return record;
}

export async function appendActivity(
  id: string,
  activity: Omit<CaseActivity, 'ts'> & { ts?: string },
): Promise<CaseRecord | null> {
  const tenantId = tenantOf();
  const record = await loadById(id, tenantId);
  if (!record) return null;
  record.notes.push({ ts: activity.ts || new Date().toISOString(), ...activity });
  record.updatedAt = new Date().toISOString();
  await persist(record);
  return record;
}

export async function setState(id: string, state: CaseState, reason?: string): Promise<CaseRecord | null> {
  const tenantId = tenantOf();
  const record = await loadById(id, tenantId);
  if (!record) return null;
  const prev = record.state;
  if (prev === state) return record;
  record.state = state;
  record.updatedAt = new Date().toISOString();
  if (state === 'closed') {
    record.closedAt = record.updatedAt;
    record.closeReason = reason;
  }
  record.notes.push({
    ts: record.updatedAt,
    kind: 'state',
    text: `${prev} → ${state}${reason ? ` (${reason})` : ''}`,
  });
  recomputeStateKpi(record, prev);
  await persist(record);
  return record;
}

export async function addRelatedSignal(id: string, signalId: string): Promise<CaseRecord | null> {
  const tenantId = tenantOf();
  const record = await loadById(id, tenantId);
  if (!record) return null;
  if (!record.relatedSignals.includes(signalId)) {
    record.relatedSignals.push(signalId);
    record.notes.push({
      ts: new Date().toISOString(),
      kind: 'signal',
      text: `linked signal ${signalId}`,
    });
    record.updatedAt = new Date().toISOString();
    await persist(record);
  }
  return record;
}

export async function addRelatedWorkflow(id: string, workflowId: string): Promise<CaseRecord | null> {
  const tenantId = tenantOf();
  const record = await loadById(id, tenantId);
  if (!record) return null;
  if (!record.relatedWorkflows.includes(workflowId)) {
    record.relatedWorkflows.push(workflowId);
    record.notes.push({
      ts: new Date().toISOString(),
      kind: 'workflow',
      text: `linked workflow ${workflowId}`,
    });
    record.updatedAt = new Date().toISOString();
    await persist(record);
  }
  return record;
}

export async function recordApprovalRequest(
  id: string,
  approvalId: string,
  approver?: string,
): Promise<CaseRecord | null> {
  const tenantId = tenantOf();
  const record = await loadById(id, tenantId);
  if (!record) return null;
  record.pendingApprovals.push({
    approvalId,
    requestedAt: new Date().toISOString(),
    approver,
    decision: 'pending',
  });
  record.notes.push({
    ts: new Date().toISOString(),
    kind: 'approval',
    text: `approval ${approvalId} requested${approver ? ` from ${approver}` : ''}`,
  });
  record.updatedAt = new Date().toISOString();
  await persist(record);
  return record;
}

export async function recordApprovalDecision(
  id: string,
  approvalId: string,
  decision: 'approved' | 'denied',
  reason?: string,
): Promise<CaseRecord | null> {
  const tenantId = tenantOf();
  const record = await loadById(id, tenantId);
  if (!record) return null;
  const entry = record.pendingApprovals.find((a) => a.approvalId === approvalId);
  if (entry) {
    entry.decision = decision;
    entry.decidedAt = new Date().toISOString();
    entry.reason = reason;
  }
  record.notes.push({
    ts: new Date().toISOString(),
    kind: 'approval',
    text: `approval ${approvalId} ${decision}${reason ? `: ${reason}` : ''}`,
  });
  record.updatedAt = new Date().toISOString();
  await persist(record);
  return record;
}

export async function appendEnrichment(id: string, enrichment: Omit<CaseEnrichment, 'ts'>): Promise<CaseRecord | null> {
  const tenantId = tenantOf();
  const record = await loadById(id, tenantId);
  if (!record) return null;
  record.enrichments.push({ ts: new Date().toISOString(), ...enrichment });
  record.notes.push({
    ts: new Date().toISOString(),
    kind: 'enrichment',
    text: `enrichment from ${enrichment.source}: ${enrichment.summary}`,
  });
  record.updatedAt = new Date().toISOString();
  await persist(record);
  return record;
}

export async function close(id: string, reason: string): Promise<CaseRecord | null> {
  return setState(id, 'closed', reason);
}

export async function setNextReminder(id: string, atIso: string): Promise<CaseRecord | null> {
  const tenantId = tenantOf();
  const record = await loadById(id, tenantId);
  if (!record) return null;
  record.nextReminderAt = atIso;
  record.updatedAt = new Date().toISOString();
  await persist(record);
  return record;
}

// ── Query helpers ──

export async function listOpenCases(): Promise<CaseRecord[]> {
  if (cosmosReady && container) {
    try {
      const { resources } = await container.items
        .query<CaseRecord>({
          query: 'SELECT * FROM c WHERE c.state != "closed" AND c.tenantId = @t',
          parameters: [{ name: '@t', value: tenantOf() }],
        })
        .fetchAll();
      for (const r of resources) memCases.set(r.id, r);
      return resources;
    } catch (err) {
      console.warn('[CaseManager] listOpenCases query failed:', (err as Error).message);
    }
  }
  return Array.from(memCases.values()).filter((c) => c.state !== 'closed' && c.tenantId === tenantOf());
}

export async function findCaseBySubject(kind: string, sysId?: string): Promise<CaseRecord | null> {
  const all = await listOpenCases();
  return (
    all.find(
      (c) =>
        c.subjectRef.kind === kind &&
        (sysId ? c.subjectRef.sysId === sysId : false),
    ) || null
  );
}

export async function getCase(id: string): Promise<CaseRecord | null> {
  return loadById(id, tenantOf());
}

export async function listCasesDueForReminder(now: Date = new Date()): Promise<CaseRecord[]> {
  const open = await listOpenCases();
  const nowMs = now.getTime();
  const due = open.filter((c) => c.nextReminderAt && new Date(c.nextReminderAt).getTime() <= nowMs);
  caseKpi.remindersDue = due.length;
  return due;
}
