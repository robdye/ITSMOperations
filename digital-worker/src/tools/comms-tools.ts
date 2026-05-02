// ITSM Communication tools — shared across all workers
// Covers: email (Mail MCP → Graph), Teams channel (Teams MCP → webhook),
// calendar/Teams meeting scheduling (Calendar MCP → Graph), Planner (MCP-only),
// people lookup (Directory MCP → Graph), real .pptx executive briefings.
//
// Each external action prefers the live Microsoft Agent 365 MCP server when a
// user TurnContext is present, and falls back to direct Microsoft Graph for
// autonomous (cron/signal) paths. This mirrors Cassidy's pattern.
//
// Side effects: send_email, send_teams_chat, post_to_channel,
//               schedule_teams_meeting, send_presentation,
//               create_planner_task, update_planner_task

import { tool } from '@openai/agents';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';
import { generateDeck, buildCurrentStateDeckSpec, type SlideSpec } from '../presentation-generator';
import {
  sendEmail,
  sendTeamsMessage,
  scheduleCalendarEvent,
  findMeetingTimes,
  findUser,
  createPlannerTask,
  updatePlannerTask,
} from '../m365-tools';
import { initiateOutboundTeamsCall, isAcsConfigured } from '../voice/acsBridge';
import type { WorkerRunContext } from '../agent-harness';

const mcp = new ItsmMcpClient();

/** Pull the live Microsoft Agents TurnContext that the harness threaded
 * through `runContext.context`. Returns undefined for autonomous runs. */
function getTurnContext(runContext?: RunContext<WorkerRunContext>) {
  return runContext?.context?.turnContext;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEmailBody(body: string): string {
  if (!body || !body.trim()) {
    return '<p>(No content provided)</p>';
  }

  // If the model already produced HTML, keep it untouched.
  if (/<\s*(html|body|p|div|ul|ol|li|table|h[1-6]|br)\b/i.test(body)) {
    return body;
  }

  // Improve common run-on numbered sections: "1) ... 2) ... 3) ..."
  const normalized = body
    .replace(/\r\n/g, '\n')
    .replace(/\s(?=\d+\)\s)/g, '\n')
    .trim();

  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);

  const htmlParts: string[] = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      htmlParts.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      htmlParts.push('</ol>');
      inOl = false;
    }
  };

  for (const rawLine of lines) {
    const line = escapeHtml(rawLine);

    if (/^#{1,3}\s+/.test(rawLine)) {
      closeLists();
      const level = rawLine.startsWith('###') ? 'h3' : rawLine.startsWith('##') ? 'h2' : 'h1';
      htmlParts.push(`<${level}>${escapeHtml(rawLine.replace(/^#{1,3}\s+/, ''))}</${level}>`);
      continue;
    }

    if (/^[•\-*]\s+/.test(rawLine)) {
      if (inOl) {
        htmlParts.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        htmlParts.push('<ul>');
        inUl = true;
      }
      htmlParts.push(`<li>${escapeHtml(rawLine.replace(/^[•\-*]\s+/, ''))}</li>`);
      continue;
    }

    if (/^\d+[\.)]\s+/.test(rawLine)) {
      if (inUl) {
        htmlParts.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        htmlParts.push('<ol>');
        inOl = true;
      }
      htmlParts.push(`<li>${escapeHtml(rawLine.replace(/^\d+[\.)]\s+/, ''))}</li>`);
      continue;
    }

    closeLists();
    htmlParts.push(`<p>${line}</p>`);
  }

  closeLists();

  return `
    <div style="font-family:Segoe UI, Arial, sans-serif; line-height:1.5; color:#1f1f1f;">
      ${htmlParts.join('\n')}
    </div>
  `;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractPriorityCount(text: string, priority: number): string {
  const patterns = [
    new RegExp(`P${priority}[^\\d]{0,30}(\\d+)`, 'i'),
    new RegExp(`Priority\\s*${priority}[^\\d]{0,30}(\\d+)`, 'i'),
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return '0';
}

function tryBuildIncidentOverviewHtml(subject: string, body: string): string | null {
  const isIncidentOverview = /incident\s+overview/i.test(`${subject} ${body}`);
  if (!isIncidentOverview) return null;

  const bodyHasHtml = /<\s*(html|body|p|div|ul|ol|li|table|h[1-6]|br)\b/i.test(body);
  const bodyText = stripHtml(body);

  const p1 = extractPriorityCount(bodyText, 1);
  const p2 = extractPriorityCount(bodyText, 2);
  const p3 = extractPriorityCount(bodyText, 3);
  const p4 = extractPriorityCount(bodyText, 4);
  const p5 = extractPriorityCount(bodyText, 5);

  const normalized = bodyText.replace(/[—–]/g, '-');
  const incidentRegex = /(INC\d+)\s*-\s*([^\n-]{3,120})\s*-\s*([^\n-]{2,40})\s*-\s*([^\n-]{2,60})/gi;
  const incidents: Array<{ number: string; summary: string; state: string; assignment: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = incidentRegex.exec(normalized)) !== null) {
    incidents.push({
      number: match[1],
      summary: match[2].trim(),
      state: match[3].trim(),
      assignment: match[4].trim(),
    });
  }

  const escape = (v: string) => escapeHtml(v || '');
  const generatedAt = new Date().toLocaleString();

  const rows = incidents.slice(0, 12).map((inc) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #ececec;font-weight:600;color:#1f4e79;font-size:13px;">${escape(inc.number)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #ececec;font-size:13px;">${escape(inc.summary)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #ececec;font-size:13px;">${escape(inc.state)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #ececec;font-size:13px;">${escape(inc.assignment)}</td>
      </tr>
    `).join('');

  const narrativeContent = bodyHasHtml
    ? body
    : formatEmailBody(bodyText || body);

  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;background:#f5f7fb;padding:16px;color:#1f2937;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:920px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <tr>
          <td style="background:#c62828;color:#ffffff;padding:14px 18px;">
            <div style="font-size:24px;line-height:1.2;font-weight:700;">🚨 Incident Overview</div>
            <div style="font-size:12px;line-height:1.4;opacity:0.95;">Generated ${escape(generatedAt)}</div>
          </td>
        </tr>

        <tr>
          <td style="padding:14px 14px 8px 14px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;border-spacing:8px;">
              <tr>
                <td style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px;text-align:center;"><div style="font-size:12px;color:#991b1b;font-weight:700;">P1</div><div style="font-size:24px;font-weight:800;color:#b91c1c;">${p1}</div></td>
                <td style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:8px;text-align:center;"><div style="font-size:12px;color:#9a3412;font-weight:700;">P2</div><div style="font-size:24px;font-weight:800;color:#c2410c;">${p2}</div></td>
                <td style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:8px;text-align:center;"><div style="font-size:12px;color:#854d0e;font-weight:700;">P3</div><div style="font-size:24px;font-weight:800;color:#a16207;">${p3}</div></td>
                <td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:8px;text-align:center;"><div style="font-size:12px;color:#1e3a8a;font-weight:700;">P4</div><div style="font-size:24px;font-weight:800;color:#1d4ed8;">${p4}</div></td>
                <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px;text-align:center;"><div style="font-size:12px;color:#334155;font-weight:700;">P5</div><div style="font-size:24px;font-weight:800;color:#475569;">${p5}</div></td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:8px 18px 16px 18px;">
            <h3 style="margin:4px 0 10px 0;font-size:20px;line-height:1.2;color:#111827;">Top Active Incidents</h3>
            ${incidents.length > 0 ? `
              <table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <thead>
                  <tr style="background:#f3f4f6;text-align:left;">
                    <th style="padding:10px 12px;font-size:12px;text-transform:uppercase;color:#374151;">Incident</th>
                    <th style="padding:10px 12px;font-size:12px;text-transform:uppercase;color:#374151;">Summary</th>
                    <th style="padding:10px 12px;font-size:12px;text-transform:uppercase;color:#374151;">State</th>
                    <th style="padding:10px 12px;font-size:12px;text-transform:uppercase;color:#374151;">Assignment</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            ` : '<p style="margin:0 0 8px 0;color:#6b7280;font-size:13px;">No structured incident rows detected; showing summary below.</p>'}

            <div style="margin-top:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa;padding:12px;">
              <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px;">Summary</div>
              ${narrativeContent}
            </div>
          </td>
        </tr>
      </table>
    </div>
  `;
}

export const commsTools = [
  tool({
    name: 'send_email',
    description:
      'Send an email via Microsoft Mail (MCP when a user session is present, Microsoft Graph otherwise). NOTIFY OPERATION — confirm with user before sending. Use for escalations, notifications, and reports.',
    parameters: z.object({
      to: z.string().describe('Recipient email address'),
      subject: z.string().describe('Email subject line'),
      body: z.string().describe('Email body in HTML or plain text'),
    }),
    execute: async ({ to, subject, body }, runContext) => {
      const formattedBody = tryBuildIncidentOverviewHtml(subject, body) || formatEmailBody(body);
      const result = await sendEmail(
        { to, subject, body: formattedBody, bodyType: 'HTML' },
        getTurnContext(runContext as RunContext<WorkerRunContext>),
      );

      if (result.success) {
        return `Email sent to ${to} via ${result.source} with subject "${subject}" (id: ${result.messageId || 'n/a'})`;
      }

      return `Email delivery failed to ${to}: ${result.error || 'unknown error'}`;
    },
  }),

  tool({
    name: 'post_to_channel',
    description:
      'Post a message to the IT Operations alerts channel (Teams MCP when a user session is present, Graph webhook otherwise). NOTIFY OPERATION — confirm with user before posting.',
    parameters: z.object({
      message: z.string().describe('The message to post to the team channel'),
    }),
    execute: async ({ message }, runContext) => {
      try {
        const target = process.env.ITSM_ALERTS_CHANNEL_ID || '';
        const result = await sendTeamsMessage(
          { target, message, surface: 'channel' },
          getTurnContext(runContext as RunContext<WorkerRunContext>),
        );
        if (result.success) {
          return `Message posted to the IT Operations alerts channel via ${result.source}`;
        }
        return `Failed to post to channel: ${result.error || 'unknown error'}`;
      } catch (err) {
        return `Failed to post to channel: ${(err as Error).message || err}`;
      }
    },
  }),

  tool({
    name: 'send_teams_chat',
    description:
      'Send a 1:1 or group Teams chat message (MCP only — requires an active user session). Use this when the user asks Alex to "DM", "chat", or "message" a person on Teams. For channel posts, use post_to_channel instead.',
    parameters: z.object({
      target: z.string().describe('Teams chat id or attendee email (MCP server resolves the chat)'),
      message: z.string().describe('Message body'),
      subject: z.string().optional().describe('Optional subject line'),
    }),
    execute: async ({ target, message, subject }, runContext) => {
      const tc = getTurnContext(runContext as RunContext<WorkerRunContext>);
      if (!tc) {
        return 'Teams chat requires an active user session — ask the user to send the request from Microsoft Teams.';
      }
      const result = await sendTeamsMessage({ target, message, subject, surface: 'chat' }, tc);
      if (result.success) {
        return `Teams chat sent via ${result.source} (id: ${result.messageId || 'n/a'})`;
      }
      return `Teams chat failed: ${result.error || 'unknown error'}`;
    },
  }),

  // ── Calendar & Teams meetings ──
  tool({
    name: 'schedule_teams_meeting',
    description:
      'Schedule a Microsoft Teams meeting / calendar event with the supplied attendees. Use for CAB sessions, incident bridges, RCA reviews, war rooms, and any time the user asks to "set up a call", "schedule a meeting", "book a bridge", or "send a calendar invite". Always sends a Teams join link to attendees by default. NOTIFY OPERATION — confirm with the user before scheduling.',
    parameters: z.object({
      subject: z.string().describe('Meeting subject (e.g. "P1 Incident Bridge — INC0012345")'),
      start: z.string().describe('Start time in ISO 8601, e.g. "2026-05-01T17:00:00"'),
      end: z.string().describe('End time in ISO 8601, e.g. "2026-05-01T17:30:00"'),
      attendees: z.array(z.string()).describe('Attendee email addresses'),
      body: z.string().optional().describe('HTML body / agenda for the invite'),
      timeZone: z.string().optional().describe('IANA time zone for start/end (default UTC)'),
      location: z.string().optional().describe('Optional physical location'),
      isOnlineMeeting: z.boolean().optional().describe('Attach a Teams join link (default true)'),
    }),
    execute: async ({ subject, start, end, attendees, body, timeZone, location, isOnlineMeeting }, runContext) => {
      try {
        const result = await scheduleCalendarEvent(
          {
            title: subject,
            attendees,
            startDateTime: start,
            endDateTime: end,
            body: body || `<p>Scheduled by Alex — IT Operations.</p>`,
            isOnlineMeeting: isOnlineMeeting !== false,
            timeZone,
            location,
          },
          getTurnContext(runContext as RunContext<WorkerRunContext>),
        );
        if (!result.success) {
          return `Meeting scheduling failed: ${result.error || 'unknown error'}`;
        }
        const lines = [
          `Meeting "${subject}" scheduled via ${result.source} for ${start} → ${end} (${timeZone || 'UTC'}) with ${attendees.length} attendee(s).`,
          result.joinUrl ? `Teams join link: ${result.joinUrl}` : null,
          result.webLink ? `Calendar link: ${result.webLink}` : null,
          result.eventId ? `Event id: ${result.eventId}` : null,
        ].filter(Boolean);
        return lines.join('\n');
      } catch (err) {
        return `Meeting scheduling failed: ${(err as Error).message}`;
      }
    },
  }),

  tool({
    name: 'find_meeting_time',
    description:
      'Suggest meeting times that work for the organiser and required attendees. Use this BEFORE schedule_teams_meeting when the user asks to "find a time", "see when people are free", or has not provided an explicit start/end. Returns up to 5 candidate slots with confidence scores.',
    parameters: z.object({
      attendees: z.array(z.string()).describe('Attendee email addresses'),
      durationMinutes: z.number().optional().describe('Meeting duration in minutes (default 30)'),
      windowStart: z.string().optional().describe('Earliest acceptable start time (ISO 8601)'),
      windowEnd: z.string().optional().describe('Latest acceptable end time (ISO 8601)'),
      maxCandidates: z.number().optional().describe('Maximum number of suggestions to return (default 5)'),
    }),
    execute: async ({ attendees, durationMinutes, windowStart, windowEnd, maxCandidates }, runContext) => {
      try {
        const result = await findMeetingTimes(
          { attendees, durationMinutes, windowStart, windowEnd, maxCandidates },
          getTurnContext(runContext as RunContext<WorkerRunContext>),
        );
        if (!result.success) {
          return `Find meeting times failed: ${result.error}`;
        }
        if (result.suggestions.length === 0) {
          return 'No common meeting times were found in the requested window.';
        }
        const lines = result.suggestions.map(
          (s, i) =>
            `${i + 1}. ${s.start} → ${s.end}${
              typeof s.confidence === 'number' ? ` (confidence ${Math.round(s.confidence)}%)` : ''
            }`
        );
        return [`Suggested meeting times (via ${result.source}):`, ...lines].join('\n');
      } catch (err) {
        return `Find meeting times failed: ${(err as Error).message}`;
      }
    },
  }),

  // ── Voice / Teams calling ──
  tool({
    name: 'call_me_on_teams',
    description:
      'Place a Microsoft Teams audio call to the requester (or the named user). Use whenever the user says "call me", "call me on Teams", "ring me", "page me on Teams", or "phone me". Two delivery paths: (1) when Azure Communication Services is configured AND the target Entra Object ID is known, Alex rings the user\'s Teams client directly; (2) otherwise returns a Teams click-to-call deep link the user can tap. NEVER reply with "I cannot place a call" — always invoke this tool.',
    parameters: z.object({
      targetEmail: z
        .string()
        .optional()
        .describe('Optional UPN/email of the person to call. Defaults to the requester.'),
      targetTeamsOid: z
        .string()
        .optional()
        .describe('Optional Entra Object ID of the target. Required for ACS outbound; not needed for click-to-call.'),
      reason: z
        .string()
        .optional()
        .describe('Short reason shown in the call invite. Defaults to a generic "Alex needs you" line.'),
    }),
    execute: async ({ targetEmail, targetTeamsOid, reason }, runContext) => {
      const tc = getTurnContext(runContext as RunContext<WorkerRunContext>);
      const requesterEmail = (runContext as RunContext<WorkerRunContext> | undefined)?.context?.requesterEmail;
      const callee = targetEmail || requesterEmail || process.env.MANAGER_EMAIL || '';
      const callReason = reason || 'Alex needs you on a quick call.';
      const oid = targetTeamsOid || process.env.MANAGER_TEAMS_OID || '';

      // Path 1 — ACS outbound Teams call (Alex actually rings the user).
      if (isAcsConfigured() && oid) {
        try {
          const result = await initiateOutboundTeamsCall({
            teamsUserAadOid: oid,
            requestedBy: callee || undefined,
            reason: callReason,
          });
          return [
            `📞 Calling ${callee || oid} on Teams now (call id ${result.callConnectionId.slice(0, 8)}).`,
            'Answer the incoming Teams call from Alex — IT Operations Manager.',
          ].join('\n');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Fall through to click-to-call link.
          console.warn(`[call_me_on_teams] ACS path failed, returning deep link: ${msg}`);
        }
      }

      // Path 2 — Teams click-to-call deep link.
      const alexUpn = process.env.ALEX_TEAMS_UPN || process.env.GRAPH_MAIL_SENDER || '';
      if (!alexUpn) {
        return 'Cannot start a Teams call — neither ACS nor ALEX_TEAMS_UPN is configured. Configure ACS_CONNECTION_STRING + MANAGER_TEAMS_OID, or set ALEX_TEAMS_UPN to enable the click-to-call link.';
      }
      const teamsCallUrl = `https://teams.microsoft.com/l/call/0/0?users=${encodeURIComponent(alexUpn)}&withVideo=false&source=alex-itops-tool`;

      // Best-effort: post the link to the user via Teams chat / email when we have a session.
      if (tc && callee) {
        try {
          await sendTeamsMessage(
            {
              target: callee,
              subject: '📞 Call Alex on Teams',
              message: `Hi — tap the link to call Alex IT Ops on Teams now.\n\n${teamsCallUrl}\n\nReason: ${callReason}`,
              surface: 'chat',
              isHtml: false,
            },
            tc,
          );
        } catch {
          /* non-fatal */
        }
      }

      return [
        `📞 Tap to call Alex on Teams: ${teamsCallUrl}`,
        callee ? `(I also messaged ${callee} on Teams with the link.)` : '',
        '',
        'Click the link from your phone or desktop Teams client to start the audio call.',
      ]
        .filter(Boolean)
        .join('\n');
    },
  }),

  // ── Executive briefings as real PowerPoint decks ──
  tool({
    name: 'send_presentation',
    description:
      'Generate a real Microsoft PowerPoint (.pptx) deck and email it as an attachment. Use whenever the user asks for a "PowerPoint", "presentation", "slides", "deck", or "slide deck" — never reply with HTML pretending to be slides. The deck is generated from live ITSM telemetry by default; pass explicit slides only when the user provided custom content.',
    parameters: z.object({
      to: z.string().describe('Recipient email address'),
      subject: z.string().describe('Email subject line for the deck'),
      title: z.string().describe('Deck title shown on the cover slide'),
      subtitle: z.string().optional().describe('Optional subtitle (e.g. date or audience)'),
      message: z.string().optional().describe('Short HTML email body to accompany the attachment'),
      slides: z
        .array(
          z.object({
            title: z.string(),
            bullets: z.array(z.string()).optional(),
            body: z.string().optional(),
          })
        )
        .optional()
        .describe('Optional custom slides. When omitted, a current-state briefing is generated from live ITSM data.'),
    }),
    execute: async ({ to, subject, title, subtitle, message, slides }, runContext) => {
      try {
        let deckSpec;
        if (slides && slides.length > 0) {
          deckSpec = {
            title,
            subtitle,
            author: 'Alex — IT Operations Manager',
            company: 'IT Operations',
            slides: slides.map((s) => ({
              title: s.title,
              bullets: s.bullets,
              body: s.body,
            })) as SlideSpec[],
          };
        } else {
          let briefing: any = {};
          try {
            briefing = await mcp.getItsmBriefing();
          } catch {
            briefing = {};
          }
          deckSpec = buildCurrentStateDeckSpec(briefing);
          deckSpec.title = title;
          if (subtitle) deckSpec.subtitle = subtitle;
        }

        const deck = await generateDeck(deckSpec);

        const htmlBody =
          message ||
          `<p>The current-state briefing deck is attached as a PowerPoint file (${(deck.bytes / 1024).toFixed(0)} KB).</p>` +
            `<p>Open <strong>${deck.fileName}</strong> in Microsoft PowerPoint or Microsoft 365.</p>` +
            `<p>— Alex, IT Operations</p>`;

        const result = await sendEmail(
          {
            to,
            subject,
            body: htmlBody,
            bodyType: 'HTML',
            attachments: [
              {
                name: deck.fileName,
                contentBytes: deck.base64,
                contentType: deck.contentType,
              },
            ],
          },
          getTurnContext(runContext as RunContext<WorkerRunContext>),
        );

        if (result.success) {
          return `PowerPoint deck "${deck.fileName}" (${(deck.bytes / 1024).toFixed(0)} KB) emailed to ${to} via ${result.source}.`;
        }
        return `Email delivery failed to ${to}: ${result.error || 'unknown error'}`;
      } catch (err) {
        return `Presentation generation failed: ${(err as Error).message}`;
      }
    },
  }),

  tool({
    name: 'get_current_date',
    description: 'Returns the current date and time.',
    parameters: z.object({}),
    execute: async () => JSON.stringify({ isoDate: new Date().toISOString(), utcString: new Date().toUTCString() }),
  }),

  // ── Directory ──
  tool({
    name: 'find_user',
    description:
      'Look up a person in the organisation directory by name, email, or partial display name. Use this BEFORE send_email or send_teams_chat when you do not have a confirmed email address.',
    parameters: z.object({
      query: z.string().describe('Name, partial name, or email fragment, e.g. "Sarah", "alex.k", "jdoe@".'),
    }),
    execute: async ({ query }, runContext) => {
      const result = await findUser({ query }, getTurnContext(runContext as RunContext<WorkerRunContext>));
      if (!result.success) return `Directory lookup failed: ${result.error || 'unknown error'}`;
      if (result.users.length === 0) return `No users found matching "${query}".`;
      const lines = result.users
        .slice(0, 8)
        .map((u) => `• ${u.displayName} <${u.email}>${u.jobTitle ? ` — ${u.jobTitle}` : ''}${u.department ? ` (${u.department})` : ''}`);
      return [`Found ${result.users.length} user(s) via ${result.source}:`, ...lines].join('\n');
    },
  }),

  // ── Planner (MCP-only — no app-only Graph fallback) ──
  tool({
    name: 'create_planner_task',
    description:
      'Create a new task in Microsoft Planner. Use for follow-ups from incidents/changes/RCAs. NOTIFY OPERATION — requires an active user session.',
    parameters: z.object({
      title: z.string().describe('Task title'),
      assignedTo: z.string().optional().describe('User email or display name to assign to'),
      dueDate: z.string().optional().describe('Due date in ISO format, e.g. "2026-05-15"'),
      bucketName: z.string().optional().describe('Planner bucket name'),
      notes: z.string().optional().describe('Task description / notes'),
      priority: z.number().optional().describe('Priority 0–10 (0=urgent, 5=medium, 10=low)'),
      planId: z.string().optional().describe('Specific plan id (defaults to default plan)'),
    }),
    execute: async (params, runContext) => {
      const result = await createPlannerTask(params, getTurnContext(runContext as RunContext<WorkerRunContext>));
      if (result.success) {
        return `Planner task created via ${result.source}: "${params.title}"${result.taskUrl ? ` — ${result.taskUrl}` : ''}`;
      }
      return `Planner task creation failed: ${result.error}`;
    },
  }),

  tool({
    name: 'update_planner_task',
    description:
      'Update an existing Planner task — change progress, due date, title, or notes. Use 100% complete to mark done.',
    parameters: z.object({
      taskId: z.string().describe('The Planner task id to update'),
      title: z.string().optional(),
      percentComplete: z.number().optional().describe('Completion 0–100'),
      dueDate: z.string().optional().describe('New due date (ISO 8601)'),
      notes: z.string().optional(),
    }),
    execute: async (params, runContext) => {
      const result = await updatePlannerTask(params, getTurnContext(runContext as RunContext<WorkerRunContext>));
      if (result.success) return `Planner task ${params.taskId} updated via ${result.source}.`;
      return `Planner task update failed: ${result.error}`;
    },
  }),
];
