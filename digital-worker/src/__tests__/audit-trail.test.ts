import { describe, it, expect } from 'vitest';
import { sanitizeParams, SENSITIVE_KEYS } from '../audit-trail';

describe('SENSITIVE_KEYS pattern', () => {
  it('matches password', () => expect(SENSITIVE_KEYS.test('password')).toBe(true));
  it('matches secret', () => expect(SENSITIVE_KEYS.test('client_secret')).toBe(true));
  it('matches token', () => expect(SENSITIVE_KEYS.test('access_token')).toBe(true));
  it('matches api_key', () => expect(SENSITIVE_KEYS.test('api_key')).toBe(true));
  it('matches credential', () => expect(SENSITIVE_KEYS.test('credential')).toBe(true));
  it('matches authorization', () => expect(SENSITIVE_KEYS.test('Authorization')).toBe(true));
  it('matches bearer', () => expect(SENSITIVE_KEYS.test('bearer_token')).toBe(true));
  it('matches cookie', () => expect(SENSITIVE_KEYS.test('cookie')).toBe(true));
  it('does not match safe keys', () => {
    expect(SENSITIVE_KEYS.test('username')).toBe(false);
    expect(SENSITIVE_KEYS.test('description')).toBe(false);
    expect(SENSITIVE_KEYS.test('state')).toBe(false);
  });
});

describe('sanitizeParams', () => {
  it('redacts top-level sensitive keys in JSON', () => {
    const input = JSON.stringify({ username: 'admin', password: 'hunter2', state: 'open' });
    const result = JSON.parse(sanitizeParams(input));
    expect(result.username).toBe('admin');
    expect(result.password).toBe('[REDACTED]');
    expect(result.state).toBe('open');
  });

  it('redacts nested sensitive keys (recursive)', () => {
    const input = JSON.stringify({
      config: {
        host: 'db.example.com',
        credentials: {
          api_key: 'sk-12345',
          username: 'svc-account',
        },
      },
    });
    const result = JSON.parse(sanitizeParams(input));
    expect(result.config.host).toBe('db.example.com');
    expect(result.config.credentials).toBe('[REDACTED]');
  });

  it('redacts sensitive keys in arrays', () => {
    const input = JSON.stringify({
      items: [
        { name: 'test', token: 'abc123' },
        { name: 'test2', value: 'safe' },
      ],
    });
    const result = JSON.parse(sanitizeParams(input));
    expect(result.items[0].token).toBe('[REDACTED]');
    expect(result.items[0].name).toBe('test');
    expect(result.items[1].value).toBe('safe');
  });

  it('handles non-JSON strings with inline patterns', () => {
    const input = 'password=hunter2 token=abc123 name=test';
    const result = sanitizeParams(input);
    expect(result).toContain('password=[REDACTED]');
    expect(result).toContain('token=[REDACTED]');
    expect(result).toContain('name=test');
  });

  it('handles empty JSON object', () => {
    expect(sanitizeParams('{}')).toBe('{}');
  });

  it('preserves non-sensitive data exactly', () => {
    const input = JSON.stringify({ short_description: 'Server down', priority: '1' });
    const result = JSON.parse(sanitizeParams(input));
    expect(result.short_description).toBe('Server down');
    expect(result.priority).toBe('1');
  });
});
