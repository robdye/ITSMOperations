// ITSM Service Catalogue Management tools
// ITIL 4 Practice: Service Catalogue Management
// Side effects: create_catalogue_item (write), retire_catalogue_item (write)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const catalogueTools = [
  tool({
    name: 'search_catalogue',
    description: 'Search the service catalogue by keyword or phrase.',
    parameters: z.object({
      query: z.string().describe('Search keyword or phrase'),
      category: z.string().optional().describe('Filter by catalogue category'),
    }),
    execute: async ({ query, category }) => {
      return stringify({ status: 'pending_integration', message: 'Catalogue search not yet connected to ServiceNow MCP', query, category });
    },
  }),

  tool({
    name: 'get_catalogue_item',
    description: 'Get full details of a service catalogue item by sys_id.',
    parameters: z.object({
      sys_id: z.string().describe('ServiceNow sys_id of the catalogue item'),
    }),
    execute: async ({ sys_id }) => {
      return stringify({ status: 'pending_integration', message: 'Catalogue item lookup not yet connected to ServiceNow MCP', sys_id });
    },
  }),

  tool({
    name: 'list_catalogue_categories',
    description: 'List all service catalogue categories.',
    parameters: z.object({}),
    execute: async () => {
      return stringify({ status: 'pending_integration', message: 'Catalogue category listing not yet connected to ServiceNow MCP' });
    },
  }),

  tool({
    name: 'create_catalogue_item',
    description: 'Create a new service catalogue item. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      name: z.string().describe('Name of the catalogue item'),
      short_description: z.string().describe('Brief description of the catalogue item'),
      category: z.string().optional().describe('Catalogue category'),
      price: z.string().optional().describe('Price or cost of the item'),
      fulfillment_group: z.string().optional().describe('Group responsible for fulfillment'),
    }),
    execute: async (data) => {
      return stringify({ status: 'pending_integration', message: 'Catalogue item creation not yet connected to ServiceNow MCP', data });
    },
  }),

  tool({
    name: 'retire_catalogue_item',
    description: 'Retire or deactivate a service catalogue item. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      sys_id: z.string().describe('ServiceNow sys_id of the catalogue item to retire'),
      reason: z.string().optional().describe('Reason for retirement'),
    }),
    execute: async ({ sys_id, reason }) => {
      return stringify({ status: 'pending_integration', message: 'Catalogue item retirement not yet connected to ServiceNow MCP', sys_id, reason });
    },
  }),

  tool({
    name: 'get_catalogue_analytics',
    description: 'Get usage analytics for service catalogue items — order counts, popular items, trends.',
    parameters: z.object({
      period: z.string().optional().describe('Time period: "7d", "30d", "90d", "1y"'),
      category: z.string().optional().describe('Filter by catalogue category'),
    }),
    execute: async ({ period, category }) => {
      return stringify({ status: 'pending_integration', message: 'Catalogue analytics not yet connected to ServiceNow MCP', period, category });
    },
  }),
];
