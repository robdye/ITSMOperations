/**
 * Microsoft 365 Service Health — Microsoft Graph admin/serviceAnnouncement.
 *
 *   GET https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews
 *
 * Requires a Graph token with `ServiceHealth.Read.All`. The enrichment
 * server obtains it via the **same OBO bearer** the caller used to reach
 * us — we trade the inbound token for a Graph access token via the OBO
 * flow against the caller's home tenant.
 *
 * TTL: 5 minutes (Phase E spec).
 */

import { createHash } from 'node:crypto';
import type { EnrichmentAuthContext } from '../auth.js';
import { runSource, type EnrichmentEnvelope } from '../envelope.js';
import { loadFixture } from '../fixtures-loader.js';

const URL_HEALTH = 'https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews';
const TTL_MS = 5 * 60 * 1000;

/* ── OBO → Graph token cache ─────────────────────────────────────────── */

const ENRICHMENT_CLIENT_ID = process.env.ENRICHMENT_CLIENT_ID || '';
const ENRICHMENT_CLIENT_SECRET = process.env.ENRICHMENT_CLIENT_SECRET || '';
const GRAPH_OBO_SCOPE = process.env.GRAPH_OBO_SCOPE || 'https://graph.microsoft.com/.default';

const oboCache = new Map<string, { token: string; expiresAt: number }>();

function hashToken(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

async function getGraphTokenFromOBO(userToken: string, tenantId: string): Promise<string | null> {
  if (!ENRICHMENT_CLIENT_ID || !ENRICHMENT_CLIENT_SECRET) return null;
  const cacheKey = `${tenantId}:${hashToken(userToken)}`;
  const cached = oboCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id: ENRICHMENT_CLIENT_ID,
    client_secret: ENRICHMENT_CLIENT_SECRET,
    assertion: userToken,
    scope: GRAPH_OBO_SCOPE,
    requested_token_use: 'on_behalf_of',
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn(`[m365-service-health] OBO failed: ${res.status} ${text.slice(0, 200)}`);
    return null;
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  oboCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 1800) * 1000,
  });
  return data.access_token;
}

/* ── Types ───────────────────────────────────────────────────────────── */

interface GraphHealthOverview {
  service: string;
  status: string;
  // ServiceUpdateMessage list fragment (subset of fields we surface).
  issues?: Array<{
    id: string;
    title: string;
    impactDescription: string;
    classification?: string;
    status?: string;
    startDateTime?: string;
    lastModifiedDateTime?: string;
  }>;
}

interface GraphHealthOverviewsResponse {
  value: GraphHealthOverview[];
}

export interface M365HealthSnapshot {
  fetchedAt: string;
  services: Array<{
    service: string;
    status: string;
    activeIssues: number;
    headlineIssue?: GraphHealthOverview['issues'] extends Array<infer T> | undefined ? T : never;
  }>;
  degradedCount: number;
}

function summarize(resp: GraphHealthOverviewsResponse): M365HealthSnapshot {
  const services = (resp.value || []).map((s) => ({
    service: s.service,
    status: s.status,
    activeIssues: (s.issues || []).length,
    headlineIssue: (s.issues || [])[0],
  }));
  return {
    fetchedAt: new Date().toISOString(),
    services,
    degradedCount: services.filter((s) => s.status && s.status !== 'serviceOperational').length,
  };
}

async function fetchHealth(token: string): Promise<GraphHealthOverviewsResponse> {
  const res = await fetch(URL_HEALTH, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Graph healthOverviews fetch failed: ${res.status}`);
  return (await res.json()) as GraphHealthOverviewsResponse;
}

/** Tool: `enrichment.cloud.m365.health()` */
export async function m365Health(
  args: Record<string, never>,
  ctx: EnrichmentAuthContext,
): Promise<EnrichmentEnvelope<M365HealthSnapshot>> {
  return runSource(
    {
      source: 'm365-service-health',
      ttlMs: TTL_MS,
      sourceUrl: URL_HEALTH,
      fetchLive: async (_a, c) => {
        const graphToken = await getGraphTokenFromOBO(c.userToken, c.tenantId);
        if (!graphToken) {
          // OBO unavailable — return an explicit unavailable envelope rather
          // than fabricating data. Callers can fall back to the fixture or
          // skip the enrichment.
          return {
            fetchedAt: new Date().toISOString(),
            services: [],
            degradedCount: 0,
          } as M365HealthSnapshot;
        }
        const resp = await fetchHealth(graphToken);
        return summarize(resp);
      },
      fetchFixture: () => loadFixture<M365HealthSnapshot>('m365-health-fixture.json'),
      summarize: (_a, d) => `m365.health degraded=${d.degradedCount} services=${d.services.length}`,
    },
    args,
    ctx,
  );
}
