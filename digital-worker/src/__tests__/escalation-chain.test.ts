import { describe, it, expect } from 'vitest';
import { createStaleTicketEscalation, getEscalationLog, MAX_ESCALATION_LOG } from '../escalation-chain';

describe('createStaleTicketEscalation', () => {
  it('creates escalation for stale ticket', () => {
    const event = createStaleTicketEscalation('INC0012345', 'incident-manager', 6);
    expect(event.id).toMatch(/^esc-stale-/);
    expect(event.originalWorkerId).toBe('incident-manager');
    expect(event.reason).toContain('INC0012345');
    expect(event.reason).toContain('6 hours');
  });

  it('escalates to command-center for < 8 hours', () => {
    const event = createStaleTicketEscalation('INC001', 'incident-manager', 5);
    expect(event.currentLevel).toBe('command-center');
  });

  it('escalates to human for > 8 hours', () => {
    const event = createStaleTicketEscalation('INC001', 'incident-manager', 12);
    expect(event.currentLevel).toBe('human');
  });
});

describe('escalation log eviction', () => {
  it('respects MAX_ESCALATION_LOG constant', () => {
    expect(MAX_ESCALATION_LOG).toBe(500);
  });

  it('does not grow beyond MAX_ESCALATION_LOG', () => {
    // Create many escalations
    for (let i = 0; i < MAX_ESCALATION_LOG + 50; i++) {
      createStaleTicketEscalation(`INC${i}`, 'incident-manager', 5);
    }
    const log = getEscalationLog();
    expect(log.length).toBeLessThanOrEqual(MAX_ESCALATION_LOG);
  });
});
