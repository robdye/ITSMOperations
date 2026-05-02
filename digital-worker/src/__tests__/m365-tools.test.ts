// Test suite for src/m365-tools.ts (MCP-first static M365 wrappers).
//
// Each wrapper has two paths:
//   1) MCP path — when a TurnContext is supplied AND a matching MCP tool is
//      discovered, the wrapper calls invokeMcpTool() and returns source: 'mcp'.
//   2) Graph fallback — otherwise (no context, no MCP tool, or MCP throws),
//      the wrapper falls back to the existing Graph services and returns
//      source: 'graph' (or 'graph-webhook' for Teams channel posts).
//
// We mock both ./mcp-tool-setup (to control MCP availability) and the Graph
// service modules (./email-service, ./teams-channel, ./autonomous-actions) to
// keep the tests deterministic and zero-IO.

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────
// vi.mock is hoisted, so helpers it captures must live inside vi.hoisted().

const {
  getLiveMcpToolsMock,
  hasMcpToolServerMock,
  findMcpToolMock,
  invokeMcpToolMock,
  getDiscoveredToolNamesMock,
  sendEmailAdvancedMock,
  postToChannelMock,
  createCalendarEventMock,
  findMeetingTimesGraphMock,
} = vi.hoisted(() => ({
  // Loose `any` typing — see mcp-tool-setup.test.ts for rationale.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLiveMcpToolsMock: vi.fn(async () => []) as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hasMcpToolServerMock: vi.fn(() => false) as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMcpToolMock: vi.fn(() => null) as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invokeMcpToolMock: vi.fn() as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDiscoveredToolNamesMock: vi.fn(() => [] as string[]) as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendEmailAdvancedMock: vi.fn() as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  postToChannelMock: vi.fn() as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createCalendarEventMock: vi.fn() as ReturnType<typeof vi.fn> & any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMeetingTimesGraphMock: vi.fn() as ReturnType<typeof vi.fn> & any,
}));

vi.mock('../mcp-tool-setup', () => ({
  getLiveMcpTools: getLiveMcpToolsMock,
  hasMcpToolServer: hasMcpToolServerMock,
  findMcpTool: findMcpToolMock,
  invokeMcpTool: invokeMcpToolMock,
  getDiscoveredToolNames: getDiscoveredToolNamesMock,
}));

vi.mock('../email-service', () => ({
  EmailService: class {
    sendEmailAdvanced = sendEmailAdvancedMock;
  },
}));

vi.mock('../teams-channel', () => ({
  postToChannel: postToChannelMock,
}));

vi.mock('../autonomous-actions', () => ({
  AutonomousActions: class {
    createCalendarEvent = createCalendarEventMock;
    findMeetingTimes = findMeetingTimesGraphMock;
  },
}));

vi.mock('@microsoft/agents-hosting', () => ({
  TurnContext: class {},
}));

import {
  sendEmail,
  sendTeamsMessage,
  scheduleCalendarEvent,
  findMeetingTimes,
  findUser,
  createPlannerTask,
  updatePlannerTask,
} from '../m365-tools';

// Minimal context stub — wrappers only check existence + presence of activity.
const fakeContext = {
  activity: { conversation: { tenantId: 'tenant-123' } },
} as unknown as import('@microsoft/agents-hosting').TurnContext;

beforeEach(() => {
  vi.clearAllMocks();
  hasMcpToolServerMock.mockReturnValue(false);
  // Bridge the legacy hasMcpToolServerMock-driven tests to the new findMcpTool
  // contract: findMcpTool returns the first candidate that hasMcpToolServer says
  // it has. Tests can still override findMcpToolMock directly when they want to
  // exercise the fuzzy-match path.
  findMcpToolMock.mockImplementation((candidates: string[]) => {
    for (const name of candidates) {
      if (hasMcpToolServerMock(name)) return name;
    }
    return null;
  });
  getDiscoveredToolNamesMock.mockReturnValue([]);
  // Default: no MCP available; each test opts in by calling
  // hasMcpToolServerMock.mockReturnValueOnce(true) etc.
});

// ─── sendEmail ──────────────────────────────────────────────────────────────

describe('sendEmail', () => {
  it('uses the MCP MailTools tool when discovered (returns source=mcp)', async () => {
    hasMcpToolServerMock.mockImplementation((n: string) => n === 'mcp_MailTools_sendMail');
    invokeMcpToolMock.mockResolvedValueOnce({ messageId: 'mcp-msg-1' });

    const result = await sendEmail(
      { to: 'a@b.com', subject: 'S', body: 'B' },
      fakeContext,
    );

    expect(result).toEqual({ success: true, messageId: 'mcp-msg-1', source: 'mcp' });
    expect(invokeMcpToolMock).toHaveBeenCalledWith(
      'mcp_MailTools_sendMail',
      expect.objectContaining({ to: 'a@b.com', subject: 'S', body: 'B' }),
    );
    expect(sendEmailAdvancedMock).not.toHaveBeenCalled();
  });

  it('returns source=unavailable when no MCP tool is discovered (MCP-first strict, no Graph fallback for turn)', async () => {
    hasMcpToolServerMock.mockReturnValue(false);

    const result = await sendEmail(
      { to: 'a@b.com', subject: 'S', body: 'B' },
      fakeContext,
    );

    expect(result.source).toBe('unavailable');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/MCP MailTools unavailable/i);
    // CRITICAL: Graph app-only must NOT have been called for a user turn
    // (it would 403 in production). The user gets a clear MCP-down error.
    expect(sendEmailAdvancedMock).not.toHaveBeenCalled();
  });

  it('returns source=unavailable when MCP throws (MCP-first strict, no Graph fallback for turn)', async () => {
    hasMcpToolServerMock.mockImplementation((n: string) => n === 'mcp_MailTools_sendMail');
    invokeMcpToolMock.mockRejectedValueOnce(new Error('boom'));

    const result = await sendEmail(
      { to: 'a@b.com', subject: 'S', body: 'B' },
      fakeContext,
    );

    expect(result.source).toBe('unavailable');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/MCP MailTools.sendMail failed.*boom/);
    expect(sendEmailAdvancedMock).not.toHaveBeenCalled();
  });

  it('autonomous path (no context) skips MCP and goes straight to Graph', async () => {
    sendEmailAdvancedMock.mockResolvedValueOnce({ success: true, messageId: 'graph-msg-3' });

    const result = await sendEmail({ to: 'a@b.com', subject: 'S', body: 'B' });

    expect(result.source).toBe('graph');
    expect(getLiveMcpToolsMock).not.toHaveBeenCalled();
    expect(invokeMcpToolMock).not.toHaveBeenCalled();
    expect(sendEmailAdvancedMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces Graph failure with error and source=graph', async () => {
    sendEmailAdvancedMock.mockResolvedValueOnce({ success: false, error: 'denied' });

    const result = await sendEmail({ to: 'a@b.com', subject: 'S', body: 'B' });

    expect(result).toEqual({
      success: false,
      messageId: undefined,
      error: 'denied',
      source: 'graph',
    });
  });
});

// ─── sendTeamsMessage ───────────────────────────────────────────────────────

describe('sendTeamsMessage', () => {
  it('uses MCP TeamsServer for channel sends when discovered (source=mcp)', async () => {
    hasMcpToolServerMock.mockImplementation(
      (n: string) => n === 'mcp_TeamsServer_sendChannelMessage',
    );
    invokeMcpToolMock.mockResolvedValueOnce({ messageId: 'mcp-team-1' });

    const result = await sendTeamsMessage(
      { target: 'channel-1', message: 'hi', surface: 'channel' },
      fakeContext,
    );

    expect(result).toEqual({ success: true, messageId: 'mcp-team-1', source: 'mcp' });
    expect(invokeMcpToolMock).toHaveBeenCalledWith(
      'mcp_TeamsServer_sendChannelMessage',
      expect.objectContaining({ content: 'hi', channelId: 'channel-1' }),
    );
    expect(postToChannelMock).not.toHaveBeenCalled();
  });

  it('uses MCP for chat surface (1:1/group) when discovered', async () => {
    hasMcpToolServerMock.mockImplementation(
      (n: string) => n === 'mcp_TeamsServer_sendChatMessage',
    );
    invokeMcpToolMock.mockResolvedValueOnce({ messageId: 'mcp-chat-1' });

    const result = await sendTeamsMessage(
      { target: 'chat-1', message: 'hi', surface: 'chat' },
      fakeContext,
    );

    expect(result.success).toBe(true);
    expect(invokeMcpToolMock).toHaveBeenCalledWith(
      'mcp_TeamsServer_sendChatMessage',
      expect.objectContaining({ chatId: 'chat-1' }),
    );
  });

  it('refuses chat in autonomous path — no Graph fallback for 1:1 chat', async () => {
    const result = await sendTeamsMessage({
      target: 'chat-x',
      message: 'hi',
      surface: 'chat',
    });

    expect(result).toEqual({
      success: false,
      error: expect.stringMatching(/MCP TurnContext|user session/i),
      source: 'graph-webhook',
    });
    expect(postToChannelMock).not.toHaveBeenCalled();
  });

  it('falls back to Graph webhook for channel posts (autonomous)', async () => {
    postToChannelMock.mockResolvedValueOnce({ success: true });

    const result = await sendTeamsMessage({
      target: 'channel-z',
      message: 'auto-alert',
      surface: 'channel',
    });

    expect(result).toEqual({
      success: true,
      error: undefined,
      source: 'graph-webhook',
    });
    expect(postToChannelMock).toHaveBeenCalledWith('auto-alert', false);
  });
});

// ─── scheduleCalendarEvent ──────────────────────────────────────────────────

describe('scheduleCalendarEvent', () => {
  const baseParams = {
    title: 'Bridge',
    attendees: ['a@b.com'],
    startDateTime: '2026-05-02T17:00:00',
    endDateTime: '2026-05-02T17:30:00',
  };

  it('uses MCP CalendarTools createEvent when discovered (source=mcp)', async () => {
    hasMcpToolServerMock.mockImplementation(
      (n: string) => n === 'mcp_CalendarTools_createEvent',
    );
    invokeMcpToolMock.mockResolvedValueOnce({
      eventId: 'evt-1',
      joinUrl: 'https://teams/join',
      webLink: 'https://outlook/event',
    });

    const result = await scheduleCalendarEvent(baseParams, fakeContext);

    expect(result).toEqual({
      success: true,
      eventId: 'evt-1',
      joinUrl: 'https://teams/join',
      webLink: 'https://outlook/event',
      source: 'mcp',
    });
    expect(createCalendarEventMock).not.toHaveBeenCalled();
  });

  it('returns source=unavailable when MCP throws on a turn request (MCP-first strict, no Graph fallback)', async () => {
    hasMcpToolServerMock.mockImplementation(
      (n: string) => n === 'mcp_CalendarTools_createEvent',
    );
    invokeMcpToolMock.mockRejectedValueOnce(new Error('mcp down'));

    const result = await scheduleCalendarEvent(baseParams, fakeContext);

    expect(result.source).toBe('unavailable');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/MCP CalendarTools\.createEvent failed.*mcp down/);
    // CRITICAL: Graph app-only must NOT have been called for a user turn
    // (this is exactly the path that 403'd on /users/alexitops/events).
    expect(createCalendarEventMock).not.toHaveBeenCalled();
  });

  it('returns source=unavailable when no MCP calendar tool is discovered on a turn', async () => {
    hasMcpToolServerMock.mockReturnValue(false);

    const result = await scheduleCalendarEvent(baseParams, fakeContext);

    expect(result.source).toBe('unavailable');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/MCP CalendarTools unavailable/i);
    expect(createCalendarEventMock).not.toHaveBeenCalled();
  });

  it('autonomous path goes straight to Graph', async () => {
    createCalendarEventMock.mockResolvedValueOnce({
      success: true,
      id: 'g-evt-2',
      joinUrl: 'https://graph/join2',
    });

    const result = await scheduleCalendarEvent(baseParams);

    expect(result.source).toBe('graph');
    expect(result.eventId).toBe('g-evt-2');
    expect(invokeMcpToolMock).not.toHaveBeenCalled();
  });

  // Regression: 2026-05-02 production bug. The gateway returned the calendar
  // tool under a non-canonical name and the wrapper silently fell through to
  // the Graph fallback (which then 403'd). With findMcpTool's fuzzy match,
  // ANY recognisable variant of the calendar tool must be picked up.
  it.each([
    'mcp_CalendarServer_createEvent',
    'mcp_Calendar_createEvent',
    'createEvent',
    'createCalendarEvent',
    'createMeeting',
    'scheduleMeeting',
    'mcp_CalendarTools_create_event',
  ])('uses MCP path when gateway exposes the calendar tool as "%s"', async (gatewayName) => {
    // Simulate the gateway publishing the tool under a non-canonical name.
    findMcpToolMock.mockImplementation((candidates: string[]) =>
      candidates.includes(gatewayName) ? gatewayName : null,
    );
    invokeMcpToolMock.mockResolvedValueOnce({
      eventId: 'evt-fuzzy',
      joinUrl: 'https://teams/join-fuzzy',
    });

    const result = await scheduleCalendarEvent(
      {
        title: 'CAB Review',
        attendees: ['user@contoso.com'],
        startDateTime: '2026-05-04T14:00:00',
        endDateTime: '2026-05-04T15:00:00',
      },
      fakeContext,
    );

    expect(result.source).toBe('mcp');
    expect(result.eventId).toBe('evt-fuzzy');
    // CRITICAL: must NOT have hit the Graph fallback (which 403's in prod).
    expect(createCalendarEventMock).not.toHaveBeenCalled();
  });
});

// ─── findMeetingTimes ───────────────────────────────────────────────────────

describe('findMeetingTimes', () => {
  it('uses MCP CalendarTools findMeetingTimes when discovered', async () => {
    hasMcpToolServerMock.mockImplementation(
      (n: string) => n === 'mcp_CalendarTools_findMeetingTimes',
    );
    invokeMcpToolMock.mockResolvedValueOnce({
      suggestions: [{ start: 'A', end: 'B', confidence: 90 }],
    });

    const result = await findMeetingTimes(
      { attendees: ['a@b.com'], durationMinutes: 30 },
      fakeContext,
    );

    expect(result).toEqual({
      success: true,
      suggestions: [{ start: 'A', end: 'B', confidence: 90 }],
      source: 'mcp',
    });
  });

  it('falls back to Graph when no MCP tool is available', async () => {
    findMeetingTimesGraphMock.mockResolvedValueOnce({
      success: true,
      suggestions: [{ start: 'X', end: 'Y' }],
    });

    const result = await findMeetingTimes({ attendees: ['a@b.com'] });

    expect(result.source).toBe('graph');
    expect(result.suggestions).toEqual([{ start: 'X', end: 'Y' }]);
  });

  it('surfaces Graph failure with empty suggestions', async () => {
    findMeetingTimesGraphMock.mockResolvedValueOnce({
      success: false,
      error: 'no overlap',
    });

    const result = await findMeetingTimes({ attendees: ['a@b.com'] });

    expect(result).toEqual({
      success: false,
      suggestions: [],
      error: 'no overlap',
      source: 'graph',
    });
  });
});

// ─── findUser ────────────────────────────────────────────────────────────────

describe('findUser', () => {
  // findUser uses global fetch for the Graph fallback and reads env for the
  // app-only token. Stub fetch and the relevant env vars per test.
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    process.env.GRAPH_APP_ID = 'app-id';
    process.env.GRAPH_APP_SECRET = 'app-secret';
    process.env.GRAPH_TENANT_ID = 'tenant-x';
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  });

  it('uses MCP people/directory tool when discovered', async () => {
    hasMcpToolServerMock.mockImplementation((n: string) => n === 'mcp_PeopleTools_searchUsers');
    invokeMcpToolMock.mockResolvedValueOnce({
      users: [{ displayName: 'Alex Ops', email: 'alex@x.com' }],
    });

    const result = await findUser({ query: 'Alex' }, fakeContext);

    expect(result.source).toBe('mcp');
    expect(result.success).toBe(true);
    expect(result.users[0].email).toBe('alex@x.com');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('falls back to Graph users filter when MCP is not available', async () => {
    // First fetch: token endpoint. Second fetch: /v1.0/users?$filter=…
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-1', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: [
            {
              displayName: 'Sarah Smith',
              mail: 'sarah@x.com',
              jobTitle: 'PM',
              department: 'Ops',
            },
          ],
        }),
      });

    const result = await findUser({ query: 'Sarah' });

    expect(result.source).toBe('graph');
    expect(result.success).toBe(true);
    expect(result.users[0]).toEqual({
      displayName: 'Sarah Smith',
      email: 'sarah@x.com',
      jobTitle: 'PM',
      department: 'Ops',
    });
  });

  it('returns failure when no Graph token is available', async () => {
    delete process.env.GRAPH_APP_ID;
    delete process.env.clientId;

    const result = await findUser({ query: 'Sarah' });

    expect(result.success).toBe(false);
    expect(result.users).toEqual([]);
    expect(result.error).toMatch(/Graph token/);
  });
});

// ─── Planner (MCP-only) ─────────────────────────────────────────────────────

describe('createPlannerTask', () => {
  it('uses MCP PlannerTools when discovered', async () => {
    hasMcpToolServerMock.mockImplementation((n: string) => n === 'mcp_PlannerTools_createTask');
    invokeMcpToolMock.mockResolvedValueOnce({
      taskId: 'task-1',
      taskUrl: 'https://planner/task/1',
    });

    const result = await createPlannerTask({ title: 'Follow up' }, fakeContext);

    expect(result).toEqual({
      success: true,
      taskId: 'task-1',
      taskUrl: 'https://planner/task/1',
      source: 'mcp',
    });
  });

  it('returns source=unavailable in autonomous mode (no Graph app-only fallback)', async () => {
    const result = await createPlannerTask({ title: 'Follow up' });

    expect(result.success).toBe(false);
    expect(result.source).toBe('unavailable');
    expect(result.error).toMatch(/active user session|TurnContext/);
  });

  it('returns source=mcp with success=false when MCP throws', async () => {
    hasMcpToolServerMock.mockImplementation((n: string) => n === 'mcp_PlannerTools_createTask');
    invokeMcpToolMock.mockRejectedValueOnce(new Error('planner down'));

    const result = await createPlannerTask({ title: 'Follow up' }, fakeContext);

    expect(result.success).toBe(false);
    expect(result.source).toBe('mcp');
    expect(result.error).toBe('planner down');
  });
});

describe('updatePlannerTask', () => {
  it('uses MCP PlannerTools updateTask when discovered', async () => {
    hasMcpToolServerMock.mockImplementation((n: string) => n === 'mcp_PlannerTools_updateTask');
    invokeMcpToolMock.mockResolvedValueOnce({
      taskId: 'task-1',
      taskUrl: 'https://planner/task/1',
    });

    const result = await updatePlannerTask(
      { taskId: 'task-1', percentComplete: 100 },
      fakeContext,
    );

    expect(result).toEqual({
      success: true,
      taskId: 'task-1',
      taskUrl: 'https://planner/task/1',
      source: 'mcp',
    });
  });

  it('returns source=unavailable in autonomous mode', async () => {
    const result = await updatePlannerTask({ taskId: 'task-1', percentComplete: 50 });

    expect(result.success).toBe(false);
    expect(result.source).toBe('unavailable');
  });
});

// ─── MCP-first strict policy: turn requests NEVER fall back to Graph ───────
//
// Locks down the architectural decision: when a user is in a Teams session and
// MCP is unavailable, we surface a clear error rather than silently calling
// Graph app-only (which 403'd in production on /users/alexitops/events).

describe('MCP-first strict policy — turn requests never silently fall back to Graph', () => {
  it('sendTeamsMessage chat: returns unavailable when MCP missing on a turn', async () => {
    hasMcpToolServerMock.mockReturnValue(false);

    const result = await sendTeamsMessage(
      { target: 'chat-x', message: 'hi', surface: 'chat' },
      fakeContext,
    );

    expect(result.source).toBe('unavailable');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/MCP TeamsServer chat tool unavailable/i);
    expect(postToChannelMock).not.toHaveBeenCalled();
  });

  it('sendTeamsMessage chat: returns unavailable when MCP throws on a turn', async () => {
    hasMcpToolServerMock.mockImplementation(
      (n: string) => n === 'mcp_TeamsServer_sendChatMessage',
    );
    invokeMcpToolMock.mockRejectedValueOnce(new Error('chat broken'));

    const result = await sendTeamsMessage(
      { target: 'chat-x', message: 'hi', surface: 'chat' },
      fakeContext,
    );

    expect(result.source).toBe('unavailable');
    expect(result.error).toMatch(/MCP TeamsServer\.sendChatMessage failed.*chat broken/);
  });

  it('findMeetingTimes: returns unavailable when MCP throws on a turn', async () => {
    hasMcpToolServerMock.mockImplementation(
      (n: string) => n === 'mcp_CalendarTools_findMeetingTimes',
    );
    invokeMcpToolMock.mockRejectedValueOnce(new Error('cal down'));

    const result = await findMeetingTimes({ attendees: ['a@b.com'] }, fakeContext);

    expect(result.source).toBe('unavailable');
    expect(result.success).toBe(false);
    expect(result.suggestions).toEqual([]);
    expect(result.error).toMatch(/MCP CalendarTools\.findMeetingTimes failed.*cal down/);
    expect(findMeetingTimesGraphMock).not.toHaveBeenCalled();
  });

  it('findMeetingTimes: returns unavailable when no MCP tool discovered on a turn', async () => {
    hasMcpToolServerMock.mockReturnValue(false);

    const result = await findMeetingTimes({ attendees: ['a@b.com'] }, fakeContext);

    expect(result.source).toBe('unavailable');
    expect(result.error).toMatch(/MCP CalendarTools\.findMeetingTimes unavailable/i);
    expect(findMeetingTimesGraphMock).not.toHaveBeenCalled();
  });

  it('findUser: returns unavailable when MCP throws on a turn', async () => {
    hasMcpToolServerMock.mockImplementation(
      (n: string) => n === 'mcp_PeopleTools_searchUsers',
    );
    invokeMcpToolMock.mockRejectedValueOnce(new Error('graph denied'));

    const result = await findUser({ query: 'sarah' }, fakeContext);

    expect(result.source).toBe('unavailable');
    expect(result.success).toBe(false);
    expect(result.users).toEqual([]);
    expect(result.error).toMatch(/MCP PeopleTools\.searchUsers failed.*graph denied/);
  });

  it('findUser: returns unavailable when no MCP tool discovered on a turn', async () => {
    hasMcpToolServerMock.mockReturnValue(false);

    const result = await findUser({ query: 'sarah' }, fakeContext);

    expect(result.source).toBe('unavailable');
    expect(result.error).toMatch(/MCP PeopleTools unavailable/i);
  });

  it('autonomous calls (no TurnContext) STILL use Graph fallback (sanity)', async () => {
    // This is the contract for option A — only turn requests go strict.
    sendEmailAdvancedMock.mockResolvedValueOnce({ success: true, messageId: 'g-1' });
    const r1 = await sendEmail({ to: 'a@b.com', subject: 'S', body: 'B' });
    expect(r1.source).toBe('graph');

    findMeetingTimesGraphMock.mockResolvedValueOnce({
      success: true,
      suggestions: [{ start: 'A', end: 'B' }],
    });
    const r2 = await findMeetingTimes({ attendees: ['a@b.com'] });
    expect(r2.source).toBe('graph');
  });
});
