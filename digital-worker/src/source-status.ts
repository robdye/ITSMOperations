import { getSnowClientStatus, probeSnowTable } from './snow-client';

type SourceMode =
  | 'live-servicenow'
  | 'synthetic-servicenow'
  | 'scenario-injected'
  | 'cached'
  | 'auth-failed'
  | 'mcp-unavailable';

interface ProbeResult {
  status: 'ok' | 'unavailable' | 'auth-failed';
  endpoint: string;
  lastChecked: string;
  httpStatus?: number;
  error?: string;
}

let cachedStatus: { expiresAt: number; value: Awaited<ReturnType<typeof buildSourceStatusInternal>> } | undefined;
const SOURCE_STATUS_CACHE_MS = 60000;

function redactUrl(value: string): string {
  if (!value) return 'not-configured';
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.pathname}`;
  } catch {
    return 'configured';
  }
}

function getMcpEndpoint(): string {
  return process.env.MCP_CHANGE_ENDPOINT || process.env.CHANGE_MCP_ENDPOINT || '';
}

function endpointToHealthUrl(endpoint: string): string {
  if (!endpoint) return '';
  const url = new URL(endpoint);
  url.pathname = '/health';
  url.search = '';
  return url.toString();
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probeMcp(): Promise<ProbeResult> {
  const endpoint = getMcpEndpoint();
  const lastChecked = new Date().toISOString();
  if (!endpoint) {
    return { status: 'unavailable', endpoint: 'not-configured', lastChecked, error: 'MCP endpoint is not configured' };
  }

  try {
    const healthUrl = endpointToHealthUrl(endpoint);
    const res = await fetchWithTimeout(healthUrl, { headers: { Accept: 'application/json, text/event-stream' } }, 5000);
    if (res.status === 401 || res.status === 403) {
      return { status: 'auth-failed', endpoint: redactUrl(endpoint), lastChecked, httpStatus: res.status };
    }
    return {
      status: res.ok ? 'ok' : 'unavailable',
      endpoint: redactUrl(endpoint),
      lastChecked,
      httpStatus: res.status,
      error: res.ok ? undefined : `MCP health returned ${res.status}`,
    };
  } catch (err) {
    return {
      status: 'unavailable',
      endpoint: redactUrl(endpoint),
      lastChecked,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function authMechanism(authHeader: string | undefined): 'obo' | 'jwt' | 'easyauth' | 'dev' | 'unknown' {
  if (process.env.NODE_ENV === 'development') return 'dev';
  if (authHeader?.startsWith('Bearer ')) return 'jwt';
  if (process.env.WEBSITE_AUTH_ENABLED === 'true') return 'easyauth';
  return 'unknown';
}

async function buildSourceStatusInternal(authHeader?: string) {
  const warnings: string[] = [];
  const [mcp, incidentProbe, changeProbe] = await Promise.all([
    probeMcp(),
    probeSnowTable('incident'),
    probeSnowTable('change_request'),
  ]);

  const snow = getSnowClientStatus();
  const serviceNowStatus =
    !snow.enabled
      ? 'not-configured'
      : incidentProbe.status === 401 || incidentProbe.status === 403 || changeProbe.status === 401 || changeProbe.status === 403
        ? 'auth-failed'
        : incidentProbe.ok || changeProbe.ok
          ? 'ok'
          : 'unavailable';

  if (!snow.enabled) warnings.push(`ServiceNow configuration missing: ${snow.missing.join(', ')}`);
  if (mcp.status !== 'ok') warnings.push(`MCP is ${mcp.status}`);
  if (serviceNowStatus !== 'ok') warnings.push(`ServiceNow read probe is ${serviceNowStatus}`);

  const sourceMode: SourceMode =
    mcp.status === 'auth-failed' || serviceNowStatus === 'auth-failed'
      ? 'auth-failed'
      : mcp.status !== 'ok'
        ? 'mcp-unavailable'
        : serviceNowStatus === 'ok'
          ? 'live-servicenow'
          : 'cached';

  return {
    worker: {
      status: 'healthy',
      buildSha: process.env.GIT_COMMIT_SHA || 'dev',
      authenticated: Boolean(authHeader) || process.env.NODE_ENV === 'development',
    },
    missionControl: {
      authenticated: Boolean(authHeader) || process.env.NODE_ENV === 'development',
      authMechanism: authMechanism(authHeader),
    },
    mcp,
    serviceNow: {
      status: serviceNowStatus,
      instance: redactUrl(snow.instance),
      authMode: snow.authMode,
      lastIncidentRead: incidentProbe.ok ? incidentProbe.checkedAt : null,
      lastChangeRead: changeProbe.ok ? changeProbe.checkedAt : null,
      incidentReadStatus: incidentProbe.status,
      changeReadStatus: changeProbe.status,
    },
    sourceMode,
    fallbackActive: sourceMode !== 'live-servicenow',
    warnings,
  };
}

export async function buildSourceStatus(authHeader?: string) {
  const now = Date.now();
  if (cachedStatus && cachedStatus.expiresAt > now) {
    return cachedStatus.value;
  }
  const value = await buildSourceStatusInternal(authHeader);
  cachedStatus = { expiresAt: now + SOURCE_STATUS_CACHE_MS, value };
  return value;
}
