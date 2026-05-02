// ITSM Operations Digital Worker — Function tools for the @openai/agents Agent
// Registers ITSM, incident, change, problem, SLA, CMDB, and communication tools.

import { tool } from '@openai/agents';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from './mcp-client';
import { WorkIqClient } from './workiq-client';
import { sendEmail, sendTeamsMessage } from './m365-tools';
import type { WorkerRunContext } from './agent-harness';

const mcp = new ItsmMcpClient();
const workiq = new WorkIqClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

/** Pull the live Microsoft Agents TurnContext that the harness threaded
 * through `runContext.context`. Returns undefined for autonomous runs. */
function getTurnContext(runContext?: RunContext<WorkerRunContext>) {
  return runContext?.context?.turnContext;
}

export const agentTools = [
  // ── ITSM Briefing ──
  tool({
    name: 'show_itsm_briefing',
    description: 'Get a comprehensive ITSM operations briefing — incidents, problems, changes, SLAs, and key metrics.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.getItsmBriefing()),
  }),

  // ── Incident Management ──
  tool({
    name: 'get_incidents',
    description: 'Query incidents from ServiceNow with optional filters (priority, state, assignment group).',
    parameters: z.object({
      priority: z.string().optional().describe('Filter by priority: "1", "2", "3", "4"'),
      state: z.string().optional().describe('Filter by state'),
      assignment_group: z.string().optional().describe('Filter by assignment group name'),
    }),
    execute: async ({ priority, state, assignment_group }) => {
      const filters: Record<string, unknown> = {};
      if (priority) filters.priority = priority;
      if (state) filters.state = state;
      if (assignment_group) filters.assignment_group = assignment_group;
      return stringify(await mcp.getIncidents(filters));
    },
  }),

  tool({
    name: 'show_incident_dashboard',
    description: 'Show the incident dashboard — open P1/P2/P3/P4 counts, recent incidents, and trends.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.getIncidentDashboard()),
  }),

  tool({
    name: 'get_incidents_for_ci',
    description: 'Get all incidents related to a specific configuration item (CI) in the CMDB.',
    parameters: z.object({ ci_name: z.string().describe('Configuration item name, e.g. "SAP ERP"') }),
    execute: async ({ ci_name }) => stringify(await mcp.getIncidentsForCi(ci_name)),
  }),

  tool({
    name: 'create_incident',
    description: 'Create a new incident in ServiceNow.',
    parameters: z.object({
      short_description: z.string().describe('Brief incident description'),
      description: z.string().optional().describe('Detailed description'),
      priority: z.string().optional().describe('Priority: "1" (Critical), "2" (High), "3" (Medium), "4" (Low)'),
      category: z.string().optional().describe('Incident category'),
      assignment_group: z.string().optional().describe('Assignment group name'),
    }),
    execute: async (data) => stringify(await mcp.createIncident(data)),
  }),

  tool({
    name: 'update_incident',
    description: 'Update an existing incident in ServiceNow by sys_id.',
    parameters: z.object({
      sys_id: z.string().describe('ServiceNow sys_id of the incident'),
      state: z.string().optional().describe('New state'),
      work_notes: z.string().optional().describe('Work notes to add'),
      assigned_to: z.string().optional().describe('Assign to user'),
    }),
    execute: async ({ sys_id, ...fields }) => stringify(await mcp.updateIncident(sys_id, fields)),
  }),

  // ── Problem Management ──
  tool({
    name: 'show_problem_dashboard',
    description: 'Show the problem dashboard — open problems, known errors, and root cause analysis status.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.getProblems()),
  }),

  tool({
    name: 'create_problem',
    description: 'Create a new problem record in ServiceNow.',
    parameters: z.object({
      short_description: z.string().describe('Problem description'),
      description: z.string().optional().describe('Detailed description'),
      priority: z.string().optional().describe('Priority: "1"-"4"'),
      category: z.string().optional().describe('Problem category'),
    }),
    execute: async (data) => stringify(await mcp.createProblem(data)),
  }),

  // ── Change Management ──
  tool({
    name: 'show_change_dashboard',
    description: 'Show the change dashboard — open changes with risk scores, types, and approval status.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.getChangeDashboard()),
  }),

  tool({
    name: 'show_change_request',
    description: 'Get detailed information about a specific change request by number.',
    parameters: z.object({ number: z.string().describe('Change request number, e.g. "CHG0000001"') }),
    execute: async ({ number }) => stringify(await mcp.getChangeRequest(number)),
  }),

  tool({
    name: 'show_blast_radius',
    description: 'Analyse the blast radius of a change — affected CIs, dependent systems, and business services.',
    parameters: z.object({ ci_name: z.string().describe('Configuration item name to analyse') }),
    execute: async ({ ci_name }) => stringify(await mcp.getBlastRadius(ci_name)),
  }),

  tool({
    name: 'show_change_metrics',
    description: 'Get change management KPIs — success rate, emergency ratio, lead times, and trends.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.getChangeMetrics()),
  }),

  tool({
    name: 'show_change_briefing',
    description: 'Get a change management briefing with upcoming changes and risk summary.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.getChangeBriefing()),
  }),

  tool({
    name: 'generate_cab_agenda',
    description: 'Generate a Change Advisory Board (CAB) agenda with pending changes prioritised by risk.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.generateCabAgenda()),
  }),

  tool({
    name: 'detect_change_collisions',
    description: 'Detect change collisions — overlapping maintenance windows, same-CI conflicts.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.detectCollisions()),
  }),

  tool({
    name: 'get_change_history',
    description: 'Get change history for a CI or category.',
    parameters: z.object({
      ci_name: z.string().optional().describe('Filter by configuration item name'),
      category: z.string().optional().describe('Filter by change category'),
    }),
    execute: async ({ ci_name, category }) => stringify(await mcp.getChangeHistory(ci_name, category)),
  }),

  tool({
    name: 'post_implementation_review',
    description: 'Run a post-implementation review for a change — correlates incidents opened within 48h.',
    parameters: z.object({ number: z.string().describe('Change request number, e.g. "CHG0000001"') }),
    execute: async ({ number }) => stringify(await mcp.postImplementationReview(number)),
  }),

  // ── SLA Management ──
  tool({
    name: 'show_sla_dashboard',
    description: 'Show SLA compliance dashboard — breaches, at-risk tickets, compliance rates by priority.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.getSlaDashboard()),
  }),

  // ── CMDB ──
  tool({
    name: 'get_cmdb_ci',
    description: 'Look up a configuration item in the CMDB by name.',
    parameters: z.object({ name: z.string().describe('CI name to look up') }),
    execute: async ({ name }) => stringify(await mcp.getCmdbCi(name)),
  }),

  tool({
    name: 'get_ci_relationships',
    description: 'Get relationships and dependencies for a CI by its sys_id.',
    parameters: z.object({ ci_sys_id: z.string().describe('sys_id of the configuration item') }),
    execute: async ({ ci_sys_id }) => stringify(await mcp.getCiRelationships(ci_sys_id)),
  }),

  // ── Knowledge ──
  tool({
    name: 'search_knowledge',
    description: 'Search the ServiceNow knowledge base for articles matching a query.',
    parameters: z.object({ query: z.string().describe('Search query for knowledge articles') }),
    execute: async ({ query }) => stringify(await mcp.searchKnowledge(query)),
  }),

  // ── Assets ──
  tool({
    name: 'get_assets',
    description: 'Query IT assets from ServiceNow with optional filters.',
    parameters: z.object({
      category: z.string().optional().describe('Filter by asset category'),
      status: z.string().optional().describe('Filter by asset status'),
    }),
    execute: async ({ category, status }) => {
      const filters: Record<string, unknown> = {};
      if (category) filters.category = category;
      if (status) filters.status = status;
      return stringify(await mcp.getAssets(filters));
    },
  }),

  tool({
    name: 'get_expired_warranties',
    description: 'Get assets with expired warranties.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.getExpiredWarranties()),
  }),

  tool({
    name: 'show_asset_lifecycle',
    description: 'Show the asset lifecycle dashboard — EOL dates, warranty status, refresh planning.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.getAssetLifecycle()),
  }),

  // ── EOL ──
  tool({
    name: 'check_eol_status',
    description: 'Check end-of-life status for a product and version using endoflife.date API.',
    parameters: z.object({
      product: z.string().describe('Product name, e.g. "nodejs", "windows", "ubuntu"'),
      version: z.string().describe('Version string, e.g. "18", "11", "22.04"'),
    }),
    execute: async ({ product, version }) => stringify(await mcp.checkEolStatus(product, version)),
  }),

  // ── Communication (MCP-first, Graph fallback) ──
  tool({
    name: 'send_email',
    description:
      'Send an email (Microsoft Mail MCP when a user session is present, Microsoft Graph otherwise). Use for escalations, notifications, and reports.',
    parameters: z.object({
      to: z.string().describe('Recipient email address'),
      subject: z.string().describe('Email subject line'),
      body: z.string().describe('Email body in HTML or plain text'),
    }),
    execute: async ({ to, subject, body }, runContext) => {
      const result = await sendEmail(
        { to, subject, body, bodyType: 'HTML' },
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
      'Post a message to the IT Operations alerts channel (Teams MCP when a user session is present, Graph webhook otherwise).',
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

  // ── Utility ──
  tool({
    name: 'get_current_date',
    description: 'Returns the current date and time.',
    parameters: z.object({}),
    execute: async () => JSON.stringify({ isoDate: new Date().toISOString(), utcString: new Date().toUTCString() }),
  }),

  // ── WorkIQ: M365 Email Intelligence ──
  tool({
    name: 'search_m365_emails',
    description: 'Search Microsoft 365 emails using natural language. Use to find communications about incidents, changes, outages, or any ITSM topic.',
    parameters: z.object({
      query: z.string().describe('Natural language query, e.g. "emails from Sarah about the database outage"'),
    }),
    execute: async ({ query }) => await workiq.searchEmails(query),
  }),

  tool({
    name: 'get_emails_about_incident',
    description: 'Find all emails related to a specific incident number — escalation threads, status updates, vendor communications.',
    parameters: z.object({
      incident_id: z.string().describe('Incident number, e.g. "INC0000042"'),
    }),
    execute: async ({ incident_id }) => await workiq.getEmailsAboutIncident(incident_id),
  }),

  tool({
    name: 'get_emails_about_change',
    description: 'Find all emails related to a specific change request — approvals, implementation plans, rollback discussions.',
    parameters: z.object({
      change_number: z.string().describe('Change number, e.g. "CHG0000001"'),
    }),
    execute: async ({ change_number }) => await workiq.getEmailsAboutChange(change_number),
  }),

  tool({
    name: 'triage_inbox',
    description: 'Triage the ITSM manager inbox — identify urgent items, incident escalations, change approvals needing attention.',
    parameters: z.object({}),
    execute: async () => await workiq.triageInbox(),
  }),

  // ── WorkIQ: Meetings & Calendar ──
  tool({
    name: 'get_upcoming_meetings',
    description: 'Get upcoming meetings — CAB reviews, incident bridges, RCA sessions, standups.',
    parameters: z.object({
      timeframe: z.string().optional().describe('Timeframe, e.g. "today", "this week", "tomorrow"'),
    }),
    execute: async ({ timeframe }) => await workiq.getUpcomingMeetings(timeframe),
  }),

  tool({
    name: 'find_cab_meetings',
    description: 'Find upcoming Change Advisory Board (CAB) meetings or change review sessions.',
    parameters: z.object({}),
    execute: async () => await workiq.findCabMeetings(),
  }),

  tool({
    name: 'extract_meeting_action_items',
    description: 'Extract action items with owners and deadlines from a meeting — useful after RCA reviews, post-incident reviews, and CAB meetings.',
    parameters: z.object({
      meeting_subject: z.string().describe('Meeting subject or name to extract action items from'),
    }),
    execute: async ({ meeting_subject }) => await workiq.extractActionItems(meeting_subject),
  }),

  tool({
    name: 'get_meeting_costs',
    description: 'Calculate time and cost spent in meetings — helps identify operational overhead from incident bridges and war rooms.',
    parameters: z.object({
      timeframe: z.string().optional().describe('Timeframe, e.g. "this week", "last month"'),
    }),
    execute: async ({ timeframe }) => await workiq.getMeetingCosts(timeframe),
  }),

  // ── WorkIQ: Teams Channel Intelligence ──
  tool({
    name: 'search_teams_messages',
    description: 'Search Teams messages across channels for ITSM-related discussions, alerts, or updates.',
    parameters: z.object({
      query: z.string().describe('Search query, e.g. "SAP outage", "database performance"'),
    }),
    execute: async ({ query }) => await workiq.searchTeamsMessages(query),
  }),

  tool({
    name: 'get_it_ops_channel_activity',
    description: 'Get recent activity from IT Operations, Incidents, or Service Desk Teams channels — alerts, discussions, status updates.',
    parameters: z.object({}),
    execute: async () => await workiq.getItOpsChannelAlerts(),
  }),

  tool({
    name: 'get_channel_activity',
    description: 'Summarize recent activity in a specific Teams channel.',
    parameters: z.object({
      channel_name: z.string().describe('Name of the Teams channel'),
    }),
    execute: async ({ channel_name }) => await workiq.getChannelActivity(channel_name),
  }),

  // ── WorkIQ: People & Org ──
  tool({
    name: 'lookup_person_m365',
    description: 'Look up a person in Microsoft 365 — role, department, manager, contact info. Useful for escalation paths and incident ownership.',
    parameters: z.object({
      name: z.string().describe('Person name to look up'),
    }),
    execute: async ({ name }) => await workiq.lookupPerson(name),
  }),

  tool({
    name: 'get_org_chart',
    description: 'Show the org chart for a person — useful for identifying escalation paths and management chains for major incidents.',
    parameters: z.object({
      name: z.string().describe('Person name to show org chart for'),
    }),
    execute: async ({ name }) => await workiq.getOrgChart(name),
  }),

  tool({
    name: 'find_subject_matter_expert',
    description: 'Find the subject matter expert (SME) for a system, technology, or topic — based on M365 activity and communications.',
    parameters: z.object({
      topic: z.string().describe('System or topic, e.g. "Oracle database", "Kubernetes", "SAP ERP"'),
    }),
    execute: async ({ topic }) => await workiq.findExpertFor(topic),
  }),

  // ── WorkIQ: Documents ──
  tool({
    name: 'search_m365_documents',
    description: 'Search SharePoint and OneDrive for documents — runbooks, architecture diagrams, DR plans, change implementation docs.',
    parameters: z.object({
      query: z.string().describe('Search query, e.g. "disaster recovery plan", "Oracle failover runbook"'),
    }),
    execute: async ({ query }) => await workiq.searchDocuments(query),
  }),

  tool({
    name: 'find_runbook',
    description: 'Find operational runbooks and procedures for a system or service in SharePoint/OneDrive.',
    parameters: z.object({
      system: z.string().describe('System or service name, e.g. "SAP ERP", "Exchange Online", "Kubernetes"'),
    }),
    execute: async ({ system }) => await workiq.findRunbook(system),
  }),

  // ── WorkIQ: General M365 Query ──
  tool({
    name: 'query_m365',
    description: 'Ask any natural language question about Microsoft 365 data — emails, meetings, documents, Teams messages, or people.',
    parameters: z.object({
      question: z.string().describe('Natural language question about M365 data'),
    }),
    execute: async ({ question }) => await workiq.query(question),
  }),
];
