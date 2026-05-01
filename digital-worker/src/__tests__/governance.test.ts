import { describe, it, expect, beforeEach } from 'vitest';
import {
  isKillSwitchEngaged,
  engageKillSwitch,
  releaseKillSwitch,
  isChangeFreezeActive,
  setChangeFreezeWindows,
  recordAction,
  getBudgetSnapshot,
  statementsOfAutonomy,
  _resetGovernance,
} from '../governance';

describe('governance', () => {
  beforeEach(() => {
    _resetGovernance();
    delete process.env.GLOBAL_KILL_SWITCH;
    delete process.env.CHANGE_FREEZE;
  });

  it('kill-switch toggles', () => {
    expect(isKillSwitchEngaged()).toBe(false);
    engageKillSwitch('test', 'because');
    expect(isKillSwitchEngaged()).toBe(true);
    releaseKillSwitch('test');
    expect(isKillSwitchEngaged()).toBe(false);
  });

  it('change-freeze respects time window', () => {
    const now = Date.now();
    setChangeFreezeWindows([
      { from: new Date(now - 60_000).toISOString(), to: new Date(now + 60_000).toISOString(), reason: 'maintenance' },
    ]);
    expect(isChangeFreezeActive(now)).toBe(true);
    expect(isChangeFreezeActive(now + 120_000)).toBe(false);
  });

  it('budget snapshot tracks per-tenant action timestamps', () => {
    const now = Date.now();
    recordAction('t-1', now);
    recordAction('t-1', now);
    const snap = getBudgetSnapshot('t-1', 5, 60 * 60 * 1000, now);
    expect(snap.used).toBe(2);
    expect(snap.remaining).toBe(3);
  });

  it('statements of autonomy fall back to a sensible default', () => {
    const stmts = statementsOfAutonomy([
      { id: 'incident-manager', name: 'Incident Manager', itilPractice: 'incident', instructions: '', tools: [] },
    ]);
    expect(stmts).toHaveLength(1);
    expect(stmts[0].statement.length).toBeGreaterThan(20);
    expect(stmts[0].allowAutonomous).toBe(true);
  });
});
