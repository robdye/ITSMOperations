/**
 * Microsoft Security Response Center (MSRC) — monthly CVRF document.
 *
 * Public API (no auth):
 *   https://api.msrc.microsoft.com/cvrf/v3.0/cvrf/{yearMonth}
 *
 * `yearMonth` is the Patch-Tuesday id, e.g. `2024-Oct`.
 *
 * TTL: 24 hours.
 */

import type { EnrichmentAuthContext } from '../auth.js';
import { runSource, type EnrichmentEnvelope } from '../envelope.js';
import { loadFixture } from '../fixtures-loader.js';

const BASE = 'https://api.msrc.microsoft.com/cvrf/v3.0/cvrf';
const TTL_MS = 24 * 60 * 60 * 1000;

interface MsrcVulnerability {
  CVE: string;
  Title?: { Value?: string };
  Threats?: Array<{ Description?: { Value?: string }; Type?: number }>;
  CVSSScoreSets?: Array<{ BaseScore?: number; Vector?: string }>;
  ProductStatuses?: Array<{ ProductID?: string[] }>;
  Notes?: Array<{ Title?: string; Value?: string }>;
}

interface MsrcCvrfDocument {
  DocumentTitle?: { Value?: string };
  DocumentTracking?: {
    Identification?: { ID?: { Value?: string } };
    InitialReleaseDate?: string;
  };
  Vulnerability?: MsrcVulnerability[];
}

export interface MsrcAdvisory {
  cveId: string;
  title: string;
  threat: string;
  baseScore?: number;
  vector?: string;
  severity?: 'Critical' | 'Important' | 'Moderate' | 'Low' | 'Unknown';
  yearMonth: string;
  url: string;
}

function classifySeverity(score?: number): MsrcAdvisory['severity'] {
  if (score === undefined) return 'Unknown';
  if (score >= 9.0) return 'Critical';
  if (score >= 7.0) return 'Important';
  if (score >= 4.0) return 'Moderate';
  return 'Low';
}

function summarize(doc: MsrcCvrfDocument, yearMonth: string): MsrcAdvisory[] {
  return (doc.Vulnerability || []).map((v) => {
    const score = v.CVSSScoreSets?.[0]?.BaseScore;
    const threatNote = (v.Threats || []).find((t) => t.Description?.Value)?.Description?.Value || '';
    return {
      cveId: v.CVE,
      title: v.Title?.Value || v.CVE,
      threat: threatNote.slice(0, 500),
      baseScore: score,
      vector: v.CVSSScoreSets?.[0]?.Vector,
      severity: classifySeverity(score),
      yearMonth,
      url: `https://msrc.microsoft.com/update-guide/vulnerability/${v.CVE}`,
    };
  });
}

async function fetchMsrc(yearMonth: string): Promise<MsrcCvrfDocument> {
  const url = `${BASE}/${encodeURIComponent(yearMonth)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'itsm-ops-enrichment/1.0' },
  });
  if (!res.ok) throw new Error(`MSRC fetch failed for ${yearMonth}: ${res.status}`);
  return (await res.json()) as MsrcCvrfDocument;
}

/** Tool: `enrichment.msrc.monthly(yearMonth)` */
export async function msrcMonthly(
  args: { yearMonth: string },
  ctx: EnrichmentAuthContext,
): Promise<EnrichmentEnvelope<{ yearMonth: string; advisories: MsrcAdvisory[]; criticalCount: number }>> {
  return runSource(
    {
      source: 'msrc',
      ttlMs: TTL_MS,
      sourceUrl: BASE,
      fetchLive: async (a) => {
        const doc = await fetchMsrc(a.yearMonth);
        const advisories = summarize(doc, a.yearMonth);
        return {
          yearMonth: a.yearMonth,
          advisories,
          criticalCount: advisories.filter((x) => x.severity === 'Critical').length,
        };
      },
      fetchFixture: (a) => {
        const doc = loadFixture<MsrcCvrfDocument>('msrc-fixture.json');
        const advisories = summarize(doc, a.yearMonth);
        return {
          yearMonth: a.yearMonth,
          advisories,
          criticalCount: advisories.filter((x) => x.severity === 'Critical').length,
        };
      },
      summarize: (a, d) => `msrc.monthly ${a.yearMonth} advisories=${d.advisories.length} critical=${d.criticalCount}`,
    },
    args,
    ctx,
  );
}
