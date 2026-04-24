// ITSM Incident Management tools
// ITIL 4 Practice: Incident Management
// Side effects: create_incident (write), update_incident (write)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const incidentTools = [
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
    description: 'Create a new incident in ServiceNow. WRITE OPERATION — confirm with user before executing.',
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
    description: 'Update an existing incident in ServiceNow by sys_id. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      sys_id: z.string().describe('ServiceNow sys_id of the incident'),
      state: z.string().optional().describe('New state'),
      work_notes: z.string().optional().describe('Work notes to add'),
      assigned_to: z.string().optional().describe('Assign to user'),
    }),
    execute: async ({ sys_id, ...fields }) => stringify(await mcp.updateIncident(sys_id, fields)),
  }),
];
