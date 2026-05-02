// ITSM Operations — Static M365 wrappers (Cassidy-pattern port)
//
// Each wrapper follows Cassidy's two-path design:
//   1. If a TurnContext is available, prefer the live MCP server via OBO.
//   2. Otherwise (autonomous / cron / signal-router paths), fall back to
//      direct Microsoft Graph using the GRAPH_APP app-only credential.
//
// This lets the agent act "as the user" inside Teams when it has a real turn
// context, and still operate autonomously the rest of the time. The shape of
// the tool result is stable across both paths so the LLM never has to
// branch on transport.
//
// Reference (Cassidy):
//   https://github.com/ITSpecialist111/Cassidy-Enterprise-Operations-Manager/blob/master/cassidy/src/tools/mcpToolSetup.ts

import type { TurnContext } from '@microsoft/agents-hosting';
import {
  getLiveMcpTools,
  findMcpTool,
  invokeMcpTool,
  getDiscoveredToolNames,
} from './mcp-tool-setup';
import { EmailService, type EmailOptions } from './email-service';
import { postToChannel } from './teams-channel';
import { AutonomousActions, type CalendarAttendee } from './autonomous-actions';

// ---------------------------------------------------------------------------
// Result types (Cassidy parity)
// ---------------------------------------------------------------------------

// ── Cassidy-strict result-source contract ─────────────────────────────────
//   'mcp'            → MCP tool succeeded (preferred path).
//   'graph' / 'graph-webhook' → Autonomous (no TurnContext) Graph fallback.
//   'unavailable'    → Turn request but MCP missing/failed; we DO NOT silently
//                      fall back to Graph for user turns because (a) Graph
//                      app-only acts as a service principal which lacks Application
//                      Access Policies for most user mailboxes (resulting in 403)
//                      and (b) it hides MCP outages from the user. Per the
//                      Cassidy pattern (cassidy/src/tools/mcpToolSetup.ts), the
//                      LLM gets a clear "unavailable — cannot do X without an
//                      active user session" message instead.

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  source: 'mcp' | 'graph' | 'unavailable';
}

export interface TeamsMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
  source: 'mcp' | 'graph-webhook' | 'unavailable';
}

export interface CalendarEventResult {
  success: boolean;
  eventId?: string;
  joinUrl?: string;
  webLink?: string;
  error?: string;
  source: 'mcp' | 'graph' | 'unavailable';
}

export interface FindUserResult {
  success: boolean;
  users: Array<{ displayName: string; email: string; jobTitle?: string; department?: string }>;
  error?: string;
  source: 'mcp' | 'graph' | 'unavailable';
}

export interface PlannerTaskResult {
  success: boolean;
  taskId?: string;
  taskUrl?: string;
  error?: string;
  source: 'mcp' | 'unavailable';
}

export interface MeetingTimeSuggestion {
  start: string;
  end: string;
  confidence?: number;
}
export interface FindMeetingTimesResult {
  success: boolean;
  suggestions: MeetingTimeSuggestion[];
  error?: string;
  source: 'mcp' | 'graph' | 'unavailable';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const emailService = new EmailService();
const actions = new AutonomousActions();

/**
 * Discover MCP tools for this turn (no-op if no TurnContext). Safe to call
 * many times — discovery is cached per process for 5 minutes.
 */
async function ensureMcpDiscovered(context?: TurnContext): Promise<void> {
  if (!context) return;
  try {
    await getLiveMcpTools(context);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[M365] MCP discovery non-fatal: ${msg}`);
  }
}

/**
 * Find the first MCP tool whose name matches one of the provided candidates.
 * The tooling gateway sometimes prefixes tool names (e.g. `mcp_MailTools_sendMail`),
 * sometimes returns bare names (`sendMail`) — we accept both, plus fuzzy /
 * substring matches via `findMcpTool` so renames in the gateway don't silently
 * push us onto the Graph fallback.
 */
function pickMcpTool(candidates: string[]): string | null {
  return findMcpTool(candidates);
}

// ---------------------------------------------------------------------------
// sendEmail — mcp_MailTools → fallback Graph app-only
// ---------------------------------------------------------------------------

export async function sendEmail(
  params: {
    to: string;
    subject: string;
    body: string;
    bodyType?: 'HTML' | 'Text';
    importance?: 'low' | 'normal' | 'high';
    cc?: string[];
    attachments?: EmailOptions['attachments'];
  },
  context?: TurnContext,
): Promise<EmailResult> {
  // ── MCP path (Cassidy-strict for turn requests) ──
  if (context) {
    await ensureMcpDiscovered(context);
    const toolName = pickMcpTool([
      'mcp_MailTools_sendMail',
      'mcp_MailServer_sendMail',
      'mcp_Mail_sendMail',
      'sendMail',
      'sendEmail',
      'mcp_MailTools_send_mail',
    ]);
    if (toolName) {
      try {
        const result = (await invokeMcpTool(toolName, {
          to: params.to,
          subject: params.subject,
          body: params.body,
          importance: params.importance ?? 'normal',
        })) as { messageId?: string };
        console.log(`[M365] sendEmail via MCP "${toolName}" → ${params.to}`);
        return { success: true, messageId: result?.messageId, source: 'mcp' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[M365] sendEmail MCP "${toolName}" failed: ${msg}`);
        return {
          success: false,
          error: `MCP MailTools.sendMail failed: ${msg}. Cannot send email without an active user session.`,
          source: 'unavailable',
        };
      }
    }
    console.warn(
      `[M365] No MCP mail tool discovered (have: ${getDiscoveredToolNames().join(', ') || 'none'})`,
    );
    return {
      success: false,
      error:
        'MCP MailTools unavailable — cannot send email without an active user session. Try again in a moment, or ask an admin to verify the Microsoft Agent 365 mail tool registration.',
      source: 'unavailable',
    };
  }

  // ── Autonomous Graph fallback (no TurnContext) ──
  const result = await emailService.sendEmailAdvanced({
    to: [params.to],
    cc: params.cc,
    subject: params.subject,
    body: params.body,
    bodyType: params.bodyType ?? 'HTML',
    importance: params.importance ?? 'normal',
    attachments: params.attachments,
  });
  return {
    success: result.success,
    messageId: result.messageId,
    error: result.error,
    source: 'graph',
  };
}

// ---------------------------------------------------------------------------
// sendTeamsMessage — mcp_TeamsServer → fallback Graph webhook (channel only)
// ---------------------------------------------------------------------------

export async function sendTeamsMessage(
  params: {
    /** Channel id, chat id, or 1:1 user email — semantics depend on path. */
    target?: string;
    /** Plain text or markdown content. */
    message: string;
    /** Optional subject line (TeamsServer supports it). */
    subject?: string;
    /** "channel" (default) or "chat". MCP-only — Graph fallback is channel-only. */
    surface?: 'channel' | 'chat';
    /** When false, route plain text to channel instead of HTML. */
    isHtml?: boolean;
  },
  context?: TurnContext,
): Promise<TeamsMessageResult> {
  // ── MCP path (Cassidy-strict for turn requests) ──
  if (context) {
    await ensureMcpDiscovered(context);
    const surface = params.surface ?? 'channel';
    const candidates =
      surface === 'chat'
        ? [
            'mcp_TeamsServer_sendChatMessage',
            'mcp_TeamsTools_sendChatMessage',
            'sendChatMessage',
            'sendChat',
            'mcp_TeamsServer_postChatMessage',
            'postChatMessage',
          ]
        : [
            'mcp_TeamsServer_sendChannelMessage',
            'mcp_TeamsTools_sendChannelMessage',
            'sendChannelMessage',
            'postChannelMessage',
            'mcp_TeamsServer_postChannelMessage',
          ];
    const toolName = pickMcpTool(candidates);
    if (toolName) {
      try {
        const args: Record<string, unknown> = {
          content: params.message,
          subject: params.subject,
        };
        if (surface === 'chat') {
          args.chatId = params.target;
        } else {
          args.channelId = params.target;
        }
        const result = (await invokeMcpTool(toolName, args)) as { messageId?: string };
        console.log(`[M365] sendTeamsMessage via MCP "${toolName}" → ${surface}:${params.target}`);
        return { success: true, messageId: result?.messageId, source: 'mcp' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[M365] sendTeamsMessage MCP "${toolName}" failed: ${msg}`);
        return {
          success: false,
          error: `MCP TeamsServer.${surface === 'chat' ? 'sendChatMessage' : 'sendChannelMessage'} failed: ${msg}.`,
          source: 'unavailable',
        };
      }
    }
    // Chat (1:1 / group) requires MCP — there is no Graph webhook equivalent.
    if (surface === 'chat') {
      console.warn(
        `[M365] No MCP TeamsServer chat tool discovered (have: ${getDiscoveredToolNames().join(', ') || 'none'})`,
      );
      return {
        success: false,
        error:
          'MCP TeamsServer chat tool unavailable — cannot send a 1:1/group Teams chat without an active user session.',
        source: 'unavailable',
      };
    }
    // Channel surface but no MCP tool: fall through to webhook (alerts channel).
    console.warn(
      `[M365] No MCP TeamsServer channel tool discovered (have: ${getDiscoveredToolNames().join(', ') || 'none'}); using webhook`,
    );
  }

  // ── Graph webhook fallback (channel-only, fixed alerts channel) ──
  if ((params.surface ?? 'channel') !== 'channel') {
    return {
      success: false,
      error: 'Teams chat (1:1/group) requires an MCP TurnContext — cannot send autonomously.',
      source: 'graph-webhook',
    };
  }
  const res = await postToChannel(params.message, !!params.isHtml);
  return {
    success: res.success,
    error: res.error,
    source: 'graph-webhook',
  };
}

// ---------------------------------------------------------------------------
// scheduleCalendarEvent — mcp_CalendarTools → fallback Graph app-only
// ---------------------------------------------------------------------------

export async function scheduleCalendarEvent(
  params: {
    title: string;
    attendees: string[];
    startDateTime: string;
    endDateTime: string;
    body?: string;
    isOnlineMeeting?: boolean;
    timeZone?: string;
    location?: string;
    organizerEmail?: string;
  },
  context?: TurnContext,
): Promise<CalendarEventResult> {
  // ── MCP path (Cassidy-strict for turn requests) ──
  if (context) {
    await ensureMcpDiscovered(context);
    const toolName = pickMcpTool([
      'mcp_CalendarTools_createEvent',
      'mcp_CalendarServer_createEvent',
      'mcp_Calendar_createEvent',
      'createEvent',
      'createCalendarEvent',
      'createMeeting',
      'scheduleMeeting',
      'mcp_CalendarTools_create_event',
    ]);
    if (toolName) {
      try {
        const result = (await invokeMcpTool(toolName, {
          title: params.title,
          subject: params.title,
          attendees: params.attendees,
          startDateTime: params.startDateTime,
          endDateTime: params.endDateTime,
          start: params.startDateTime,
          end: params.endDateTime,
          body: params.body ?? '',
          isOnlineMeeting: params.isOnlineMeeting ?? true,
          timeZone: params.timeZone,
          location: params.location,
        })) as { eventId?: string; id?: string; joinUrl?: string; webLink?: string };
        console.log(`[M365] scheduleCalendarEvent via MCP "${toolName}" → "${params.title}"`);
        return {
          success: true,
          eventId: result?.eventId ?? result?.id,
          joinUrl: result?.joinUrl,
          webLink: result?.webLink,
          source: 'mcp',
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[M365] scheduleCalendarEvent MCP "${toolName}" failed: ${msg}`);
        return {
          success: false,
          error: `MCP CalendarTools.createEvent failed: ${msg}. Cannot schedule a meeting without an active user session.`,
          source: 'unavailable',
        };
      }
    }
    console.warn(
      `[M365] No MCP calendar tool discovered (have: ${getDiscoveredToolNames().join(', ') || 'none'})`,
    );
    return {
      success: false,
      error:
        'MCP CalendarTools unavailable — cannot schedule a meeting without an active user session. Try again in a moment, or ask an admin to verify the Microsoft Agent 365 calendar tool registration.',
      source: 'unavailable',
    };
  }

  // ── Autonomous Graph fallback (no TurnContext) ──
  const attendees: CalendarAttendee[] = params.attendees.map((email) => ({
    email,
    name: email.split('@')[0],
  }));
  const res = await actions.createCalendarEvent(
    params.title,
    params.startDateTime,
    params.endDateTime,
    attendees,
    params.body ?? '',
    params.isOnlineMeeting ?? true,
    {
      timeZone: params.timeZone,
      location: params.location,
      organizerEmail: params.organizerEmail,
    },
  );
  return {
    success: res.success,
    eventId: res.id,
    joinUrl: res.joinUrl,
    webLink: res.webLink,
    error: res.error,
    source: 'graph',
  };
}

// ---------------------------------------------------------------------------
// findMeetingTimes — mcp_CalendarTools → fallback Graph app-only
// ---------------------------------------------------------------------------

export async function findMeetingTimes(
  params: {
    attendees: string[];
    durationMinutes?: number;
    windowStart?: string;
    windowEnd?: string;
    maxCandidates?: number;
    organizerEmail?: string;
  },
  context?: TurnContext,
): Promise<FindMeetingTimesResult> {
  // ── MCP path (Cassidy-strict for turn requests) ──
  if (context) {
    await ensureMcpDiscovered(context);
    const toolName = pickMcpTool([
      'mcp_CalendarTools_findMeetingTimes',
      'mcp_CalendarServer_findMeetingTimes',
      'mcp_Calendar_findMeetingTimes',
      'findMeetingTimes',
      'mcp_CalendarTools_find_meeting_times',
    ]);
    if (toolName) {
      try {
        const result = (await invokeMcpTool(toolName, {
          attendees: params.attendees,
          durationMinutes: params.durationMinutes ?? 30,
          windowStart: params.windowStart,
          windowEnd: params.windowEnd,
          maxCandidates: params.maxCandidates ?? 5,
        })) as { suggestions?: MeetingTimeSuggestion[] };
        console.log(`[M365] findMeetingTimes via MCP "${toolName}" → ${result?.suggestions?.length ?? 0} suggestion(s)`);
        return { success: true, suggestions: result?.suggestions ?? [], source: 'mcp' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[M365] findMeetingTimes MCP "${toolName}" failed: ${msg}`);
        return {
          success: false,
          suggestions: [],
          error: `MCP CalendarTools.findMeetingTimes failed: ${msg}.`,
          source: 'unavailable',
        };
      }
    }
    console.warn(
      `[M365] No MCP findMeetingTimes tool discovered (have: ${getDiscoveredToolNames().join(', ') || 'none'})`,
    );
    return {
      success: false,
      suggestions: [],
      error:
        'MCP CalendarTools.findMeetingTimes unavailable — cannot find meeting times without an active user session.',
      source: 'unavailable',
    };
  }

  // ── Autonomous Graph fallback (no TurnContext) ──
  const attendees: CalendarAttendee[] = params.attendees.map((email) => ({
    email,
    name: email.split('@')[0],
  }));
  const res = await actions.findMeetingTimes(attendees, params.durationMinutes ?? 30, {
    organizerEmail: params.organizerEmail,
    windowStart: params.windowStart,
    windowEnd: params.windowEnd,
    maxCandidates: params.maxCandidates,
  });
  if (res.success) {
    return { success: true, suggestions: res.suggestions, source: 'graph' };
  }
  return { success: false, suggestions: [], error: res.error, source: 'graph' };
}

// ---------------------------------------------------------------------------
// findUser — MCP people/directory → fallback Microsoft Graph users filter
// ---------------------------------------------------------------------------

let _graphTokenCache: { token: string; expiresAt: number } | null = null;

async function getGraphAppToken(): Promise<string | null> {
  const appId = process.env.GRAPH_APP_ID || process.env.clientId || '';
  const secret = process.env.GRAPH_APP_SECRET || process.env.clientSecret || '';
  const tenantId =
    process.env.GRAPH_TENANT_ID ||
    process.env.MicrosoftAppTenantId ||
    process.env.tenantId ||
    '';
  if (!appId || !secret || !tenantId) return null;

  const now = Date.now();
  if (_graphTokenCache && now < _graphTokenCache.expiresAt - 60_000) return _graphTokenCache.token;

  try {
    const body =
      `client_id=${appId}` +
      `&client_secret=${encodeURIComponent(secret)}` +
      `&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default` +
      `&grant_type=client_credentials`;
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token: string; expires_in: number };
    _graphTokenCache = {
      token: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };
    return data.access_token;
  } catch {
    return null;
  }
}

export async function findUser(
  params: { query: string },
  context?: TurnContext,
): Promise<FindUserResult> {
  // ── MCP path (Cassidy-strict for turn requests) ──
  if (context) {
    await ensureMcpDiscovered(context);
    const toolName = pickMcpTool([
      'mcp_PeopleTools_searchUsers',
      'mcp_DirectoryTools_searchUsers',
      'mcp_People_searchUsers',
      'searchUsers',
      'findUser',
      'findPeople',
    ]);
    if (toolName) {
      try {
        const result = (await invokeMcpTool(toolName, { query: params.query })) as {
          users?: FindUserResult['users'];
        };
        console.log(`[M365] findUser via MCP "${toolName}" → ${result?.users?.length ?? 0} match(es)`);
        return { success: true, users: result?.users ?? [], source: 'mcp' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[M365] findUser MCP "${toolName}" failed: ${msg}`);
        return {
          success: false,
          users: [],
          error: `MCP PeopleTools.searchUsers failed: ${msg}.`,
          source: 'unavailable',
        };
      }
    }
    console.warn(
      `[M365] No MCP findUser tool discovered (have: ${getDiscoveredToolNames().join(', ') || 'none'})`,
    );
    return {
      success: false,
      users: [],
      error:
        'MCP PeopleTools unavailable — cannot resolve users without an active user session.',
      source: 'unavailable',
    };
  }

  // ── Autonomous Graph fallback (no TurnContext) ──
  const token = await getGraphAppToken();
  if (!token) {
    return { success: false, users: [], error: 'No Graph token available', source: 'graph' };
  }
  try {
    const safe = params.query.replace(/'/g, "''").substring(0, 100);
    const q = encodeURIComponent(safe);
    const url =
      `https://graph.microsoft.com/v1.0/users?$filter=` +
      `startsWith(displayName,'${q}') or startsWith(mail,'${q}') or startsWith(userPrincipalName,'${q}')` +
      `&$select=displayName,mail,userPrincipalName,jobTitle,department&$top=10`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, users: [], error: `Graph ${res.status}: ${body}`, source: 'graph' };
    }
    const data = (await res.json()) as {
      value: Array<{
        displayName: string;
        mail?: string;
        userPrincipalName?: string;
        jobTitle?: string;
        department?: string;
      }>;
    };
    const users = data.value.map((u) => ({
      displayName: u.displayName,
      email: u.mail ?? u.userPrincipalName ?? '',
      jobTitle: u.jobTitle ?? undefined,
      department: u.department ?? undefined,
    }));
    return { success: true, users, source: 'graph' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, users: [], error: msg, source: 'graph' };
  }
}

// ---------------------------------------------------------------------------
// createPlannerTask — MCP-only (Graph Planner app-only is not supported)
// ---------------------------------------------------------------------------

export async function createPlannerTask(
  params: {
    title: string;
    assignedTo?: string;
    dueDate?: string;
    bucketName?: string;
    notes?: string;
    priority?: number;
    planId?: string;
  },
  context?: TurnContext,
): Promise<PlannerTaskResult> {
  if (context) {
    await ensureMcpDiscovered(context);
    const toolName = pickMcpTool([
      'mcp_PlannerTools_createTask',
      'mcp_PlannerServer_createTask',
      'mcp_Planner_createTask',
      'createTask',
      'createPlannerTask',
    ]);
    if (toolName) {
      try {
        const result = (await invokeMcpTool(toolName, {
          title: params.title,
          assignedTo: params.assignedTo,
          dueDate: params.dueDate,
          bucketName: params.bucketName,
          notes: params.notes,
          priority: params.priority ?? 5,
          planId: params.planId,
        })) as { taskId?: string; taskUrl?: string };
        console.log(`[M365] createPlannerTask via MCP "${toolName}" → "${params.title}"`);
        return {
          success: true,
          taskId: result?.taskId,
          taskUrl: result?.taskUrl,
          source: 'mcp',
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[M365] createPlannerTask MCP "${toolName}" failed: ${msg}`);
        return { success: false, error: msg, source: 'mcp' };
      }
    }
  }

  // No app-only Graph Planner fallback — Microsoft does not support it.
  return {
    success: false,
    error:
      'Planner requires an active user session (TurnContext) — Microsoft does not support app-only Planner. Ask the user to send the request from Teams.',
    source: 'unavailable',
  };
}

// ---------------------------------------------------------------------------
// updatePlannerTask — MCP-only
// ---------------------------------------------------------------------------

export async function updatePlannerTask(
  params: {
    taskId: string;
    title?: string;
    percentComplete?: number;
    dueDate?: string;
    notes?: string;
  },
  context?: TurnContext,
): Promise<PlannerTaskResult> {
  if (context) {
    await ensureMcpDiscovered(context);
    const toolName = pickMcpTool([
      'mcp_PlannerTools_updateTask',
      'mcp_PlannerServer_updateTask',
      'mcp_Planner_updateTask',
      'updateTask',
      'updatePlannerTask',
    ]);
    if (toolName) {
      try {
        const result = (await invokeMcpTool(toolName, params)) as {
          taskId?: string;
          taskUrl?: string;
        };
        return {
          success: true,
          taskId: result?.taskId ?? params.taskId,
          taskUrl: result?.taskUrl,
          source: 'mcp',
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[M365] updatePlannerTask MCP "${toolName}" failed: ${msg}`);
        return { success: false, error: msg, source: 'mcp' };
      }
    }
  }

  return {
    success: false,
    error: 'Planner requires an active user session (TurnContext).',
    source: 'unavailable',
  };
}
