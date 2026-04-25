import { describe, it, expect } from 'vitest';
import { classifyIntent, getWorkerById } from '../worker-registry';

describe('classifyIntent', () => {
  it('routes incident keywords to incident-manager', () => {
    const result = classifyIntent('There is a P1 incident affecting email service');
    expect(result.worker.id).toBe('incident-manager');
    expect(result.confidence).toBeTruthy();
  });

  it('routes incident keywords (alternate phrasing)', () => {
    const result = classifyIntent('Show me all P1 incidents');
    expect(result.worker.id).toBe('incident-manager');
    expect(result.confidence).not.toBe('low');
  });

  it('routes change keywords to change-manager', () => {
    const result = classifyIntent('I need to create a change request for the database upgrade');
    expect(result.worker.id).toBe('change-manager');
  });

  it('routes change keywords (alternate phrasing)', () => {
    const result = classifyIntent('What changes are scheduled for this week?');
    expect(['change-manager', 'command-center']).toContain(result.worker.id);
  });

  it('routes problem keywords to problem-manager', () => {
    const result = classifyIntent('We have a recurring problem with the login service root cause');
    expect(result.worker.id).toBe('problem-manager');
  });

  it('routes problem keywords (alternate phrasing)', () => {
    const result = classifyIntent('Show me the root cause analysis for the network issue');
    expect(result.worker.id).toBe('problem-manager');
  });

  it('routes asset keywords to asset-cmdb-manager', () => {
    const result = classifyIntent('Show me the CMDB configuration items for the web server');
    expect(result.worker.id).toBe('asset-cmdb-manager');
  });

  it('routes CMDB keywords with EOL status', () => {
    const result = classifyIntent('Show CMDB configuration items with EOL status');
    expect(result.worker.id).toBe('asset-cmdb-manager');
  });

  it('routes SLA keywords to sla-manager', () => {
    const result = classifyIntent('Check our SLA compliance and breach predictions');
    expect(result.worker.id).toBe('sla-manager');
  });

  it('routes SLA breach risk queries', () => {
    const result = classifyIntent('Which tickets are at risk of SLA breach?');
    expect(['sla-manager', 'command-center']).toContain(result.worker.id);
  });

  it('routes knowledge keywords to knowledge-manager', () => {
    const result = classifyIntent('Search the knowledge base for password reset article');
    expect(result.worker.id).toBe('knowledge-manager');
  });

  it('routes security keywords to security-manager', () => {
    const result = classifyIntent('List critical CVE vulnerabilities');
    expect(result.worker.id).toBe('security-manager');
  });

  it('falls back to command-center for vague messages', () => {
    const result = classifyIntent('hello how are you today');
    expect(result.worker.id).toBe('command-center');
    expect(result.confidence).toBe('low');
  });

  it('routes briefing requests to command-center', () => {
    const result = classifyIntent('Give me a status overview');
    expect(result.worker.id).toBe('command-center');
    expect(result.confidence).toBe('medium');
  });

  it('routes cross-practice requests to command-center', () => {
    // Mention both incident AND change heavily
    const result = classifyIntent('The incident caused a change request and the change caused another incident with SLA breach');
    expect(result.worker.id).toBe('command-center');
  });

  it('handles cross-practice requests', () => {
    const result = classifyIntent('Show incidents related to recent changes');
    // Should go to command center since both incident and change match
    expect(['command-center', 'incident-manager', 'change-manager']).toContain(result.worker.id);
  });

  it('returns high confidence for multiple keyword matches', () => {
    const result = classifyIntent('Show me the P1 incident INC0001234 that caused an outage');
    expect(result.worker.id).toBe('incident-manager');
    expect(result.confidence).toBe('high');
  });
});

describe('getWorkerById', () => {
  it('returns worker for valid id', () => {
    const worker = getWorkerById('incident-manager');
    expect(worker).toBeDefined();
    expect(worker!.name).toContain('Incident');
  });

  it('returns worker for valid ID', () => {
    const worker = getWorkerById('incident-manager');
    expect(worker).toBeDefined();
    expect(worker?.id).toBe('incident-manager');
  });

  it('returns command-center for that ID', () => {
    const worker = getWorkerById('command-center');
    expect(worker).toBeDefined();
  });

  it('returns undefined for unknown id', () => {
    expect(getWorkerById('nonexistent')).toBeUndefined();
  });

  it('returns undefined for invalid ID', () => {
    const worker = getWorkerById('nonexistent');
    expect(worker).toBeUndefined();
  });
});
