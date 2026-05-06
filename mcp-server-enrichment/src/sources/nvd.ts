/**
 * NIST National Vulnerability Database (NVD) — CVE detail.
 *
 * Public API (optional API key for higher rate limits):
 *   https://services.nvd.nist.gov/rest/json/cves/2.0
 *
 * Rate limits per the spec:
 *   - With API key: 50 req / 30 s
 *   - Without:       5 req / 30 s
 *
 * TTL: 6 hours.
 */

import type { EnrichmentAuthContext } from '../auth.js';
import { runSource, type EnrichmentEnvelope } from '../envelope.js';
import { loadFixture } from '../fixtures-loader.js';

const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const TTL_MS = 6 * 60 * 60 * 1000;

const API_KEY = process.env.NVD_API_KEY || '';
const RATE_WINDOW_MS = 30_000;
const RATE_MAX = API_KEY ? 50 : 5;

const callTimestamps: number[] = [];

async function rateLimit(): Promise<void> {
  const now = Date.now();
  while (callTimestamps.length && callTimestamps[0] < now - RATE_WINDOW_MS) {
    callTimestamps.shift();
  }
  if (callTimestamps.length >= RATE_MAX) {
    const wait = RATE_WINDOW_MS - (now - callTimestamps[0]) + 50;
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
  }
  callTimestamps.push(Date.now());
}

interface NvdResponse {
  resultsPerPage: number;
  totalResults: number;
  vulnerabilities: Array<{
    cve: {
      id: string;
      published: string;
      lastModified: string;
      vulnStatus?: string;
      descriptions: Array<{ lang: string; value: string }>;
      metrics?: {
        cvssMetricV31?: Array<{
          source: string;
          type: string;
          cvssData: {
            version: string;
            vectorString: string;
            baseScore: number;
            baseSeverity: string;
          };
          exploitabilityScore?: number;
          impactScore?: number;
        }>;
      };
      references?: Array<{ url: string; source?: string }>;
      configurations?: unknown;
    };
  }>;
}

export interface CveSummary {
  cveId: string;
  published: string;
  lastModified: string;
  status?: string;
  description: string;
  cvss?: {
    version: string;
    vector: string;
    baseScore: number;
    severity: string;
  };
  references: string[];
}

async function fetchNvd(query: Record<string, string>): Promise<NvdResponse> {
  await rateLimit();
  const url = new URL(NVD_BASE);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'itsm-ops-enrichment/1.0',
  };
  if (API_KEY) headers['apiKey'] = API_KEY;

  const res = await fetch(url, { headers });
  if (res.status === 429) {
    // Backoff once and retry.
    await new Promise((r) => setTimeout(r, 6_000));
    const retry = await fetch(url, { headers });
    if (!retry.ok) throw new Error(`NVD fetch failed after retry: ${retry.status}`);
    return (await retry.json()) as NvdResponse;
  }
  if (!res.ok) throw new Error(`NVD fetch failed: ${res.status}`);
  return (await res.json()) as NvdResponse;
}

function summarize(resp: NvdResponse): CveSummary[] {
  return (resp.vulnerabilities || []).map((v) => {
    const cve = v.cve;
    const desc = cve.descriptions?.find((d) => d.lang === 'en')?.value || '';
    const cvss31 = cve.metrics?.cvssMetricV31?.[0]?.cvssData;
    return {
      cveId: cve.id,
      published: cve.published,
      lastModified: cve.lastModified,
      status: cve.vulnStatus,
      description: desc,
      cvss: cvss31
        ? {
            version: cvss31.version,
            vector: cvss31.vectorString,
            baseScore: cvss31.baseScore,
            severity: cvss31.baseSeverity,
          }
        : undefined,
      references: (cve.references || []).map((r) => r.url).slice(0, 20),
    };
  });
}

/** Tool: `enrichment.cve.detail(cveId)` */
export async function cveDetail(
  args: { cveId: string },
  ctx: EnrichmentAuthContext,
): Promise<EnrichmentEnvelope<{ cve: CveSummary | null }>> {
  return runSource(
    {
      source: 'nvd',
      ttlMs: TTL_MS,
      sourceUrl: NVD_BASE,
      fetchLive: async (a) => {
        const resp = await fetchNvd({ cveId: a.cveId });
        const list = summarize(resp);
        return { cve: list[0] || null };
      },
      fetchFixture: (a) => {
        const fx = loadFixture<NvdResponse>('nvd-fixture.json');
        const list = summarize(fx).filter((c) => c.cveId.toUpperCase() === a.cveId.toUpperCase());
        return { cve: list[0] || null };
      },
      summarize: (a, d) =>
        d.cve ? `cve.detail ${a.cveId} cvss=${d.cve.cvss?.baseScore ?? 'n/a'}` : `cve.detail ${a.cveId} not-found`,
    },
    args,
    ctx,
  );
}

/** Tool: `enrichment.cve.byProduct(cpeOrProduct)` — keyword/cpe search. */
export async function cveByProduct(
  args: { cpeOrProduct: string },
  ctx: EnrichmentAuthContext,
): Promise<EnrichmentEnvelope<{ matches: CveSummary[]; needle: string }>> {
  return runSource(
    {
      source: 'nvd',
      ttlMs: TTL_MS,
      sourceUrl: NVD_BASE,
      fetchLive: async (a) => {
        const isCpe = a.cpeOrProduct.toLowerCase().startsWith('cpe:');
        const resp = await fetchNvd(
          isCpe ? { cpeName: a.cpeOrProduct } : { keywordSearch: a.cpeOrProduct, resultsPerPage: '20' },
        );
        return { matches: summarize(resp).slice(0, 20), needle: a.cpeOrProduct };
      },
      fetchFixture: (a) => {
        const fx = loadFixture<NvdResponse>('nvd-fixture.json');
        const lower = a.cpeOrProduct.toLowerCase();
        const matches = summarize(fx).filter((c) => c.description.toLowerCase().includes(lower));
        return { matches, needle: a.cpeOrProduct };
      },
      summarize: (a, d) => `cve.byProduct ${a.cpeOrProduct} matches=${d.matches.length}`,
    },
    args,
    ctx,
  );
}
