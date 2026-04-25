// ITSM Service Request Management tools
// ITIL 4 Practice: Service Request Management
// Side effects: create_service_request (write), update_service_request (write), submit_catalog_order (write)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const requestTools = [
  tool({
    name: 'list_service_requests',
    description: 'List open service requests with optional filters (query, status, category).',
    parameters: z.object({
      query: z.string().optional().describe('Free-text search query'),
      status: z.string().optional().describe('Filter by status: "open", "in_progress", "closed", "cancelled"'),
      category: z.string().optional().describe('Filter by request category'),
    }),
    execute: async ({ query, status, category }) => {
      return stringify({ status: 'pending_integration', message: 'Service request listing not yet connected to ServiceNow MCP', filters: { query, status, category } });
    },
  }),

  tool({
    name: 'get_service_request',
    description: 'Get full details of a service request by sys_id.',
    parameters: z.object({
      sys_id: z.string().describe('ServiceNow sys_id of the service request'),
    }),
    execute: async ({ sys_id }) => {
      return stringify({ status: 'pending_integration', message: 'Service request lookup not yet connected to ServiceNow MCP', sys_id });
    },
  }),

  tool({
    name: 'create_service_request',
    description: 'Create a new service request in ServiceNow. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      short_description: z.string().describe('Brief description of the request'),
      category: z.string().optional().describe('Request category, e.g. "Hardware", "Software", "Access"'),
      requested_for: z.string().optional().describe('User the request is on behalf of'),
      urgency: z.string().optional().describe('Urgency: "1" (High), "2" (Medium), "3" (Low)'),
      description: z.string().optional().describe('Detailed description of the request'),
    }),
    execute: async (data) => {
      return stringify({ status: 'pending_integration', message: 'Service request creation not yet connected to ServiceNow MCP', data });
    },
  }),

  tool({
    name: 'update_service_request',
    description: 'Update an existing service request in ServiceNow. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      sys_id: z.string().describe('ServiceNow sys_id of the service request'),
      fields: z.string().describe('JSON string of fields to update, e.g. \'{"state":"closed","close_notes":"Completed"}\''),
    }),
    execute: async ({ sys_id, fields }) => {
      return stringify({ status: 'pending_integration', message: 'Service request update not yet connected to ServiceNow MCP', sys_id, fields });
    },
  }),

  tool({
    name: 'get_catalog_items',
    description: 'List available service catalog items that can be ordered.',
    parameters: z.object({
      category: z.string().optional().describe('Filter by catalog category'),
      query: z.string().optional().describe('Search catalog items by keyword'),
    }),
    execute: async ({ category, query }) => {
      return stringify({ status: 'pending_integration', message: 'Catalog item listing not yet connected to ServiceNow MCP', filters: { category, query } });
    },
  }),

  tool({
    name: 'submit_catalog_order',
    description: 'Submit a service catalog item order. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      catalog_item_id: z.string().describe('sys_id of the catalog item to order'),
      requested_for: z.string().optional().describe('User the order is for'),
      variables: z.string().optional().describe('JSON string of catalog item variables/options'),
    }),
    execute: async ({ catalog_item_id, requested_for, variables }) => {
      return stringify({ status: 'pending_integration', message: 'Catalog order submission not yet connected to ServiceNow MCP', catalog_item_id, requested_for, variables });
    },
  }),
];
