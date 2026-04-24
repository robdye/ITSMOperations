import { describe, it, expect } from 'vitest';
import { queueAction, resolveAction, getAction, getQueueSummary, MAX_QUEUE_SIZE } from '../approval-queue';

describe('queueAction', () => {
  it('creates a pending action with approval card', () => {
    const { actionId, card } = queueAction(
      'incident-manager', 'Incident Manager',
      'create_incident', { short_description: 'Test' },
      'user1', 'Test User'
    );
    expect(actionId).toBeTruthy();
    expect(card).toBeDefined();
    expect(card.type).toBe('AdaptiveCard');

    const action = getAction(actionId);
    expect(action).not.toBeNull();
    expect(action!.status).toBe('pending');
    expect(action!.toolName).toBe('create_incident');
  });
});

describe('resolveAction', () => {
  it('approves a pending action', () => {
    const { actionId } = queueAction(
      'change-manager', 'Change Manager',
      'update_change', { state: 'implement' },
      'user2', 'Approver'
    );
    const resolved = resolveAction(actionId, 'approved', 'admin1');
    expect(resolved).not.toBeNull();
    expect(resolved!.status).toBe('approved');
    expect(resolved!.resolvedBy).toBe('admin1');
  });

  it('rejects a pending action', () => {
    const { actionId } = queueAction(
      'change-manager', 'Change Manager',
      'delete_asset', { sysId: 'abc' },
      'user3', 'Requester'
    );
    const resolved = resolveAction(actionId, 'rejected', 'admin2');
    expect(resolved).not.toBeNull();
    expect(resolved!.status).toBe('rejected');
  });

  it('returns null for unknown action', () => {
    expect(resolveAction('nonexistent', 'approved', 'admin')).toBeNull();
  });
});

describe('getQueueSummary', () => {
  it('returns summary with correct counts', () => {
    const summary = getQueueSummary();
    expect(summary.total).toBeGreaterThan(0);
    expect(typeof summary.pending).toBe('number');
    expect(typeof summary.approved).toBe('number');
    expect(typeof summary.rejected).toBe('number');
  });
});

describe('MAX_QUEUE_SIZE', () => {
  it('is set to 500', () => {
    expect(MAX_QUEUE_SIZE).toBe(500);
  });
});
