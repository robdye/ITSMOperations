// Phase 4 — a2a-policy smoke tests.
//
// Validates the four reject reasons + happy path. We use the env-var
// surface (A2A_ALLOWED_AGENTS, A2A_SCOPES) to drive policy decisions
// without needing kill-switch / change-freeze module state.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { evaluateInboundA2A, extractA2AContextFromBody } from '../a2a-policy';

describe('a2a-policy: extractA2AContextFromBody', () => {
  it('pulls callerAgentId from a header string', () => {
    const ctx = extractA2AContextFromBody('peer-agent-1', { text: 'incident.lookup INC0001' });
    expect(ctx.callerAgentId).toBe('peer-agent-1');
    expect(ctx.intent).toBe('incident.lookup');
    expect(ctx.preview).toContain('INC0001');
  });

  it('handles missing header and empty body gracefully', () => {
    const ctx = extractA2AContextFromBody(undefined, undefined);
    expect(ctx.callerAgentId).toBeUndefined();
    expect(ctx.intent).toBe('');
  });

  it('takes the first array entry when header is an array', () => {
    const ctx = extractA2AContextFromBody(['peer-1', 'peer-2'], { text: 'change.create' });
    expect(ctx.callerAgentId).toBe('peer-1');
  });
});

describe('a2a-policy: evaluateInboundA2A', () => {
  const originalAllowed = process.env.A2A_ALLOWED_AGENTS;
  const originalScopes = process.env.A2A_AGENT_SCOPES;

  beforeEach(() => {
    delete process.env.A2A_ALLOWED_AGENTS;
    delete process.env.A2A_AGENT_SCOPES;
  });
  afterEach(() => {
    if (originalAllowed === undefined) delete process.env.A2A_ALLOWED_AGENTS;
    else process.env.A2A_ALLOWED_AGENTS = originalAllowed;
    if (originalScopes === undefined) delete process.env.A2A_AGENT_SCOPES;
    else process.env.A2A_AGENT_SCOPES = originalScopes;
  });

  it('rejects with missing-agent-id when no caller is provided', async () => {
    process.env.A2A_ALLOWED_AGENTS = '*';
    const decision = await evaluateInboundA2A({});
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('missing-agent-id');
  });

  it('rejects an agent that is not on the allow-list', async () => {
    process.env.A2A_ALLOWED_AGENTS = 'peer-1,peer-2';
    const decision = await evaluateInboundA2A({ callerAgentId: 'peer-3' });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('agent-not-allowed');
  });

  it('allows a wildcard caller when scopes are unset', async () => {
    process.env.A2A_ALLOWED_AGENTS = '*';
    const decision = await evaluateInboundA2A({ callerAgentId: 'any-peer', intent: 'anything' });
    expect(decision.allow).toBe(true);
    expect(decision.callerAgentId).toBe('any-peer');
  });

  it('rejects on scope-denied when intent is outside the agent\'s scope', async () => {
    process.env.A2A_ALLOWED_AGENTS = 'peer-1';
    process.env.A2A_AGENT_SCOPES = JSON.stringify({ 'peer-1': ['incident.'] });
    const decision = await evaluateInboundA2A({ callerAgentId: 'peer-1', intent: 'change.create' });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe('scope-denied');
  });

  it('allows when intent matches the scoped prefix', async () => {
    process.env.A2A_ALLOWED_AGENTS = 'peer-1';
    process.env.A2A_AGENT_SCOPES = JSON.stringify({ 'peer-1': ['incident.'] });
    const decision = await evaluateInboundA2A({ callerAgentId: 'peer-1', intent: 'incident.lookup' });
    expect(decision.allow).toBe(true);
  });
});
