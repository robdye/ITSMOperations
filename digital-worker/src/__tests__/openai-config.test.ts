import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// We need to test model routing - import after env setup
describe('model routing', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('detects RCA task type from message', async () => {
    const { detectTaskType } = await import('../openai-config');
    expect(detectTaskType('problem-manager', 'Perform root cause analysis')).toBe('rca');
  });

  it('detects risk task type', async () => {
    const { detectTaskType } = await import('../openai-config');
    expect(detectTaskType('change-manager', 'Assess the blast radius of this change')).toBe('risk');
  });

  it('detects five-whys task type', async () => {
    const { detectTaskType } = await import('../openai-config');
    expect(detectTaskType('problem-manager', 'Run five whys analysis')).toBe('five-whys');
  });

  it('returns default for general messages', async () => {
    const { detectTaskType } = await import('../openai-config');
    expect(detectTaskType('incident-manager', 'Show me active incidents')).toBe('default');
  });

  it('returns correct model for task type', async () => {
    const { getModelForTask } = await import('../openai-config');
    // Default models (no env override)
    expect(getModelForTask('routing')).toBe('gpt-4o-mini');
    expect(getModelForTask('chat')).toBeDefined();
    expect(getModelForTask('unknown-type')).toBeDefined(); // Falls back to default
  });
});
