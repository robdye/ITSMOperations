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

const RAW_INSTANCE_URL = process.env.SNOW_INSTANCE_URL || '';
const SNOW_INSTANCE_URL = RAW_INSTANCE_URL.replace(/\/+$/, '');
const SNOW_AUTH_HEADER = process.env.SNOW_AUTH_HEADER || '';
const SNOW_REASONING_BASE_URL = process.env.SNOW_REASONING_BASE_URL || '';

const DEMO_RUN_FIELD = 'u_demo_run';

export interface SnowClientStatus {
  enabled: boolean;
  instance: string;
  authMode: 'basic' | 'oauth' | 'unconfigured';
  missing: string[];
}

export function getSnowClientStatus(): SnowClientStatus {
  const missing: string[] = [];
  if (!SNOW_INSTANCE_URL) missing.push('SNOW_INSTANCE_URL');
  if (!SNOW_AUTH_HEADER) missing.push('SNOW_AUTH_HEADER');
  return {
    enabled: missing.length === 0,
    instance: SNOW_INSTANCE_URL || 'not-configured',
    authMode: SNOW_AUTH_HEADER.startsWith('Bearer ')
      ? 'oauth'
      : SNOW_AUTH_HEADER
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
  /** Demo-run id when the write originates from the demo-director. */
  demoRunId?: string;
}

export interface WorkNoteResult {
  ok: boolean;
  status: number;
  body?: unknown;
  error?: string;
}

interface SnowRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  path: string;
  body?: unknown;
  /** Demo-run id; injected as `u_demo_run` on writes when present. */
  demoRunId?: string;
}

/**
 * Internal: low-level REST call. Returns the HTTP status and parsed body
 * (or text fallback). All writes are no-ops when SNOW is not configured.
 */
async function snowRequest({
  method,
  path,
  body,
  demoRunId,
}: SnowRequestOptions): Promise<{ ok: boolean; status: number; body: unknown }> {
  const status = getSnowClientStatus();
  if (!status.enabled) {
    return { ok: false, status: 0, body: { reason: 'snow-not-configured' } };
  }

  const url = `${SNOW_INSTANCE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const finalBody =
    body && demoRunId && method !== 'GET'
      ? { ...(body as Record<string, unknown>), [DEMO_RUN_FIELD]: demoRunId }
      : body;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: SNOW_AUTH_HEADER,
  };
  if (finalBody !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: finalBody !== undefined ? JSON.stringify(finalBody) : undefined,
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

function buildReasoningLink(ctx: WriteContext): string {
  if (!ctx.reasoningTraceId) {
    return `correlation:${ctx.correlationId}`;
  }
  if (SNOW_REASONING_BASE_URL) {
    return `${SNOW_REASONING_BASE_URL.replace(/\/+$/, '')}/trace/${ctx.reasoningTraceId}`;
  }
  return `trace:${ctx.reasoningTraceId} (correlation:${ctx.correlationId})`;
}

function buildWorkNote(text: string, ctx: WriteContext): string {
  const link = buildReasoningLink(ctx);
  const tag = ctx.demoRunId ? `[demo:run:${ctx.demoRunId}] ` : '';
  return `${tag}${text}\n— Alex (correlationId=${ctx.correlationId}, reasoning=${link})`;
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

// ── Public surface ──

export async function getIncident(sysId: string): Promise<{ ok: boolean; record?: Record<string, unknown> }> {
  const res = await snowRequest({ method: 'GET', path: `/api/now/table/incident/${encodeURIComponent(sysId)}` });
  const record = (res.body as { result?: Record<string, unknown> } | null)?.result;
  return { ok: res.ok, record };
}

export async function addWorkNote(
  table: 'incident' | 'change_request' | 'problem',
  sysId: string,
  text: string,
  ctx: WriteContext,
): Promise<WorkNoteResult> {
  const note = buildWorkNote(text, ctx);
  const res = await snowRequest({
    method: 'PATCH',
    path: `/api/now/table/${table}/${encodeURIComponent(sysId)}`,
    body: { work_notes: note },
    demoRunId: ctx.demoRunId,
  });
  await audit('snow.addWorkNote', { table, sysId, length: text.length }, res.ok, ctx);
  return { ok: res.ok, status: res.status, body: res.body };
}

export async function linkAsChild(
  childSysId: string,
  parentSysId: string,
  ctx: WriteContext,
): Promise<WorkNoteResult> {
  const res = await snowRequest({
    method: 'PATCH',
    path: `/api/now/table/incident/${encodeURIComponent(childSysId)}`,
    body: { parent_incident: parentSysId },
    demoRunId: ctx.demoRunId,
  });
  await audit('snow.linkAsChild', { childSysId, parentSysId }, res.ok, ctx);
  return { ok: res.ok, status: res.status, body: res.body };
}

export async function updateIncidentState(
  sysId: string,
  state: 'in_progress' | 'on_hold' | 'resolved' | 'closed',
  ctx: WriteContext,
): Promise<WorkNoteResult> {
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
    demoRunId: ctx.demoRunId,
  });
  await audit('snow.updateIncidentState', { sysId, state }, res.ok, ctx);
  return { ok: res.ok, status: res.status, body: res.body };
}

export async function createMajorIncident(
  shortDescription: string,
  ctx: WriteContext,
  extra: Record<string, unknown> = {},
): Promise<{ ok: boolean; sysId?: string; number?: string; status: number }> {
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
    demoRunId: ctx.demoRunId,
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
  const res = await snowRequest({
    method: 'PATCH',
    path: `/api/now/table/${table}/${encodeURIComponent(sysId)}`,
    body: { kb_knowledge: kbSysId },
    demoRunId: ctx.demoRunId,
  });
  await audit('snow.attachKBArticle', { table, sysId, kbSysId }, res.ok, ctx);
  return { ok: res.ok, status: res.status, body: res.body };
}

/** Test-only: lets unit tests inspect the work-note formatting helper. */
export const _internal = { buildWorkNote, buildReasoningLink };
