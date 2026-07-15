// ITSM Operations — ServiceNow client (system-facing surface)
// Direct-REST methods used by workflows for system-level writes outside the
// agent loop (worknotes, parent linkage, state changes, KB attachment).
//
// Agent-facing tools continue to live in mcp-server/src/snow-client.ts and are
// reached via the MCP client. This file only handles the writes a workflow
// performs once the agent has decided what to do.
//
// All writes are tagged with Alex's correlation id and a reasoning-trace
// deep link so every change is auditable back to its decision.

import { logAuditEntry } from './audit-trail';

// ── Config ──

function getSnowInstanceUrl(): string {
  return (process.env.SNOW_INSTANCE_URL || process.env.SNOW_INSTANCE || '').replace(/\/+$/, '');
}

function getSnowAuthHeader(): string {
  return process.env.SNOW_AUTH_HEADER || '';
}

export interface SnowClientStatus {
  enabled: boolean;
  instance: string;
  authMode: 'basic' | 'oauth' | 'unconfigured';
  missing: string[];
}

export function getSnowClientStatus(): SnowClientStatus {
  const missing: string[] = [];
  const instance = getSnowInstanceUrl();
  const authHeader = getSnowAuthHeader();
  if (!instance) missing.push('SNOW_INSTANCE or SNOW_INSTANCE_URL');
  if (!authHeader) missing.push('SNOW_AUTH_HEADER');
  return {
    enabled: missing.length === 0,
    instance: instance || 'not-configured',
    authMode: authHeader.startsWith('Bearer ')
      ? 'oauth'
      : authHeader
        ? 'basic'
        : 'unconfigured',
    missing,
  };
}

export interface WriteContext {
  /** Stable correlation id propagated through the workflow. */
  correlationId: string;
  /** The signal id (or trace id) this write is causally linked to. */
  reasoningTraceId?: string;
  /**
   * Phase 2.1 — when true, every write short-circuits with a planning
   * summary instead of touching SNOW. Threaded from the workflow
   * trigger when `evaluateTrigger().mode === 'dry-run'`.
   */
  dryRun?: boolean;
}

export interface WorkNoteResult {
  ok: boolean;
  status: number;
  body?: unknown;
  error?: string;
}

export interface SnowReadProbeResult {
  ok: boolean;
  status: number;
  table: 'incident' | 'change_request';
  checkedAt: string;
  error?: string;
}

interface SnowRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  path: string;
  body?: unknown;
}

/**
 * Internal: low-level REST call. Returns the HTTP status and parsed body
 * (or text fallback). All writes are no-ops when SNOW is not configured.
 */
async function snowRequest({
  method,
  path,
  body,
}: SnowRequestOptions): Promise<{ ok: boolean; status: number; body: unknown }> {
  const status = getSnowClientStatus();
  if (!status.enabled) {
    return { ok: false, status: 0, body: { reason: 'snow-not-configured' } };
  }

  const url = `${getSnowInstanceUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: getSnowAuthHeader(),
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let parsed: unknown;
  const text = await res.text();
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return { ok: res.ok, status: res.status, body: parsed };
}

export async function probeSnowTable(table: 'incident' | 'change_request'): Promise<SnowReadProbeResult> {
  const checkedAt = new Date().toISOString();
  try {
    const result = await snowRequest({
      method: 'GET',
      path: `/api/now/table/${table}?sysparm_limit=1&sysparm_fields=sys_id,number,sys_updated_on`,
    });
    return {
      ok: result.ok,
      status: result.status,
      table,
      checkedAt,
      error: result.ok ? undefined : `ServiceNow ${table} read returned ${result.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      table,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function buildReasoningLink(ctx: WriteContext): string {
  if (!ctx.reasoningTraceId) {
    return `correlation:${ctx.correlationId}`;
  }
  const reasoningBaseUrl = process.env.SNOW_REASONING_BASE_URL || '';
  if (reasoningBaseUrl) {
    return `${reasoningBaseUrl.replace(/\/+$/, '')}/trace/${ctx.reasoningTraceId}`;
  }
  return `trace:${ctx.reasoningTraceId} (correlation:${ctx.correlationId})`;
}

function buildWorkNote(text: string, ctx: WriteContext): string {
  const link = buildReasoningLink(ctx);
  return `${text}\n— Alex (correlationId=${ctx.correlationId}, reasoning=${link})`;
}

async function audit(toolName: string, params: unknown, ok: boolean, ctx: WriteContext): Promise<void> {
  await logAuditEntry({
    workerId: 'snow-client',
    workerName: 'ServiceNow client',
    toolName,
    riskLevel: 'write',
    triggeredBy: ctx.correlationId,
    triggerType: 'delegation',
    parameters: JSON.stringify(params),
    resultSummary: ok ? 'ok' : 'failed',
    requiredConfirmation: false,
    durationMs: 0,
  }).catch(() => {});
}

/**
 * Phase 2.1 — uniform dry-run short-circuit for every write helper.
 * Returns a synthetic 'ok' WorkNoteResult plus an audit row tagged with
 * `triggerType:'delegation'` and a `dry-run:` prefix so the operator
 * can grep for what *would* have happened.
 */
async function dryRunShortCircuit(
  toolName: string,
  params: unknown,
  ctx: WriteContext,
): Promise<{ ok: true; status: 200; body: { reason: 'dry-run'; toolName: string; params: unknown } }> {
  await logAuditEntry({
    workerId: 'snow-client',
    workerName: 'ServiceNow client',
    toolName: `dry-run:${toolName}`,
    riskLevel: 'write',
    triggeredBy: ctx.correlationId,
    triggerType: 'delegation',
    parameters: JSON.stringify(params),
    resultSummary: 'dry-run (no SNOW write)',
    requiredConfirmation: false,
    durationMs: 0,
  }).catch(() => {});
  return {
    ok: true,
    status: 200,
    body: { reason: 'dry-run', toolName, params },
  };
}

// ── Public surface ──

export async function getIncident(sysId: string): Promise<{ ok: boolean; record?: Record<string, unknown> }> {
  const res = await snowRequest({ method: 'GET', path: `/api/now/table/incident/${encodeURIComponent(sysId)}` });
  const record = (res.body as { result?: Record<string, unknown> } | null)?.result;
  return { ok: res.ok, record };
}

export async function getIncidentByNumber(number: string): Promise<{ ok: boolean; record?: Record<string, unknown> }> {
  const query = new URLSearchParams({
    sysparm_query: `number=${number}`,
    sysparm_limit: '1',
    sysparm_fields: 'sys_id,number,state,short_description',
  });
  const res = await snowRequest({ method: 'GET', path: `/api/now/table/incident?${query.toString()}` });
  const records = (res.body as { result?: Record<string, unknown>[] } | null)?.result || [];
  return { ok: res.ok, record: records[0] };
}

export async function addWorkNote(
  table: 'incident' | 'change_request' | 'problem',
  sysId: string,
  text: string,
  ctx: WriteContext,
): Promise<WorkNoteResult> {
  if (ctx.dryRun) return dryRunShortCircuit('snow.addWorkNote', { table, sysId, length: text.length }, ctx);
  const note = buildWorkNote(text, ctx);
  const res = await snowRequest({
    method: 'PATCH',
    path: `/api/now/table/${table}/${encodeURIComponent(sysId)}`,
    body: { work_notes: note },
  });
  await audit('snow.addWorkNote', { table, sysId, length: text.length }, res.ok, ctx);
  return { ok: res.ok, status: res.status, body: res.body };
}

export async function linkAsChild(
  childSysId: string,
  parentSysId: string,
  ctx: WriteContext,
): Promise<WorkNoteResult> {
  if (ctx.dryRun) return dryRunShortCircuit('snow.linkAsChild', { childSysId, parentSysId }, ctx);
  const res = await snowRequest({
    method: 'PATCH',
    path: `/api/now/table/incident/${encodeURIComponent(childSysId)}`,
    body: { parent_incident: parentSysId },
  });
  await audit('snow.linkAsChild', { childSysId, parentSysId }, res.ok, ctx);
  return { ok: res.ok, status: res.status, body: res.body };
}

export async function updateIncidentState(
  sysId: string,
  state: 'in_progress' | 'on_hold' | 'resolved' | 'closed',
  ctx: WriteContext,
): Promise<WorkNoteResult> {
  if (ctx.dryRun) return dryRunShortCircuit('snow.updateIncidentState', { sysId, state }, ctx);
  // ServiceNow-state numeric codes for the OOTB incident table.
  const stateMap: Record<string, string> = {
    in_progress: '2',
    on_hold: '3',
    resolved: '6',
    closed: '7',
  };
  const res = await snowRequest({
    method: 'PATCH',
    path: `/api/now/table/incident/${encodeURIComponent(sysId)}`,
    body: { state: stateMap[state] },
  });
  await audit('snow.updateIncidentState', { sysId, state }, res.ok, ctx);
  return { ok: res.ok, status: res.status, body: res.body };
}

export async function createMajorIncident(
  shortDescription: string,
  ctx: WriteContext,
  extra: Record<string, unknown> = {},
): Promise<{ ok: boolean; sysId?: string; number?: string; status: number }> {
  if (ctx.dryRun) {
    await dryRunShortCircuit('snow.createMajorIncident', { shortDescription }, ctx);
    return { ok: true, status: 200, sysId: 'dry-run-sys-id', number: 'INC-DRYRUN' };
  }
  const res = await snowRequest({
    method: 'POST',
    path: '/api/now/table/incident',
    body: {
      short_description: shortDescription,
      priority: '1',
      severity: '1',
      impact: '1',
      urgency: '1',
      ...extra,
    },
  });
  const record = (res.body as { result?: Record<string, unknown> } | null)?.result;
  await audit('snow.createMajorIncident', { shortDescription }, res.ok, ctx);
  return {
    ok: res.ok,
    status: res.status,
    sysId: record?.sys_id as string | undefined,
    number: record?.number as string | undefined,
  };
}

export async function attachKBArticle(
  table: 'incident' | 'problem',
  sysId: string,
  kbSysId: string,
  ctx: WriteContext,
): Promise<WorkNoteResult> {
  if (ctx.dryRun) return dryRunShortCircuit('snow.attachKBArticle', { table, sysId, kbSysId }, ctx);
  const res = await snowRequest({
    method: 'PATCH',
    path: `/api/now/table/${table}/${encodeURIComponent(sysId)}`,
    body: { kb_knowledge: kbSysId },
  });
  await audit('snow.attachKBArticle', { table, sysId, kbSysId }, res.ok, ctx);
  return { ok: res.ok, status: res.status, body: res.body };
}

/** Test-only: lets unit tests inspect the work-note formatting helper. */
export const _internal = { buildWorkNote, buildReasoningLink };
