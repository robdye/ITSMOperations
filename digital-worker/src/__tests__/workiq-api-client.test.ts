// Phase 4 — workiq-api-client smoke tests.
//
// Tests the KPI surface and the WorkIqApiClient construction. Live HTTP
// behaviour is exercised via integration tests; here we exercise only
// what is hermetic: KPI counters and class instantiation.

import { describe, it, expect } from 'vitest';
import {
  recordWorkIqAttempt,
  getWorkIqKpi,
  WorkIqApiClient,
} from '../workiq-api-client';

describe('workiq-api-client: KPI surface', () => {
  it('recordWorkIqAttempt updates the KPI counters', () => {
    const before = getWorkIqKpi().find((k) => k.transport === 'api');
    recordWorkIqAttempt('api', true);
    const afterOk = getWorkIqKpi().find((k) => k.transport === 'api');
    expect(afterOk!.attempts).toBe((before?.attempts || 0) + 1);
    expect(afterOk!.successes).toBe((before?.successes || 0) + 1);

    recordWorkIqAttempt('api', false, 'synthetic-failure');
    const afterFail = getWorkIqKpi().find((k) => k.transport === 'api');
    expect(afterFail!.failures).toBe((before?.failures || 0) + 1);
    expect(afterFail!.lastError).toBe('synthetic-failure');
  });

  it('getWorkIqKpi exposes both transports with the right shape', () => {
    const kpis = getWorkIqKpi();
    expect(kpis.length).toBe(2);
    const transports = kpis.map((k) => k.transport).sort();
    expect(transports).toEqual(['api', 'mcp']);
    for (const k of kpis) {
      expect(k).toMatchObject({
        transport: expect.any(String),
        attempts: expect.any(Number),
        successes: expect.any(Number),
        failures: expect.any(Number),
        successRate: expect.any(Number),
        uptimeSec: expect.any(Number),
      });
    }
  });
});

describe('workiq-api-client: WorkIqApiClient', () => {
  it('exports the WorkIqApiClient class', () => {
    expect(typeof WorkIqApiClient).toBe('function');
  });

  it('can be instantiated', () => {
    const client = new WorkIqApiClient();
    expect(client).toBeInstanceOf(WorkIqApiClient);
  });

  it('exposes all 18 IWorkIqClient surface methods', () => {
    const client = new WorkIqApiClient();
    const expected = [
      'searchEmails',
      'getEmailsAboutIncident',
      'getEmailsAboutChange',
      'getUpcomingMeetings',
      'findCabMeetings',
      'getMeetingDetails',
      'searchTeamsMessages',
      'getChannelActivity',
      'getItOpsChannelAlerts',
      'lookupPerson',
      'getOrgChart',
      'findExpertFor',
      'searchDocuments',
      'findRunbook',
      'extractActionItems',
      'triageInbox',
      'getMeetingCosts',
      'query',
    ];
    for (const m of expected) {
      expect(typeof (client as unknown as Record<string, unknown>)[m]).toBe('function');
    }
  });
});
