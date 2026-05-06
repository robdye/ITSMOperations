/**
 * Public holidays — Nager.Date free API (no auth required).
 *
 *   https://date.nager.at/api/v3/PublicHolidays/{year}/{country}
 *
 * `country` is the ISO 3166-1 alpha-2 country code (e.g. `US`, `GB`, `DE`).
 *
 * TTL: 30 days. Holiday calendars only change once per legislative cycle.
 *
 * Used by `change-manager` (Phase E.3) to refuse change windows on a
 * national holiday for the resolver group's country.
 */

import type { EnrichmentAuthContext } from '../auth.js';
import { runSource, type EnrichmentEnvelope } from '../envelope.js';
import { loadFixture } from '../fixtures-loader.js';

const BASE = 'https://date.nager.at/api/v3/PublicHolidays';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface PublicHoliday {
  date: string; // YYYY-MM-DD
  localName: string;
  name: string;
  countryCode: string;
  fixed?: boolean;
  global?: boolean;
  counties?: string[] | null;
  launchYear?: number | null;
  types?: string[];
}

async function fetchHolidays(year: number, country: string): Promise<PublicHoliday[]> {
  const url = `${BASE}/${year}/${encodeURIComponent(country.toUpperCase())}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'itsm-ops-enrichment/1.0' },
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Nager.Date fetch failed: ${res.status}`);
  return (await res.json()) as PublicHoliday[];
}

/** Tool: `enrichment.holidays.byCountry(year, country)` */
export async function holidaysByCountry(
  args: { year: number; country: string },
  ctx: EnrichmentAuthContext,
): Promise<EnrichmentEnvelope<{ year: number; country: string; holidays: PublicHoliday[] }>> {
  return runSource(
    {
      source: 'nager-holidays',
      ttlMs: TTL_MS,
      sourceUrl: BASE,
      fetchLive: async (a) => ({
        year: a.year,
        country: a.country.toUpperCase(),
        holidays: await fetchHolidays(a.year, a.country),
      }),
      fetchFixture: (a) => {
        const all = loadFixture<Record<string, PublicHoliday[]>>('holidays-fixture.json');
        const key = `${a.country.toUpperCase()}:${a.year}`;
        return { year: a.year, country: a.country.toUpperCase(), holidays: all[key] || all[a.country.toUpperCase()] || [] };
      },
      summarize: (a, d) => `holidays.byCountry ${a.country}/${a.year} count=${d.holidays.length}`,
    },
    args,
    ctx,
  );
}

/**
 * Tool: `enrichment.holidays.isHolidayOn(country, date)`.
 *
 * Looks up the country's calendar for the year of `date` and reports whether
 * the date falls on a national holiday.
 */
export async function isHolidayOn(
  args: { country: string; date: string },
  ctx: EnrichmentAuthContext,
): Promise<
  EnrichmentEnvelope<{
    country: string;
    date: string;
    isHoliday: boolean;
    holiday?: PublicHoliday;
  }>
> {
  // Reuse `holidaysByCountry` so we benefit from its cache.
  const year = Number(args.date.slice(0, 4));
  const inner = await holidaysByCountry({ year, country: args.country }, ctx);
  const target = args.date.slice(0, 10);
  const holiday = inner.data.holidays.find((h) => h.date === target && (h.global !== false));
  return {
    data: {
      country: args.country.toUpperCase(),
      date: target,
      isHoliday: Boolean(holiday),
      holiday,
    },
    provenance: { ...inner.provenance, source: 'nager-holidays' },
    safety: inner.safety,
  };
}
