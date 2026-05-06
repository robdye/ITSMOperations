// ITSM Operations — Voice (Realtime) tool registry
//
// The Foundry Realtime WS supports OpenAI-compatible function calling
// via `tools` on session.update. This module defines the JSON-Schema
// tool list we expose to Alex during a live ACS call AND the executor
// that runs them when the model emits
// `response.function_call_arguments.done`.
//
// Goal: voice mode must mirror Teams-chat capability. Alex on the phone
// can do everything she can do in chat — send PowerPoints, send documents,
// post Teams messages, DM 1:1, look up runbooks, find SMEs, query SNOW,
// run blast-radius analysis, etc.
//
// Voice-side execution path (no Bot Framework turnContext):
//   - email   → m365-services.sendEmail (autonomous Graph fallback)
//   - channel → m365-services.sendTeamsMessage (Graph webhook fallback)
//   - DM 1:1  → Graph /chats (with email fallback when perms missing)
//   - .pptx   → presentation-generator.generateDeck() → email attachment
//   - docs    → doc-generator → email attachment
//   - SNOW    → ItsmMcpClient
//   - M365 IQ → workiq-client (search docs, find runbooks, lookup people)
//
// Errors are *returned* as strings so the model speaks them back to the
// caller — they do NOT throw.

import { sendEmail, sendTeamsMessage } from '../m365-services';
import { ItsmMcpClient } from '../mcp-client';
import { getWorkIqClient } from '../workiq-client';
import { logAuditEntry } from '../audit-trail';
import {
  generateDeck,
  buildCurrentStateDeckSpec,
  type DeckSpec,
} from '../presentation-generator';
import { DocGenerator } from '../doc-generator';

const mcp = new ItsmMcpClient();
const workiq = getWorkIqClient();
const docGen = new DocGenerator();

export interface RealtimeFunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** JSON-Schema tool definitions for Realtime session.update */
export const VOICE_TOOLS: RealtimeFunctionTool[] = [
  // ────────────────────────────────────────────────────────────────────
  // Communications — email, channel post, 1:1 Teams chat, attachments
  // ────────────────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'send_email',
    description:
      'Send an email on behalf of the caller. Optionally attaches a single inline document (text/markdown/HTML). For PowerPoint decks use send_briefing_deck. For RFC docs use send_change_rfc_document.',
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description:
            'Recipient email address. If the caller says "email me" or "send to me" use the configured manager email — leave blank or set to "me" and the tool resolves it.',
        },
        cc: {
          type: 'string',
          description: 'Optional comma-separated CC list.',
        },
        subject: { type: 'string', description: 'Subject line — short and specific.' },
        body: {
          type: 'string',
          description: 'Email body. May contain HTML (<p>, <ul>, <a href="...">). Be concise.',
        },
        attachment_filename: {
          type: 'string',
          description:
            'Optional. If you want to attach a generated document (e.g. "incident-summary.md", "runbook.html"), set the filename here.',
        },
        attachment_text: {
          type: 'string',
          description:
            'Optional. The text content of the attachment (markdown / HTML / plain text). Required if attachment_filename is set.',
        },
        attachment_content_type: {
          type: 'string',
          description:
            'Optional MIME type of the attachment. Defaults to text/markdown for .md, text/html for .html, otherwise text/plain.',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    type: 'function',
    name: 'send_briefing_deck',
    description:
      'Generate a real PowerPoint (.pptx) "Current State" briefing deck from the live ITSM data and email it to the caller as an attachment. Use this when the human asks "send me a deck", "send me a briefing", "PowerPoint summary", or "presentation".',
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address. Blank or "me" → configured manager email.',
        },
        subject: {
          type: 'string',
          description: 'Optional subject line. Defaults to "ITSM Operations — Current State Briefing".',
        },
        title: {
          type: 'string',
          description: 'Optional deck title shown on the cover slide.',
        },
        notes: {
          type: 'string',
          description: 'Optional verbal context / rationale to include in the email body (1–3 sentences).',
        },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'send_change_rfc_document',
    description:
      'Generate a Request-for-Change (RFC) document from a ServiceNow change record and email it to the caller as a .md attachment. Use when the human asks "send me the RFC for CHG…" or "email me the change paperwork".',
    parameters: {
      type: 'object',
      properties: {
        change_number: {
          type: 'string',
          description: 'ServiceNow change number, e.g. "CHG0000123".',
        },
        to: {
          type: 'string',
          description: 'Recipient email. Blank → manager email.',
        },
        notes: {
          type: 'string',
          description: 'Optional context to include in the email body.',
        },
      },
      required: ['change_number'],
    },
  },
  {
    type: 'function',
    name: 'post_to_channel',
    description:
      'Post a status message to the IT Operations alerts Teams channel. Use to broadcast incident updates, decisions reached on the bridge, or new actions assigned.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'HTML or plain-text message to post. Keep it under ~300 chars.',
        },
      },
      required: ['message'],
    },
  },
  {
    type: 'function',
    name: 'send_teams_chat_message',
    description:
      'Send a 1:1 Teams chat message (DM) to a specific person. Use when the caller says "Teams chat me", "send me a Teams message", or "DM <person>". Falls back to email automatically if Teams chat permissions are not granted to the app.',
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description:
            'Email address or AAD object id of the recipient. Blank or "me" → configured manager.',
        },
        message: {
          type: 'string',
          description: 'Message body. Plain text or simple HTML.',
        },
      },
      required: ['message'],
    },
  },

  // ────────────────────────────────────────────────────────────────────
  // ServiceNow — read & write
  // ────────────────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'show_itsm_briefing',
    description:
      'Get the comprehensive ITSM operations briefing — incidents, problems, changes, SLAs, and key metrics. Use to answer "what is going on?" or "give me a status read".',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'update_incident',
    description:
      'Add a work note (and optionally change state / assignee) on a ServiceNow incident. Use to record decisions made on the call.',
    parameters: {
      type: 'object',
      properties: {
        sys_id: { type: 'string', description: 'ServiceNow sys_id of the incident.' },
        work_notes: { type: 'string', description: 'Work note to append.' },
        state: { type: 'string', description: 'Optional new state.' },
      },
      required: ['sys_id', 'work_notes'],
    },
  },
  {
    type: 'function',
    name: 'create_incident',
    description: 'Open a new ServiceNow incident from the call.',
    parameters: {
      type: 'object',
      properties: {
        short_description: { type: 'string', description: 'One-line summary.' },
        description: { type: 'string', description: 'Detail — what / where / impact.' },
        priority: { type: 'string', description: '"1" critical … "4" low.' },
        category: { type: 'string', description: 'Incident category, e.g. Network, Security.' },
      },
      required: ['short_description'],
    },
  },
  {
    type: 'function',
    name: 'get_incidents',
    description:
      'Read open incidents from ServiceNow with optional filters. Use to answer "what P1s are open?" or "what is INC0012345 currently showing?"',
    parameters: {
      type: 'object',
      properties: {
        priority: { type: 'string' },
        state: { type: 'string' },
        assignment_group: { type: 'string' },
      },
      required: [],
    },
  },
  {
    type: 'function',
    name: 'show_incident_dashboard',
    description: 'Get the live incident dashboard — open P1/P2/P3/P4 counts and trends.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'show_problem_dashboard',
    description: 'Show the problem dashboard — open problems, known errors, RCA status.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'show_change_dashboard',
    description: 'Show the change dashboard — open changes with risk scores and approval status.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'show_change_request',
    description: 'Get details for a specific change request by number.',
    parameters: {
      type: 'object',
      properties: { number: { type: 'string', description: 'e.g. "CHG0000001"' } },
      required: ['number'],
    },
  },
  {
    type: 'function',
    name: 'show_blast_radius',
    description: 'Analyse the blast radius of a CI — affected dependents and business services.',
    parameters: {
      type: 'object',
      properties: { ci_name: { type: 'string', description: 'Configuration item name.' } },
      required: ['ci_name'],
    },
  },
  {
    type: 'function',
    name: 'show_sla_dashboard',
    description: 'SLA compliance dashboard — breaches, at-risk tickets, compliance by priority.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    type: 'function',
    name: 'get_cmdb_ci',
    description: 'Look up a configuration item in the CMDB by name.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'CI name to look up' } },
      required: ['name'],
    },
  },
  {
    type: 'function',
    name: 'search_knowledge',
    description: 'Search the ServiceNow knowledge base for articles matching a query.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'check_eol_status',
    description:
      'Check end-of-life status for a product/version (uses endoflife.date). Use when the human asks "is X still supported?" or "when does Y go EoL?"',
    parameters: {
      type: 'object',
      properties: {
        product: { type: 'string', description: 'e.g. "nodejs", "windows", "ubuntu"' },
        version: { type: 'string', description: 'e.g. "18", "11", "22.04"' },
      },
      required: ['product', 'version'],
    },
  },

  // ────────────────────────────────────────────────────────────────────
  // M365 / WorkIQ — emails, docs, runbooks, people
  // ────────────────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'find_runbook',
    description:
      'Find an operational runbook in SharePoint/OneDrive for a system. Returns links the caller can open. Use when caller says "find me the runbook for X" or "what is the procedure for Y?"',
    parameters: {
      type: 'object',
      properties: { system: { type: 'string', description: 'System name, e.g. "SAP ERP"' } },
      required: ['system'],
    },
  },
  {
    type: 'function',
    name: 'search_m365_documents',
    description:
      'Search SharePoint and OneDrive for documents. Use to surface architecture diagrams, DR plans, change docs.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Document search query' } },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: 'lookup_person_m365',
    description:
      'Look up a person in M365 (role, dept, manager, contact). Use for escalation paths.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Person name' } },
      required: ['name'],
    },
  },
  {
    type: 'function',
    name: 'find_subject_matter_expert',
    description: 'Find the SME for a system or topic based on M365 activity.',
    parameters: {
      type: 'object',
      properties: { topic: { type: 'string', description: 'System or topic' } },
      required: ['topic'],
    },
  },
  {
    type: 'function',
    name: 'query_m365',
    description:
      'Ask any natural-language question about M365 data — emails, meetings, documents, Teams messages, people. Use as a fallback for general M365 questions.',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: 'Natural-language question' } },
      required: ['question'],
    },
  },

  // ────────────────────────────────────────────────────────────────────
  // Utility
  // ────────────────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'get_current_date',
    description: 'Returns current UTC date and time.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

/** Resolve "me" / "myself" / blanks → configured manager mailbox. */
function resolveSelfEmail(addr: string | undefined): string {
  const fallback = process.env.MANAGER_EMAIL || process.env.OWNER_EMAIL || '';
  if (!addr) return fallback;
  const trimmed = addr.trim();
  if (!trimmed) return fallback;
  if (/^(me|myself|self|the manager|robert|robert dye)$/i.test(trimmed)) return fallback;
  return trimmed;
}

/** Pick a sensible MIME type for a generated text attachment based on filename. */
function inferContentType(fileName: string, fallback?: string): string {
  if (fallback) return fallback;
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.csv')) return 'text/csv';
  return 'text/plain';
}

/** Get a Graph app-only token reusing the same env vars as email-service.ts. */
let _voiceGraphToken: { token: string; expiresAt: number } | null = null;
async function getGraphAppToken(): Promise<string | null> {
  const appId = process.env.GRAPH_APP_ID || process.env.clientId || '';
  const secret = process.env.GRAPH_APP_SECRET || process.env.clientSecret || '';
  const tenant =
    process.env.GRAPH_TENANT_ID || process.env.MicrosoftAppTenantId || process.env.tenantId || '';
  if (!appId || !secret || !tenant) return null;
  const now = Date.now();
  if (_voiceGraphToken && now < _voiceGraphToken.expiresAt - 60000) return _voiceGraphToken.token;
  const body =
    `client_id=${appId}` +
    `&client_secret=${encodeURIComponent(secret)}` +
    `&scope=${encodeURIComponent('https://graph.microsoft.com/.default')}` +
    `&grant_type=client_credentials`;
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token: string; expires_in: number };
  _voiceGraphToken = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return data.access_token;
}

/** Resolve a recipient (email or AAD OID) to an AAD user object id via Graph. */
async function resolveAadUserId(addrOrOid: string, token: string): Promise<string | null> {
  const trimmed = addrOrOid.trim();
  // Already looks like a GUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return trimmed;
  }
  try {
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(trimmed)}?$select=id`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string };
    return data.id || null;
  } catch {
    return null;
  }
}

/**
 * Execute a Realtime function-call.
 * `argsJson` is the raw `arguments` string from `response.function_call_arguments.done`.
 * Always returns a short string to be sent back as `function_call_output`.
 */
export async function executeVoiceTool(
  name: string,
  argsJson: string,
  context: { callConnectionId?: string; managerEmail?: string },
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return `error: tool arguments were not valid JSON: ${argsJson.slice(0, 120)}`;
  }

  const audit = (resultSummary: string, riskLevel: 'read' | 'write' | 'notify' = 'write') =>
    logAuditEntry({
      workerId: 'voice-bridge',
      workerName: 'ACS Voice Bridge',
      toolName: `voice.${name}`,
      riskLevel,
      triggeredBy: context.callConnectionId || 'voice',
      triggerType: 'delegation',
      parameters: JSON.stringify(args).slice(0, 800),
      resultSummary: resultSummary.slice(0, 400),
      requiredConfirmation: false,
      durationMs: 0,
    }).catch(() => {});

  try {
    switch (name) {
      case 'send_email': {
        const to = resolveSelfEmail(args.to as string | undefined);
        const subject = String(args.subject || '(no subject)');
        const body = String(args.body || '');
        if (!to) return 'error: no recipient and no MANAGER_EMAIL configured';
        const cc = args.cc
          ? String(args.cc)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined;
        // Optional inline attachment from text content
        let attachments:
          | Array<{ name: string; contentBytes: string; contentType: string }>
          | undefined;
        const attName = args.attachment_filename ? String(args.attachment_filename) : '';
        const attText = args.attachment_text ? String(args.attachment_text) : '';
        if (attName && attText) {
          attachments = [
            {
              name: attName,
              contentBytes: Buffer.from(attText, 'utf8').toString('base64'),
              contentType: inferContentType(
                attName,
                args.attachment_content_type ? String(args.attachment_content_type) : undefined,
              ),
            },
          ];
        }
        const result = await sendEmail({ to, cc, subject, body, bodyType: 'HTML', attachments });
        const summary = result.success
          ? `email sent to ${to}${attachments ? ` with attachment ${attName}` : ''} via ${result.source}`
          : `email failed: ${result.error || 'unknown'}`;
        audit(summary, result.success ? 'write' : 'notify');
        return summary;
      }

      case 'send_briefing_deck': {
        const to = resolveSelfEmail(args.to as string | undefined);
        if (!to) return 'error: no recipient and no MANAGER_EMAIL configured';
        const subject = String(args.subject || 'ITSM Operations — Current State Briefing');
        const notes = args.notes ? String(args.notes) : '';
        let briefing: unknown = {};
        try {
          briefing = await mcp.getItsmBriefing();
        } catch (err) {
          // Build the deck on a thin briefing so we still ship something
          briefing = { error: (err as Error).message };
        }
        const spec: DeckSpec = buildCurrentStateDeckSpec(briefing, {
          author: 'Alex — IT Operations Manager',
          company: process.env.COMPANY_NAME || 'IT Operations',
        });
        if (args.title) spec.title = String(args.title);
        const deck = await generateDeck(spec);
        const bodyHtml =
          `<p>Hi — here is the current-state ITSM briefing deck you asked for on the call.</p>` +
          (notes ? `<p>${notes}</p>` : '') +
          `<p>Slides: ${spec.slides.length} · File: <strong>${deck.fileName}</strong> (${Math.round(deck.bytes / 1024)} KB)</p>` +
          `<p>— Alex (IT Operations Manager)</p>`;
        const result = await sendEmail({
          to,
          subject,
          body: bodyHtml,
          bodyType: 'HTML',
          attachments: [
            {
              name: deck.fileName,
              contentBytes: deck.base64,
              contentType: deck.contentType,
            },
          ],
        });
        const summary = result.success
          ? `PowerPoint briefing emailed to ${to} (${deck.fileName}, ${Math.round(deck.bytes / 1024)} KB) via ${result.source}`
          : `briefing-deck email failed: ${result.error || 'unknown'}`;
        audit(summary, result.success ? 'write' : 'notify');
        return summary;
      }

      case 'send_change_rfc_document': {
        const number = String(args.change_number || '').trim();
        if (!number) return 'error: change_number required';
        const to = resolveSelfEmail(args.to as string | undefined);
        if (!to) return 'error: no recipient and no MANAGER_EMAIL configured';
        const notes = args.notes ? String(args.notes) : '';
        // Pull change record from SNOW
        let change: Record<string, unknown> = {};
        try {
          const r = (await mcp.getChangeRequest(number)) as Record<string, unknown> | undefined;
          change = r || {};
        } catch (err) {
          return `error: could not fetch ${number}: ${(err as Error).message}`;
        }
        const get = (k: string, fallback = '') => String((change[k] as string | undefined) ?? fallback);
        const riskScoreRaw = (change.risk_score ?? change.risk ?? 5) as number | string;
        const riskScore = typeof riskScoreRaw === 'number' ? riskScoreRaw : Number(riskScoreRaw) || 5;
        const impactedRaw = (change.impacted_cis ?? change.affected_cis ?? []) as string[] | undefined;
        const doc = docGen.generateChangeRFC({
          changeId: number,
          title: get('short_description', 'Untitled change'),
          description: get('description'),
          type: get('type', 'normal'),
          riskScore,
          impactedCIs: Array.isArray(impactedRaw) ? impactedRaw : [],
          rollbackPlan: get('backout_plan', 'See ServiceNow record.'),
          implementationPlan: get('implementation_plan', 'See ServiceNow record.'),
          scheduledStart: get('start_date', get('planned_start_date')),
          scheduledEnd: get('end_date', get('planned_end_date')),
          requestedBy: get('requested_by', get('opened_by', 'unknown')),
          cabRecommendation: get('cab_recommendation') || undefined,
        });
        const fileName = doc.suggestedFilename.endsWith('.md')
          ? doc.suggestedFilename
          : `${doc.suggestedFilename}.md`;
        const subject = `RFC — ${number}`;
        const bodyHtml =
          `<p>Hi — RFC paperwork for <strong>${number}</strong> attached.</p>` +
          (notes ? `<p>${notes}</p>` : '') +
          `<p>— Alex</p>`;
        const result = await sendEmail({
          to,
          subject,
          body: bodyHtml,
          bodyType: 'HTML',
          attachments: [
            {
              name: fileName,
              contentBytes: Buffer.from(doc.content, 'utf8').toString('base64'),
              contentType: 'text/markdown',
            },
          ],
        });
        const summary = result.success
          ? `RFC for ${number} emailed to ${to} (${fileName}) via ${result.source}`
          : `RFC email failed: ${result.error || 'unknown'}`;
        audit(summary, result.success ? 'write' : 'notify');
        return summary;
      }

      case 'post_to_channel': {
        const message = String(args.message || '');
        if (!message) return 'error: empty message';
        const target = process.env.ITSM_ALERTS_CHANNEL_ID || process.env.ITSM_CHANNEL_ID || '';
        if (!target) return 'error: ITSM_ALERTS_CHANNEL_ID not configured';
        const result = await sendTeamsMessage({ target, message, surface: 'channel' });
        const summary = result.success
          ? `Teams channel post sent via ${result.source}`
          : `Teams channel post failed: ${result.error || 'unknown'}`;
        audit(summary, result.success ? 'write' : 'notify');
        return summary;
      }

      case 'send_teams_chat_message': {
        const target = resolveSelfEmail(args.to as string | undefined);
        const message = String(args.message || '');
        if (!message) return 'error: empty message';
        if (!target) return 'error: no recipient and no MANAGER_EMAIL configured';

        // Try Graph 1:1 chat first; on any failure fall back to email so the
        // message still lands. Many tenants do not grant Chat.Create + ChatMessage.Send
        // application perms — the email fallback keeps the demo flowing.
        const token = await getGraphAppToken();
        if (token) {
          try {
            const userId = await resolveAadUserId(target, token);
            if (!userId) throw new Error(`could not resolve ${target} to AAD id`);
            // POST /chats/{userId}/messages requires installed-bot RSC; try
            // the simpler "send to user" via /users/{id}/teamwork/installedApps
            // is not viable here. Use beta channel /chats with member install
            // approach: needs Chat.ReadWrite.All Application + chat creation.
            // Most tenants will reject — catch and fall through to email.
            const createRes = await fetch('https://graph.microsoft.com/v1.0/chats', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                chatType: 'oneOnOne',
                members: [
                  {
                    '@odata.type': '#microsoft.graph.aadUserConversationMember',
                    roles: ['owner'],
                    'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${userId}')`,
                  },
                ],
              }),
            });
            if (!createRes.ok) {
              const errText = await createRes.text();
              throw new Error(`chat create ${createRes.status}: ${errText.slice(0, 160)}`);
            }
            const chat = (await createRes.json()) as { id?: string };
            if (!chat.id) throw new Error('chat create returned no id');
            const sendRes = await fetch(
              `https://graph.microsoft.com/v1.0/chats/${chat.id}/messages`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  body: { contentType: 'html', content: message },
                }),
              },
            );
            if (!sendRes.ok) {
              const errText = await sendRes.text();
              throw new Error(`chat send ${sendRes.status}: ${errText.slice(0, 160)}`);
            }
            const summary = `Teams 1:1 chat sent to ${target}`;
            audit(summary, 'write');
            return summary;
          } catch (err) {
            // Fall back to email
            const fallbackResult = await sendEmail({
              to: target,
              subject: 'Message from Alex (IT Operations)',
              body: `<p>${message}</p><hr/><p style="color:#888"><em>Note: I tried to Teams-chat this directly but the app does not have Teams chat permissions in this tenant — sending by email instead.</em></p>`,
              bodyType: 'HTML',
            });
            const summary = fallbackResult.success
              ? `Teams chat unavailable (${(err as Error).message.slice(0, 80)}) — emailed ${target} instead`
              : `Teams chat AND email both failed: ${fallbackResult.error || 'unknown'}`;
            audit(summary, fallbackResult.success ? 'write' : 'notify');
            return summary;
          }
        }
        // No Graph token at all → email fallback
        const result = await sendEmail({
          to: target,
          subject: 'Message from Alex (IT Operations)',
          body: `<p>${message}</p><hr/><p style="color:#888"><em>Note: Teams app credentials not configured — sending by email instead.</em></p>`,
          bodyType: 'HTML',
        });
        const summary = result.success
          ? `no Graph credentials for Teams chat — emailed ${target} instead`
          : `email fallback failed: ${result.error || 'unknown'}`;
        audit(summary, result.success ? 'write' : 'notify');
        return summary;
      }

      case 'show_itsm_briefing': {
        try {
          const r = await mcp.getItsmBriefing();
          return JSON.stringify(r).slice(0, 1500);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'update_incident': {
        const sysId = String(args.sys_id || '');
        if (!sysId) return 'error: sys_id required';
        const fields: Record<string, unknown> = {};
        if (args.work_notes) fields.work_notes = String(args.work_notes);
        if (args.state) fields.state = String(args.state);
        try {
          const r = await mcp.updateIncident(sysId, fields);
          const summary = `incident ${sysId} updated`;
          audit(summary);
          return `${summary}: ${JSON.stringify(r).slice(0, 200)}`;
        } catch (err) {
          const msg = `incident update failed: ${(err as Error).message}`;
          audit(msg, 'notify');
          return msg;
        }
      }

      case 'create_incident': {
        try {
          const r = await mcp.createIncident({
            short_description: String(args.short_description || ''),
            description: String(args.description || ''),
            priority: args.priority ? String(args.priority) : undefined,
            category: args.category ? String(args.category) : undefined,
          });
          audit('incident created');
          return `incident created: ${JSON.stringify(r).slice(0, 200)}`;
        } catch (err) {
          const msg = `incident create failed: ${(err as Error).message}`;
          audit(msg, 'notify');
          return msg;
        }
      }

      case 'get_incidents': {
        const filters: Record<string, unknown> = {};
        if (args.priority) filters.priority = args.priority;
        if (args.state) filters.state = args.state;
        if (args.assignment_group) filters.assignment_group = args.assignment_group;
        try {
          const r = await mcp.getIncidents(filters);
          return JSON.stringify(r).slice(0, 1200);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'show_incident_dashboard': {
        try {
          const r = await mcp.getIncidentDashboard();
          return JSON.stringify(r).slice(0, 1200);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'show_problem_dashboard': {
        try {
          const r = await mcp.getProblems();
          return JSON.stringify(r).slice(0, 1200);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'show_change_dashboard': {
        try {
          const r = await mcp.getChangeDashboard();
          return JSON.stringify(r).slice(0, 1200);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'show_change_request': {
        const num = String(args.number || '');
        if (!num) return 'error: number required';
        try {
          const r = await mcp.getChangeRequest(num);
          return JSON.stringify(r).slice(0, 1500);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'show_blast_radius': {
        const ci = String(args.ci_name || '');
        if (!ci) return 'error: ci_name required';
        try {
          const r = await mcp.getBlastRadius(ci);
          return JSON.stringify(r).slice(0, 1500);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'show_sla_dashboard': {
        try {
          const r = await mcp.getSlaDashboard();
          return JSON.stringify(r).slice(0, 1200);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'get_cmdb_ci': {
        const ciName = String(args.name || '');
        if (!ciName) return 'error: name required';
        try {
          const r = await mcp.getCmdbCi(ciName);
          return JSON.stringify(r).slice(0, 1200);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'search_knowledge': {
        const q = String(args.query || '');
        if (!q) return 'error: query required';
        try {
          const r = await mcp.searchKnowledge(q);
          return JSON.stringify(r).slice(0, 1500);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'check_eol_status': {
        const product = String(args.product || '');
        const version = String(args.version || '');
        if (!product || !version) return 'error: product and version required';
        try {
          const r = await mcp.checkEolStatus(product, version);
          return JSON.stringify(r).slice(0, 800);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'find_runbook': {
        const system = String(args.system || '');
        if (!system) return 'error: system required';
        try {
          return (await workiq.findRunbook(system)).slice(0, 1500);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'search_m365_documents': {
        const q = String(args.query || '');
        if (!q) return 'error: query required';
        try {
          return (await workiq.searchDocuments(q)).slice(0, 1500);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'lookup_person_m365': {
        const personName = String(args.name || '');
        if (!personName) return 'error: name required';
        try {
          return (await workiq.lookupPerson(personName)).slice(0, 1200);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'find_subject_matter_expert': {
        const topic = String(args.topic || '');
        if (!topic) return 'error: topic required';
        try {
          return (await workiq.findExpertFor(topic)).slice(0, 1200);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'query_m365': {
        const question = String(args.question || '');
        if (!question) return 'error: question required';
        try {
          return (await workiq.query(question)).slice(0, 1500);
        } catch (err) {
          return `error: ${(err as Error).message}`;
        }
      }

      case 'get_current_date':
        return JSON.stringify({
          isoDate: new Date().toISOString(),
          utcString: new Date().toUTCString(),
        });

      default:
        return `error: unknown tool '${name}'`;
    }
  } catch (err) {
    const msg = `tool '${name}' threw: ${(err as Error).message}`;
    audit(msg, 'notify');
    return msg;
  }
}
