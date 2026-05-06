/**
 * CISA Known Exploited Vulnerabilities (KEV) catalog.
 *
 * Public feed (no auth, no key required):
 *   https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
 *
 * TTL: 1 hour (Phase E spec). The feed is updated by CISA at most a few
 * times per day.
 */

import type { EnrichmentAuthContext } from '../auth.js';
import { runSource, type EnrichmentEnvelope } from '../envelope.js';
import { loadFixture } from '../fixtures-loader.js';

export interface KevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse?: string;
  notes?: string;
  cwes?: string[];
}

interface KevCatalog {
  title: string;
  catalogVersion: string;
  dateReleased: string;
  count: number;
  vulnerabilities: KevEntry[];
}

const URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const TTL_MS = 60 * 60 * 1000; // 1h

async function fetchKevCatalog(): Promise<KevCatalog> {
  const res = await fetch(URL, {
    headers: { Accept: 'application/json', 'User-Agent': 'itsm-ops-enrichment/1.0' },
  });
  if (!res.ok) throw new Error(`CISA KEV fetch failed: ${res.status}`);
  return (await res.json()) as KevCatalog;
}

/** Tool: `enrichment.kev.lookup(productOrVendor)` — match KEV entries by substring. */
export async function lookupKev(
  args: { productOrVendor: string },
  ctx: EnrichmentAuthContext,
): Promise<EnrichmentEnvelope<{ matches: KevEntry[]; needle: string }>> {
  return runSource(
    {
      source: 'cisa-kev',
      ttlMs: TTL_MS,
      sourceUrl: URL,
      fetchLive: async (a) => {
        const catalog = await fetchKevCatalog();
        return filter(catalog, a.productOrVendor);
      },
      fetchFixture: (a) => filter(loadFixture<KevCatalog>('kev-fixture.json'), a.productOrVendor),
      summarize: (_a, d) =>
        `kev.lookup matches=${d.matches.length}${d.matches[0] ? ` first=${d.matches[0].cveID}` : ''}`,
    },
    args,
    ctx,
  );
}

/** Tool: `enrichment.kev.recent(hours)` — KEV entries added within the window. */
export async function recentKev(
  args: { hours: number },
  ctx: EnrichmentAuthContext,
): Promise<EnrichmentEnvelope<{ since: string; entries: KevEntry[] }>> {
  return runSource(
    {
      source: 'cisa-kev',
      ttlMs: TTL_MS,
      sourceUrl: URL,
      fetchLive: async (a) => recent(await fetchKevCatalog(), a.hours),
      fetchFixture: (a) => recent(loadFixture<KevCatalog>('kev-fixture.json'), a.hours),
      summarize: (a, d) => `kev.recent hours=${a.hours} entries=${d.entries.length}`,
    },
    args,
    ctx,
  );
}

function filter(catalog: KevCatalog, productOrVendor: string): { matches: KevEntry[]; needle: string } {
  const needle = productOrVendor.trim().toLowerCase();
  if (!needle) return { matches: [], needle };
  const matches = (catalog.vulnerabilities || []).filter((v) => {
    const haystack = `${v.vendorProject} ${v.product} ${v.vulnerabilityName}`.toLowerCase();
    return haystack.includes(needle);
  });
  return { matches: matches.slice(0, 50), needle };
}

function recent(catalog: KevCatalog, hours: number): { since: string; entries: KevEntry[] } {
  // Cap at 5 years to keep the result bounded for large window queries.
  const safeHours = Math.max(1, Math.min(hours, 24 * 365 * 5));
  const cutoff = Date.now() - safeHours * 60 * 60 * 1000;
  const entries = (catalog.vulnerabilities || [])
    .filter((v) => {
      const t = Date.parse(v.dateAdded);
      return Number.isFinite(t) && t >= cutoff;
    })
    .slice(0, 100);
  return { since: new Date(cutoff).toISOString(), entries };
}
