// Test suite for src/agent-harness.ts — verifies the WorkerRunContext
// (TurnContext + identity) is threaded into the @openai/agents `run()` call so
// tool execute() handlers can read `runContext.context.turnContext` to
// mint OBO tokens for the Microsoft Agent 365 MCP servers.
//
// We mock the heavy SDK surfaces (`@openai/agents`) and the project's
// reasoning-trace, openai-config, and copilot-tuning helpers so we can assert
// purely on the contract: what gets passed where.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks BEFORE the import ────────────────────────────────────────────────
// vi.mock is hoisted; helpers it references must live inside vi.hoisted().

const { runMock, FakeAgent } = vi.hoisted(() => {
  class HoistedFakeAgent {
    tools: unknown[] = [];
    on?: (event: string, handler: (...args: unknown[]) => void) => void = undefined;
  }
  return {
    runMock: vi.fn(async () => ({ finalOutput: 'ok' })),
    FakeAgent: HoistedFakeAgent,
  };
});

vi.mock('@openai/agents', () => ({
  Agent: FakeAgent,
  OpenAIChatCompletionsModel: class {
    constructor(public client: unknown, public name: string) {}
  },
  run: runMock,
  // The tools/* modules transitively imported by agent-harness call
  // `tool({...})` at module load time. Stub it as an identity-ish factory
  // so those imports don't blow up.
  tool: (def: unknown) => def,
}));

vi.mock('../openai-config', () => ({
  getModelName: () => 'gpt-test',
  isAzureOpenAI: () => false,
  getOpenAIClient: () => ({ mock: 'client' }),
  getModelForTask: () => 'gpt-test',
  detectTaskType: () => 'general',
}));

vi.mock('../copilot-tuning', () => ({
  getTunedModel: () => null,
}));

vi.mock('../hitl', () => ({
  classifyTool: () => ({ level: 'read', requiresConfirmation: false }),
}));

vi.mock('../reasoning-trace', () => ({
  logToolCall: vi.fn(),
  logToolResult: vi.fn(),
  logError: vi.fn(),
  logOutcome: vi.fn(),
  startConversation: () => 'conv-1',
}));

vi.mock('@microsoft/agents-hosting', () => ({
  TurnContext: class {},
}));

import { runWorker, type WorkerDefinition, type PromptContext } from '../agent-harness';

const fakeWorker: WorkerDefinition = {
  id: 'incident-manager',
  name: 'Incident Manager',
  itilPractice: 'Incident Management',
  instructions: 'You are a worker.',
  tools: [],
};

const fakeTurnContext = {
  activity: { conversation: { tenantId: 'tenant-test' } },
} as unknown as import('@microsoft/agents-hosting').TurnContext;

beforeEach(() => {
  runMock.mockClear();
});

describe('runWorker — context threading', () => {
  it('passes WorkerRunContext (with turnContext) to run()', async () => {
    const ctx: PromptContext = {
      userMessage: 'Show P1s',
      displayName: 'Robert',
      requesterEmail: 'robert@example.com',
      turnContext: fakeTurnContext,
    };
    const out = await runWorker(fakeWorker, 'Show P1 incidents', ctx);

    expect(out.output).toBe('ok');
    expect(out.workerId).toBe('incident-manager');
    expect(runMock).toHaveBeenCalledTimes(1);

    // runMock is a `vi.fn()` with no signature so .mock.calls[0] types as
    // `[]`; cast to the actual SDK shape we know runWorker uses.
    const [, prompt, options] = runMock.mock.calls[0] as unknown as [
      unknown,
      string,
      { context: Record<string, unknown> },
    ];
    expect(prompt).toContain('Show P1 incidents');
    expect(options).toEqual({
      context: {
        turnContext: fakeTurnContext,
        displayName: 'Robert',
        requesterEmail: 'robert@example.com',
      },
    });
  });

  it('threads undefined turnContext when run autonomously (cron / signal-router)', async () => {
    const out = await runWorker(fakeWorker, 'Auto-handle this signal');

    expect(out.output).toBe('ok');
    const [, , options] = runMock.mock.calls[0] as unknown as [
      unknown,
      string,
      { context: { turnContext?: unknown } },
    ];
    expect(options.context.turnContext).toBeUndefined();
  });

  it('returns a structured error on run() failure', async () => {
    runMock.mockRejectedValueOnce(new Error('LLM exploded'));

    const out = await runWorker(fakeWorker, 'whatever');

    expect(out.workerId).toBe('incident-manager');
    expect(out.output).toMatch(/LLM exploded/);
  });
});
