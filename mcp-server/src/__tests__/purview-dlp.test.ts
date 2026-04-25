import { describe, it, expect } from 'vitest';
import { classifyRecord, isOperationAllowed, redactPii } from '../purview-dlp.js';

describe('classifyRecord', () => {
  it('classifies KB articles as public', () => {
    const result = classifyRecord('kb_knowledge', { sys_id: '1', text: 'How to reset password' });
    expect(result.sensitivityLabel).toBe('public');
  });

  it('classifies incidents as internal', () => {
    const result = classifyRecord('incident', { sys_id: '1', short_description: 'Server down' });
    expect(result.sensitivityLabel).toBe('internal');
  });

  it('detects PII and escalates to confidential', () => {
    const result = classifyRecord('incident', { 
      sys_id: '1', 
      description: 'User John with SSN 123-45-6789 cannot login' 
    });
    expect(result.sensitivityLabel).toBe('confidential');
    expect(result.piiDetected).toBe(true);
  });

  it('classifies security incidents as highly-confidential', () => {
    const result = classifyRecord('sn_si_incident', { sys_id: '1' });
    expect(result.sensitivityLabel).toBe('highly-confidential');
  });

  it('detects security breach content', () => {
    const result = classifyRecord('incident', { 
      sys_id: '1', 
      description: 'Possible security breach detected in production' 
    });
    expect(result.sensitivityLabel).toBe('highly-confidential');
  });
});

describe('isOperationAllowed', () => {
  it('allows all operations on public records', () => {
    const record = classifyRecord('kb_knowledge', { sys_id: '1' });
    expect(isOperationAllowed('export', record).allowed).toBe(true);
  });

  it('blocks export on internal records', () => {
    const record = classifyRecord('incident', { sys_id: '1' });
    expect(isOperationAllowed('export', record).allowed).toBe(false);
  });

  it('blocks write on highly-confidential records', () => {
    const record = classifyRecord('sn_si_incident', { sys_id: '1' });
    expect(isOperationAllowed('write', record).allowed).toBe(false);
    expect(isOperationAllowed('read', record).allowed).toBe(true);
  });
});

describe('redactPii', () => {
  it('redacts PII fields', () => {
    const record = { sys_id: '1', description: 'SSN: 123-45-6789' };
    const classification = classifyRecord('incident', record);
    const redacted = redactPii(record, classification);
    expect(redacted.description).toContain('[REDACTED');
  });

  it('preserves non-PII fields', () => {
    const record = { sys_id: '1', short_description: 'Server down' };
    const classification = classifyRecord('incident', record);
    const redacted = redactPii(record, classification);
    expect(redacted.short_description).toBe('Server down');
  });
});
