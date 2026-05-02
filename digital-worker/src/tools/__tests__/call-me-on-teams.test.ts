// Test suite for the `call_me_on_teams` tool defined in src/tools/comms-tools.ts
//
// Three behaviours we lock down:
//   1. ACS path  — when ACS is configured and a Teams OID is known, the tool
//      invokes initiateOutboundTeamsCall and returns a "calling now" message.
//   2. ACS fallback — when ACS throws, the tool returns the click-to-call
//      deep link instead (and best-effort messages the user on Teams).
//   3. No-ACS / no-OID path — the tool returns the click-to-call deep link
//      without attempting ACS at all.
//
// We mock both ../voice/acsBridge and ../m365-tools so the tests are zero-IO
// and deterministic.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const {
  initiateOutboundTeamsCallMock,
  isAcsConfiguredMock,
  sendTeamsMessageMock,
  sendEmailMock,
  scheduleCalendarEventMock,
  findMeetingTimesMock,
  findUserMock,
  createPlannerTaskMock,
  updatePlannerTaskMock,
} = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initiateOutboundTeamsCallMock: vi.fn() as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  isAcsConfiguredMock: vi.fn(() => false) as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendTeamsMessageMock: vi.fn(async () => ({ success: true, source: 'mcp' })) as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendEmailMock: vi.fn() as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduleCalendarEventMock: vi.fn() as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMeetingTimesMock: vi.fn() as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findUserMock: vi.fn() as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createPlannerTaskMock: vi.fn() as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updatePlannerTaskMock: vi.fn() as ReturnType<typeof vi.fn> & any,
}));

vi.mock('../../voice/acsBridge', () => ({
  initiateOutboundTeamsCall: initiateOutboundTeamsCallMock,
  isAcsConfigured: isAcsConfiguredMock,
}));

vi.mock('../../m365-tools', () => ({
  sendEmail: sendEmailMock,
  sendTeamsMessage: sendTeamsMessageMock,
  scheduleCalendarEvent: scheduleCalendarEventMock,
  findMeetingTimes: findMeetingTimesMock,
  findUser: findUserMock,
  createPlannerTask: createPlannerTaskMock,
  updatePlannerTask: updatePlannerTaskMock,
}));

// Make the @openai/agents tool() helper a passthrough so the tool definitions
// can be enumerated and exercised directly in the test.
vi.mock('@openai/agents', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool: (def: any) => def,
}));

// Avoid pulling in the heavy MCP client.
vi.mock('../../mcp-client', () => ({
  ItsmMcpClient: class {},
}));
vi.mock('../../presentation-generator', () => ({
  generateDeck: vi.fn(),
  buildCurrentStateDeckSpec: vi.fn(),
}));

import { commsTools } from '../../tools/comms-tools';

// Helper to find a tool by name in the exported array.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTool(name: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = (commsTools as any[]).find((t) => t.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

// Minimal RunContext stub that mirrors what agent-harness threads through.
function makeRunContext(opts: { turnContext?: unknown; requesterEmail?: string } = {}) {
  return {
    context: {
      turnContext: opts.turnContext,
      requesterEmail: opts.requesterEmail,
    },
  };
}

describe('call_me_on_teams tool — schema', () => {
  it('is registered and described as a Teams calling tool', () => {
    const t = getTool('call_me_on_teams');
    expect(t.description).toMatch(/teams/i);
    expect(t.description).toMatch(/call/i);
    // Critical: the description must explicitly forbid the "I cannot call"
    // refusal that bit production on 2026-05-02.
    expect(t.description).toMatch(/never reply/i);
  });

  it('declares optional targetEmail / targetTeamsOid / reason parameters', () => {
    const t = getTool('call_me_on_teams');
    // parameters is a Zod schema — sanity-check its shape.
    expect(t.parameters).toBeDefined();
  });
});

describe('call_me_on_teams tool — ACS happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ALEX_TEAMS_UPN;
    delete process.env.GRAPH_MAIL_SENDER;
    delete process.env.MANAGER_TEAMS_OID;
  });

  it('invokes ACS and returns a "calling now" message when configured', async () => {
    isAcsConfiguredMock.mockReturnValue(true);
    initiateOutboundTeamsCallMock.mockResolvedValueOnce({
      callConnectionId: 'abcdef0123456789',
      serverCallId: 'srv-1',
    });

    const t = getTool('call_me_on_teams');
    const out = await t.execute(
      {
        targetEmail: 'user@contoso.com',
        targetTeamsOid: 'oid-xyz-789',
        reason: 'Major incident bridge',
      },
      makeRunContext({ requesterEmail: 'user@contoso.com' }),
    );

    expect(initiateOutboundTeamsCallMock).toHaveBeenCalledWith({
      teamsUserAadOid: 'oid-xyz-789',
      requestedBy: 'user@contoso.com',
      reason: 'Major incident bridge',
    });
    expect(out).toMatch(/Calling user@contoso.com on Teams now/);
    // First 8 chars of the call connection id appear in the response.
    expect(out).toMatch(/abcdef01/);
  });

  it('uses MANAGER_TEAMS_OID env when targetTeamsOid arg omitted', async () => {
    process.env.MANAGER_TEAMS_OID = 'env-oid-fallback';
    isAcsConfiguredMock.mockReturnValue(true);
    initiateOutboundTeamsCallMock.mockResolvedValueOnce({
      callConnectionId: '0011223344556677',
    });

    const t = getTool('call_me_on_teams');
    await t.execute({}, makeRunContext({ requesterEmail: 'user@contoso.com' }));

    expect(initiateOutboundTeamsCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ teamsUserAadOid: 'env-oid-fallback' }),
    );
  });
});

describe('call_me_on_teams tool — click-to-call deep link path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MANAGER_TEAMS_OID;
    process.env.ALEX_TEAMS_UPN = 'alexitops@contoso.com';
  });

  it('falls back to the deep link when ACS is not configured', async () => {
    isAcsConfiguredMock.mockReturnValue(false);

    const t = getTool('call_me_on_teams');
    const out = await t.execute(
      { targetEmail: 'user@contoso.com' },
      makeRunContext({ requesterEmail: 'user@contoso.com' }),
    );

    expect(initiateOutboundTeamsCallMock).not.toHaveBeenCalled();
    expect(out).toMatch(/teams\.microsoft\.com\/l\/call\/0\/0/);
    expect(out).toMatch(/users=alexitops%40contoso\.com/);
  });

  it('falls back to the deep link when no Teams OID is available', async () => {
    isAcsConfiguredMock.mockReturnValue(true); // ACS up, but no OID
    delete process.env.MANAGER_TEAMS_OID;

    const t = getTool('call_me_on_teams');
    const out = await t.execute({}, makeRunContext({ requesterEmail: 'user@contoso.com' }));

    expect(initiateOutboundTeamsCallMock).not.toHaveBeenCalled();
    expect(out).toMatch(/teams\.microsoft\.com\/l\/call/);
  });

  it('falls back to the deep link when ACS createCall throws', async () => {
    isAcsConfiguredMock.mockReturnValue(true);
    initiateOutboundTeamsCallMock.mockRejectedValueOnce(new Error('ACS quota exceeded'));

    const t = getTool('call_me_on_teams');
    const out = await t.execute(
      { targetEmail: 'user@contoso.com', targetTeamsOid: 'oid-x' },
      makeRunContext({ requesterEmail: 'user@contoso.com' }),
    );

    expect(initiateOutboundTeamsCallMock).toHaveBeenCalledTimes(1);
    expect(out).toMatch(/teams\.microsoft\.com\/l\/call/);
  });

  it('best-effort messages the requester via Teams chat when there is a TurnContext', async () => {
    isAcsConfiguredMock.mockReturnValue(false);
    const fakeTc = { activity: { conversation: { tenantId: 't1' } } };

    const t = getTool('call_me_on_teams');
    await t.execute(
      { targetEmail: 'user@contoso.com' },
      makeRunContext({ turnContext: fakeTc, requesterEmail: 'user@contoso.com' }),
    );

    expect(sendTeamsMessageMock).toHaveBeenCalledTimes(1);
    const [args] = sendTeamsMessageMock.mock.calls[0];
    expect(args.target).toBe('user@contoso.com');
    expect(args.surface).toBe('chat');
    expect(args.message).toMatch(/teams\.microsoft\.com\/l\/call/);
  });

  it('does not crash when sendTeamsMessage throws', async () => {
    isAcsConfiguredMock.mockReturnValue(false);
    sendTeamsMessageMock.mockRejectedValueOnce(new Error('chat unavailable'));
    const fakeTc = { activity: { conversation: { tenantId: 't1' } } };

    const t = getTool('call_me_on_teams');
    const out = await t.execute(
      {},
      makeRunContext({ turnContext: fakeTc, requesterEmail: 'user@contoso.com' }),
    );

    expect(out).toMatch(/teams\.microsoft\.com\/l\/call/);
  });
});

describe('call_me_on_teams tool — misconfiguration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ALEX_TEAMS_UPN;
    delete process.env.GRAPH_MAIL_SENDER;
    delete process.env.MANAGER_TEAMS_OID;
  });

  it('returns a configuration error when neither ACS nor a click-to-call UPN is set', async () => {
    isAcsConfiguredMock.mockReturnValue(false);

    const t = getTool('call_me_on_teams');
    const out = await t.execute(
      { targetEmail: 'user@contoso.com' },
      makeRunContext({ requesterEmail: 'user@contoso.com' }),
    );

    expect(out).toMatch(/Cannot start a Teams call/i);
    expect(out).toMatch(/configure/i);
  });
});
