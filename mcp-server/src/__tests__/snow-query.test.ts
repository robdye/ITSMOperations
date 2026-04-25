import { describe, it, expect } from 'vitest';
import { SnowQuery } from '../snow-query.js';

describe('SnowQuery', () => {
  it('builds simple equality query', () => {
    const q = SnowQuery.eq('state', '1');
    expect(q.build()).toBe('state=1');
  });

  it('chains AND conditions', () => {
    const q = SnowQuery.eq('state', '1').eq('priority', '2');
    expect(q.build()).toBe('state=1^priority=2');
  });

  it('handles IN operator', () => {
    const q = new SnowQuery().in('priority', ['1', '2', '3']);
    expect(q.build()).toBe('priorityIN1,2,3');
  });

  it('handles ORDER BY DESC', () => {
    const q = SnowQuery.eq('state', '1').orderByDesc('opened_at');
    expect(q.build()).toBe('state=1^ORDERBYDESCopened_at');
  });

  it('prevents field name injection', () => {
    expect(() => SnowQuery.eq('state^NQpriority', '1')).not.toThrow();
    // The ^ should be stripped from field name
    const q = SnowQuery.eq('state^NQpriority', '1');
    expect(q.build()).not.toContain('^NQ');
  });

  it('prevents value injection via ^ separator', () => {
    const q = SnowQuery.eq('short_description', 'test^NQstate=1');
    expect(q.build()).not.toContain('^NQ');
    expect(q.build()).toBe('short_description=testNQstate=1');
  });

  it('handles LIKE queries', () => {
    const q = new SnowQuery().like('short_description', 'network');
    expect(q.build()).toBe('short_descriptionLIKEnetwork');
  });

  it('handles ISEMPTY', () => {
    const q = new SnowQuery().isEmpty('assigned_to');
    expect(q.build()).toBe('assigned_toISEMPTY');
  });

  it('handles complex queries', () => {
    const q = SnowQuery.eq('state', '2')
      .eq('priority', '1')
      .orderByDesc('opened_at');
    expect(q.build()).toBe('state=2^priority=1^ORDERBYDESCopened_at');
  });

  it('rejects empty field names', () => {
    expect(() => SnowQuery.eq('', 'value')).toThrow('Invalid ServiceNow field name');
  });
});
