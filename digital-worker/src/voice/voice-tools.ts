// ITSM Operations — Voice (Realtime) tool registry
//
// The Foundry Realtime WS supports OpenAI-compatible function calling
// via `tools` on session.update. This module defines the JSON-Schema
// tool list we expose to Alex during a live ACS call AND the executor
// that runs them when the model emits
// `response.function_call_arguments.done`.
//
// Voice-side execution path (no Bot Framework turnContext):
//   - email  → m365-services.sendEmail (falls back to Graph)
//   - teams  → m365-services.sendTeamsMessage (falls back to Graph webhook)
//   - SNOW   → ItsmMcpClient (server-side credentials)
//
// Errors are *returned* as strings so the model speaks them back to the
// caller — they do NOT throw. This matches the @openai/agents tool()
// pattern in agent-tools.ts.

import { sendEmail, sendTeamsMessage } from '../m365-services';
import { ItsmMcpClient } from '../mcp-client';
import { logAuditEntry } from '../audit-trail';

const mcp = new ItsmMcpClient();

export interface RealtimeFunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** JSON-Schema tool definitions for Realtime session.update */
export const VOICE_TOOLS: RealtimeFunctionTool[] = [
  {
    type: 'function',
    name: 'send_email',
    description:
      'Send an email on behalf of the caller. Use this whenever the human on the call asks you to email them, email a colleague, or send documents/links/summaries by email. Confirm with them what you are sending before calling, then call this tool — do not just promise to send.',
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description:
            'Recipient email address. If the caller says "email me" or "send to me" use the configured manager email (the same address Alex is paging).',
        },
        subject: { type: 'string', description: 'Subject line — short and specific.' },
        body: {
          type: 'string',
          description:
            'Email body. May contain HTML (<p>, <ul>, <a href="...">). Be concise and structured.',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    type: 'function',
    name: 'post_to_channel',
    description:
      'Post a status message to the IT Operations alerts Teams channel. Use during the call to broadcast incident updates, decisions reached on the bridge, or new actions assigned.',
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
    name: 'update_incident',
    description:
      'Add a work note (and optionally change state / assignee) on a ServiceNow incident. Use during the call to record decisions, e.g. "I just told the SOC to lock down the management plane" → add as a work note on INC0012345.',
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
    description:
      'Open a new ServiceNow incident from the call. Use when the caller surfaces a new issue and asks you to "log a ticket" or "open an incident".',
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
      'Read open incidents from ServiceNow with optional filters. Use to answer "what P1s are open?" or "what is INC0012345 currently showing?" during the call.',
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
    description:
      'Get the live incident dashboard — open P1/P2/P3/P4 counts, recent incidents, and trends. Use to give a quick situational read during the call.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
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

  const audit = (resultSummary: string, riskLevel: 'auto' | 'propose' | 'notify' = 'auto') =>
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
        const result = await sendEmail({ to, subject, body, bodyType: 'HTML' });
        const summary = result.success
          ? `email sent to ${to} via ${result.source}`
          : `email failed: ${result.error || 'unknown'}`;
        audit(summary, result.success ? 'auto' : 'notify');
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
        audit(summary, result.success ? 'auto' : 'notify');
        return summary;
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
