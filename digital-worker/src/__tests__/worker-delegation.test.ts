import { describe, it, expect } from 'vitest';
import { canDelegate, getDelegationTargets, DELEGATION_RULES } from '../worker-delegation';

describe('canDelegate', () => {
  it('allows monitoring → incident-manager', () => {
    expect(canDelegate('monitoring-manager', 'incident-manager')).toBe(true);
  });

  it('allows incident-manager → problem-manager', () => {
    expect(canDelegate('incident-manager', 'problem-manager')).toBe(true);
  });

  it('allows problem-manager → change-manager', () => {
    expect(canDelegate('problem-manager', 'change-manager')).toBe(true);
  });

  it('allows change-manager → release-manager', () => {
    expect(canDelegate('change-manager', 'release-manager')).toBe(true);
  });

  it('disallows reverse delegation (incident → monitoring)', () => {
    expect(canDelegate('incident-manager', 'monitoring-manager')).toBe(false);
  });

  it('disallows unrelated delegation', () => {
    expect(canDelegate('knowledge-manager', 'release-manager')).toBe(false);
  });

  it('disallows self-delegation', () => {
    expect(canDelegate('incident-manager', 'incident-manager')).toBe(false);
  });
});

describe('getDelegationTargets', () => {
  it('returns targets for monitoring-manager', () => {
    const targets = getDelegationTargets('monitoring-manager');
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.some(t => t.targetWorker === 'incident-manager')).toBe(true);
  });

  it('returns empty array for workers with no delegation rules', () => {
    const targets = getDelegationTargets('nonexistent-worker');
    expect(targets).toEqual([]);
  });
});

describe('DELEGATION_RULES', () => {
  it('has at least 5 delegation rules', () => {
    expect(DELEGATION_RULES.length).toBeGreaterThanOrEqual(5);
  });

  it('all rules have required fields', () => {
    for (const rule of DELEGATION_RULES) {
      expect(rule.sourceWorker).toBeTruthy();
      expect(rule.targetWorker).toBeTruthy();
      expect(rule.trigger).toBeTruthy();
    }
  });
});
