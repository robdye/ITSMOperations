// ITSM M365 Intelligence tools — shared across all workers
// Powered by WorkIQ MCP client for email, calendar, Teams, people, documents
// Side effects: none (all read-only queries via natural language)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { WorkIqClient } from '../workiq-client';

const workiq = new WorkIqClient();

export const m365Tools = [
  // ── Email Intelligence ──
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

  // ── Meetings & Calendar ──
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

  // ── Teams Channel Intelligence ──
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

  // ── People & Org ──
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

  // ── Documents ──
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

  // ── General M365 Query ──
  tool({
    name: 'query_m365',
    description: 'Ask any natural language question about Microsoft 365 data — emails, meetings, documents, Teams messages, or people.',
    parameters: z.object({
      question: z.string().describe('Natural language question about M365 data'),
    }),
    execute: async ({ question }) => await workiq.query(question),
  }),
];
