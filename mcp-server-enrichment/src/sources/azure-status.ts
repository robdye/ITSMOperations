/**
 * Azure Status — public RSS feed of incidents.
 *
 * Public feed (no auth):
 *   https://azurestatuscdn.azureedge.net/en-us/status/feed/
 *
 * TTL: 60 seconds (Phase E spec — outage signals must be near-real-time).
 *
 * The feed is RSS/Atom XML. We parse the entry list with a tiny regex-based
 * splitter to avoid pulling in `fast-xml-parser` for a single producer.
 */

import type { EnrichmentAuthContext } from '../auth.js';
import { runSource, type EnrichmentEnvelope } from '../envelope.js';
import { loadFixture } from '../fixtures-loader.js';

const URL = 'https://azurestatuscdn.azureedge.net/en-us/status/feed/';
const TTL_MS = 60 * 1000;

export interface AzureIncident {
  guid: string;
  title: string;
  pubDate: string;
  link: string;
  description: string;
  /** Lower-cased region tags extracted from the description. */
  regions: string[];
  /** Heuristic severity: 'investigating' | 'mitigating' | 'resolved' | 'unknown'. */
  status: string;
}

interface AzureStatusFeed {
  fetchedAt: string;
  incidents: AzureIncident[];
}

const REGION_HINTS = [
  'east us', 'eastus', 'east us 2', 'eastus2', 'west us', 'westus', 'west us 2', 'westus2',
  'west us 3', 'westus3', 'central us', 'centralus', 'south central us', 'southcentralus',
  'north central us', 'northcentralus', 'west europe', 'westeurope', 'north europe', 'northeurope',
  'uk south', 'uksouth', 'uk west', 'ukwest', 'france central', 'francecentral',
  'germany west central', 'germanywestcentral', 'switzerland north', 'switzerlandnorth',
  'sweden central', 'swedencentral', 'norway east', 'norwayeast',
  'east asia', 'eastasia', 'southeast asia', 'southeastasia', 'japan east', 'japaneast',
  'japan west', 'japanwest', 'australia east', 'australiaeast', 'australia southeast', 'australiasoutheast',
  'central india', 'centralindia', 'south india', 'southindia', 'brazil south', 'brazilsouth',
  'canada central', 'canadacentral', 'canada east', 'canadaeast',
  'us gov virginia', 'usgovvirginia', 'us gov arizona', 'usgovarizona',
];

function extractRegions(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const r of REGION_HINTS) if (lower.includes(r)) found.add(r);
  return [...found];
}

function classifyStatus(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('resolved') || lower.includes('mitigated and resolved')) return 'resolved';
  if (lower.includes('mitigating')) return 'mitigating';
  if (lower.includes('investigating') || lower.includes('reviewing')) return 'investigating';
  return 'unknown';
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/<!\[CDATA\[/g, '')
    .replace(/]]>/g, '');
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseFeedXml(xml: string): AzureStatusFeed {
  const items: AzureIncident[] = [];
  const itemRegex = /<item[\s\S]*?<\/item>/g;
  const matches = xml.match(itemRegex) || [];
  for (const item of matches) {
    const get = (tag: string) => {
      const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(item);
      return m ? decodeXmlEntities(m[1]).trim() : '';
    };
    const title = stripTags(get('title'));
    const guid = stripTags(get('guid')) || `${title}-${get('pubDate')}`;
    const pubDate = get('pubDate');
    const link = stripTags(get('link'));
    const description = stripTags(get('description'));
    items.push({
      guid,
      title,
      pubDate,
      link,
      description: description.slice(0, 1_500),
      regions: extractRegions(`${title} ${description}`),
      status: classifyStatus(`${title} ${description}`),
    });
  }
  return { fetchedAt: new Date().toISOString(), incidents: items.slice(0, 50) };
}

async function fetchFeed(): Promise<AzureStatusFeed> {
  const res = await fetch(URL, {
    headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'itsm-ops-enrichment/1.0' },
  });
  if (!res.ok) throw new Error(`Azure Status fetch failed: ${res.status}`);
  const xml = await res.text();
  return parseFeedXml(xml);
}

/** Tool: `enrichment.cloud.azure.status(region?)` */
export async function azureStatus(
  args: { region?: string },
  ctx: EnrichmentAuthContext,
): Promise<EnrichmentEnvelope<{ region: string | null; incidents: AzureIncident[]; degraded: boolean }>> {
  return runSource(
    {
      source: 'azure-status',
      ttlMs: TTL_MS,
      sourceUrl: URL,
      fetchLive: async (a) => {
        const feed = await fetchFeed();
        return filterByRegion(feed, a.region);
      },
      fetchFixture: (a) => {
        const feed = loadFixture<AzureStatusFeed>('azure-status-fixture.json');
        return filterByRegion(feed, a.region);
      },
      summarize: (a, d) =>
        `azure.status region=${a.region ?? 'global'} incidents=${d.incidents.length} degraded=${d.degraded}`,
    },
    args,
    ctx,
  );
}

function filterByRegion(
  feed: AzureStatusFeed,
  region: string | undefined,
): { region: string | null; incidents: AzureIncident[]; degraded: boolean } {
  const incidents = feed.incidents.filter((i) => {
    if (i.status === 'resolved') return false;
    if (!region) return true;
    const needle = region.toLowerCase();
    return i.regions.some((r) => r.includes(needle)) || i.title.toLowerCase().includes(needle);
  });
  return {
    region: region ?? null,
    incidents,
    degraded: incidents.length > 0,
  };
}
