import { describe, it, expect } from 'vitest';
import { classifyTool, batchRequiresConfirmation, getWorkerRiskSummary } from '../hitl';

describe('classifyTool', () => {
  it('classifies get_ tools as read', () => {
    const result = classifyTool('get_incidents');
    expect(result.level).toBe('read');
    expect(result.requiresConfirmation).toBe(false);
  });

  it('classifies list_ tools as read', () => {
    const result = classifyTool('list_change_requests');
    expect(result.level).toBe('read');
    expect(result.requiresConfirmation).toBe(false);
  });

  it('classifies search_ tools as read', () => {
    const result = classifyTool('search_knowledge');
    expect(result.level).toBe('read');
  });

  it('classifies create_ tools as write', () => {
    const result = classifyTool('create_incident');
    expect(result.level).toBe('write');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('classifies update_ tools as write', () => {
    const result = classifyTool('update_change_request');
    expect(result.level).toBe('write');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('classifies delete_ tools as write', () => {
    const result = classifyTool('delete_asset');
    expect(result.level).toBe('write');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('classifies send_email as notify', () => {
    const result = classifyTool('send_email');
    expect(result.level).toBe('notify');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('classifies send_teams_message as notify', () => {
    const result = classifyTool('send_teams_message');
    expect(result.level).toBe('notify');
  });

  it('defaults unknown tools to read (safe fallthrough)', () => {
    const result = classifyTool('some_unknown_tool');
    expect(result.level).toBe('read');
    expect(result.requiresConfirmation).toBe(false);
  });
});

describe('batchRequiresConfirmation', () => {
  it('returns false for read-only batch', () => {
    expect(batchRequiresConfirmation(['get_incidents', 'list_changes'])).toBe(false);
  });

  it('returns true if any tool is write', () => {
    expect(batchRequiresConfirmation(['get_incidents', 'create_incident'])).toBe(true);
  });

  it('returns true if any tool is notify', () => {
    expect(batchRequiresConfirmation(['get_incidents', 'send_email'])).toBe(true);
  });
});

describe('getWorkerRiskSummary', () => {
  it('categorizes tools correctly', () => {
    const summary = getWorkerRiskSummary(['get_incidents', 'create_incident', 'send_email']);
    expect(summary.reads).toContain('get_incidents');
    expect(summary.writes).toContain('create_incident');
    expect(summary.notifies).toContain('send_email');
  });
});
