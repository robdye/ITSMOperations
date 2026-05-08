// Phase 4 — case-reminders smoke tests.
//
// Validates start/stop loop control + KPI surface. The actual `tick()`
// is internal; we exercise it indirectly via setNextReminder + a manual
// import of the loop functions to assert no-throw and idempotence.

import { describe, it, expect } from 'vitest';
import {
  startCaseReminderLoop,
  stopCaseReminderLoop,
  getReminderKpi,
} from '../case-reminders';

describe('case-reminders', () => {
  it('startCaseReminderLoop is idempotent', () => {
    expect(() => startCaseReminderLoop()).not.toThrow();
    expect(() => startCaseReminderLoop()).not.toThrow();
    stopCaseReminderLoop();
  });

  it('stopCaseReminderLoop is safe to call when no loop is running', () => {
    stopCaseReminderLoop();
    expect(() => stopCaseReminderLoop()).not.toThrow();
  });

  it('getReminderKpi exposes the documented KPI shape', () => {
    const kpi = getReminderKpi();
    expect(kpi).toMatchObject({
      ticks: expect.any(Number),
      remindersFired: expect.any(Number),
      escalations: expect.any(Number),
      nagsPerHour: expect.any(Number),
      uptimeSec: expect.any(Number),
    });
  });
});
