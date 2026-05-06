/**
 * Unit tests for each enrichment source — exercise the demo (fixture) path,
 * confirm provenance, cache hits, and audit emission.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { clear as clearCache } from '../src/cache.js';
import { getRecentAuditEntries } from '../src/audit.js';

import { lookupKev, recentKev } from '../src/sources/cisa-kev.js';
import { cveDetail, cveByProduct } from '../src/sources/nvd.js';
import { msrcMonthly } from '../src/sources/msrc.js';
import { azureStatus } from '../src/sources/azure-status.js';
import { m365Health } from '../src/sources/m365-service-health.js';
import { holidaysByCountry, isHolidayOn } from '../src/sources/nager-holidays.js';

import type { EnrichmentAuthContext } from '../src/auth.js';

const demoCtx: EnrichmentAuthContext = {
  userToken: 'fixture',
  tenantId: 'tenant-test',
  profile: 'demo',
  callerAgentId: 'service-desk-manager',
};

beforeEach(() => {
  clearCache();
});

describe('cisa-kev source (demo)', () => {
  it('matches Log4j by product name and stamps provenance', async () => {
    const env = await lookupKev({ productOrVendor: 'log4j' }, demoCtx);
    expect(env.data.matches.length).toBeGreaterThan(0);
    expect(env.data.matches[0].cveID).toBe('CVE-2021-44228');
    expect(env.provenance.source).toBe('cisa-kev');
    expect(env.provenance.fixtureUsed).toBe(true);
    expect(env.provenance.cacheHit).toBe(false);
    expect(env.provenance.sourceUrl).toMatch(/cisa\.gov/);
  });

  it('serves the second call from cache', async () => {
    await lookupKev({ productOrVendor: 'microsoft' }, demoCtx);
    const second = await lookupKev({ productOrVendor: 'microsoft' }, demoCtx);
    expect(second.provenance.cacheHit).toBe(true);
  });

  it('returns recent KEV entries within window (large window for fixture)', async () => {
    // Fixture entries are dated 2024-10. Use a 4-year window so they qualify
    // even when CI clock is well after the fixture date.
    const env = await recentKev({ hours: 24 * 365 * 4 }, demoCtx);
    expect(env.data.entries.length).toBeGreaterThan(0);
  });
});

describe('nvd source (demo)', () => {
  it('returns the canonical Log4Shell CVSS 10.0 detail', async () => {
    const env = await cveDetail({ cveId: 'CVE-2021-44228' }, demoCtx);
    expect(env.data.cve?.cveId).toBe('CVE-2021-44228');
    expect(env.data.cve?.cvss?.baseScore).toBeGreaterThanOrEqual(9.8);
    expect(env.data.cve?.cvss?.severity).toBe('CRITICAL');
  });

  it('returns null cve for an unknown id', async () => {
    const env = await cveDetail({ cveId: 'CVE-9999-99999' }, demoCtx);
    expect(env.data.cve).toBeNull();
  });

  it('searches by product keyword', async () => {
    const env = await cveByProduct({ cpeOrProduct: 'Apache Log4j' }, demoCtx);
    expect(env.data.matches.length).toBeGreaterThan(0);
  });
});

describe('msrc source (demo)', () => {
  it('summarises Patch Tuesday with CVSS-driven severity', async () => {
    const env = await msrcMonthly({ yearMonth: '2024-Oct' }, demoCtx);
    expect(env.data.advisories.length).toBeGreaterThan(0);
    const critical = env.data.advisories.find((a) => a.severity === 'Critical');
    expect(critical).toBeTruthy();
    expect(critical?.baseScore).toBeGreaterThanOrEqual(9.0);
    expect(env.data.criticalCount).toBeGreaterThanOrEqual(1);
  });
});

describe('azure-status source (demo)', () => {
  it('reports degradation when fixture has investigating incidents', async () => {
    const env = await azureStatus({}, demoCtx);
    expect(env.data.incidents.length).toBeGreaterThan(0);
    expect(env.data.degraded).toBe(true);
  });

  it('filters by region', async () => {
    const env = await azureStatus({ region: 'East US 2' }, demoCtx);
    expect(env.data.incidents.length).toBeGreaterThanOrEqual(1);
    const titles = env.data.incidents.map((i) => i.title.toLowerCase()).join(' ');
    expect(titles).toMatch(/east us 2/);
  });
});

describe('m365 service health (demo)', () => {
  it('returns a degraded snapshot when fixture has an active issue', async () => {
    const env = await m365Health({}, demoCtx);
    expect(env.data.services.length).toBeGreaterThan(0);
    expect(env.data.degradedCount).toBeGreaterThanOrEqual(1);
  });
});

describe('nager holidays (demo)', () => {
  it('lists US 2024 holidays', async () => {
    const env = await holidaysByCountry({ year: 2024, country: 'US' }, demoCtx);
    expect(env.data.holidays.length).toBeGreaterThan(0);
    const dates = env.data.holidays.map((h) => h.date);
    expect(dates).toContain('2024-07-04');
    expect(dates).toContain('2024-12-25');
  });

  it('isHolidayOn returns true for July 4th US', async () => {
    const env = await isHolidayOn({ country: 'US', date: '2024-07-04' }, demoCtx);
    expect(env.data.isHoliday).toBe(true);
    expect(env.data.holiday?.name).toMatch(/Independence Day/);
  });

  it('isHolidayOn returns false for an arbitrary weekday', async () => {
    const env = await isHolidayOn({ country: 'US', date: '2024-07-09' }, demoCtx);
    expect(env.data.isHoliday).toBe(false);
  });
});

describe('audit emission', () => {
  it('records every enrichment call with tool=enrichment:<source> and triggerType=a2a', async () => {
    await lookupKev({ productOrVendor: 'kernel' }, demoCtx);
    await isHolidayOn({ country: 'GB', date: '2024-12-25' }, demoCtx);
    const audits = getRecentAuditEntries(50);
    const tools = audits.map((a) => a.tool);
    expect(tools).toContain('enrichment:cisa-kev');
    expect(tools).toContain('enrichment:nager-holidays');
    for (const a of audits) {
      expect(a.triggerType).toBe('a2a');
      expect(a.callerAgentId).toBe('service-desk-manager');
      expect(a.profile).toBe('demo');
    }
  });
});
