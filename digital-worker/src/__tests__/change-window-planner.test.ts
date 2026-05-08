// Phase 4 — change-window-planner smoke tests.
//
// We mock the `isHolidayOn` enrichment-bridge entry point so this test
// runs hermetically without a running enrichment server.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const isHolidayOnMock = vi.fn();

vi.mock('../enrichment-bridge', () => ({
  isHolidayOn: (...args: unknown[]) => isHolidayOnMock(...args),
}));

describe('change-window-planner', () => {
  beforeEach(() => {
    isHolidayOnMock.mockReset();
  });

  it('returns ok=true when the date is not a holiday', async () => {
    isHolidayOnMock.mockResolvedValue({
      data: { isHoliday: false },
      provenance: {
        source: 'enrichment.test',
        fetchedAt: new Date().toISOString(),
        fixtureUsed: false,
      },
    });
    const { evaluateChangeWindow } = await import('../change-window-planner');
    const v = await evaluateChangeWindow({ date: '2027-03-09', country: 'GB' });
    expect(v.ok).toBe(true);
    expect(v.date).toBe('2027-03-09');
    expect(v.country).toBe('GB');
    expect(typeof v.reason).toBe('string');
    expect(v.provenance.fixtureUsed).toBe(false);
  });

  it('returns ok=false with the holiday reason when the date matches', async () => {
    isHolidayOnMock.mockResolvedValue({
      data: {
        isHoliday: true,
        holiday: { date: '2024-12-25', name: 'Christmas Day', countryCode: 'GB' },
      },
      provenance: {
        source: 'enrichment.holidays',
        fetchedAt: new Date().toISOString(),
        fixtureUsed: true,
      },
    });
    const { evaluateChangeWindow } = await import('../change-window-planner');
    const v = await evaluateChangeWindow({ date: '2024-12-25', country: 'GB' });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/Christmas Day|holiday/i);
    expect(v.provenance.fixtureUsed).toBe(true);
  });

  it('passes through the date and country from the request', async () => {
    isHolidayOnMock.mockResolvedValue({
      data: { isHoliday: false },
      provenance: { source: 'x', fetchedAt: '', fixtureUsed: false },
    });
    const { evaluateChangeWindow } = await import('../change-window-planner');
    const v = await evaluateChangeWindow({ date: '2027-07-04', country: 'US' });
    expect(v.date).toBe('2027-07-04');
    expect(v.country).toBe('US');
  });
});
