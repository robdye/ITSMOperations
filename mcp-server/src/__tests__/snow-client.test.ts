import { describe, it, expect } from 'vitest';
import { sanitizeSnowValue } from '../snow-query.js';

describe('sanitizeSnowValue', () => {
  it('strips caret (query separator)', () => {
    expect(sanitizeSnowValue('value^ORfield=hack')).not.toContain('^');
  });

  it('preserves equals sign (safe inside typed builder)', () => {
    expect(sanitizeSnowValue('state=active')).toBe('state=active');
  });

  it('preserves angle brackets (safe inside typed builder)', () => {
    expect(sanitizeSnowValue('priority<1')).toBe('priority<1');
    expect(sanitizeSnowValue('priority>5')).toBe('priority>5');
  });

  it('preserves exclamation mark (safe inside typed builder)', () => {
    expect(sanitizeSnowValue('state!=closed')).toBe('state!=closed');
  });

  it('preserves percent (safe inside typed builder)', () => {
    expect(sanitizeSnowValue('%admin%')).toBe('%admin%');
  });

  it('preserves OR keyword in values (safe inside typed builder)', () => {
    expect(sanitizeSnowValue('active OR admin')).toBe('active OR admin');
  });

  it('strips caret-based NQ injection', () => {
    const result = sanitizeSnowValue('state=active^NQ priority=1');
    expect(result).not.toContain('^');
  });

  it('preserves LIKE keyword in values (safe inside typed builder)', () => {
    expect(sanitizeSnowValue('name LIKE admin')).toBe('name LIKE admin');
  });

  it('preserves ORDERBY keyword in values (safe inside typed builder)', () => {
    expect(sanitizeSnowValue('name ORDERBY priority')).toBe('name ORDERBY priority');
  });

  it('preserves safe values', () => {
    expect(sanitizeSnowValue('INC0012345')).toBe('INC0012345');
    expect(sanitizeSnowValue('Web Server')).toBe('Web Server');
    expect(sanitizeSnowValue('john.doe')).toBe('john.doe');
  });

  it('trims whitespace', () => {
    expect(sanitizeSnowValue('  test  ')).toBe('test');
  });

  it('handles empty string', () => {
    expect(sanitizeSnowValue('')).toBe('');
  });

  it('strips newlines', () => {
    expect(sanitizeSnowValue('line1\nline2')).toBe('line1 line2');
  });
});
