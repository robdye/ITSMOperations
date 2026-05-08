// Phase 4 — enrichment-bridge smoke tests.
//
// The enrichment-bridge module wraps the mcp-server-enrichment HTTP
// surface with OBO + provenance. We assert the public exports exist
// and have the documented shape; live HTTP behaviour is exercised by
// the integration tests under mcp-server-enrichment/__tests__.

import { describe, it, expect } from 'vitest';
import { enrichmentBridge } from '../enrichment-bridge';

describe('enrichment-bridge: surface', () => {
  it('exports the enrichmentBridge facade with all 8 source methods', () => {
    expect(enrichmentBridge).toBeDefined();
    const expected = [
      'lookupKev',
      'recentKev',
      'cveDetail',
      'cveByProduct',
      'msrcMonthly',
      'azureStatus',
      'm365Health',
      'holidaysByCountry',
      'isHolidayOn',
    ];
    for (const m of expected) {
      expect(typeof (enrichmentBridge as Record<string, unknown>)[m]).toBe('function');
    }
  });
});
