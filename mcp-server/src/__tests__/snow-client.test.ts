import { describe, it, expect } from 'vitest';
import { sanitizeSnowValue } from '../snow-client.js';

describe('sanitizeSnowValue', () => {
  it('strips caret (query separator)', () => {
    expect(sanitizeSnowValue('value^ORfield=hack')).not.toContain('^');
  });

  it('strips equals sign', () => {
    expect(sanitizeSnowValue('state=active')).not.toContain('=');
  });

  it('strips angle brackets', () => {
    expect(sanitizeSnowValue('priority<1')).not.toContain('<');
    expect(sanitizeSnowValue('priority>5')).not.toContain('>');
  });

  it('strips exclamation mark', () => {
    expect(sanitizeSnowValue('state!=closed')).not.toContain('!');
  });

  it('strips percent (wildcard)', () => {
    expect(sanitizeSnowValue('%admin%')).not.toContain('%');
  });

  it('strips OR keyword', () => {
    const result = sanitizeSnowValue('active OR admin');
    expect(result.toUpperCase()).not.toContain(' OR ');
  });

  it('strips NQ keyword (word-bounded)', () => {
    const result = sanitizeSnowValue('state=active NQ priority=1');
    expect(result.toUpperCase()).not.toMatch(/\bNQ\b/);
  });

  it('strips LIKE keyword (word-bounded)', () => {
    const result = sanitizeSnowValue('name LIKE admin');
    expect(result.toUpperCase()).not.toMatch(/\bLIKE\b/);
  });

  it('strips ORDERBY keyword (word-bounded)', () => {
    const result = sanitizeSnowValue('name ORDERBY priority');
    expect(result.toUpperCase()).not.toMatch(/\bORDERBY\b/);
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
});
