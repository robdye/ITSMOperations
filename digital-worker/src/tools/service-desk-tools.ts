// ITSM Service Desk tools
// ITIL 4 Practice: Service Desk
// Side effects: create_service_request (write)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const serviceDeskTools = [
  tool({
    name: 'get_service_catalog',
    description: 'List available service catalog items. READ OPERATION.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.callTool('get-catalog-items', {})),
  }),

  tool({
    name: 'create_service_request',
    description: 'Create a service request from the service catalog. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      catalog_item: z.string().describe('Service catalog item name or ID'),
      requested_for: z.string().optional().describe('User the request is for'),
      description: z.string().optional().describe('Details of the request'),
      priority: z.string().optional().describe('Priority: "1" (Critical), "2" (High), "3" (Medium), "4" (Low)'),
    }),
    execute: async (data) => stringify(await mcp.callTool('create-service-request', data)),
  }),

  tool({
    name: 'get_service_requests',
    description: 'Query service requests with optional filters. READ OPERATION.',
    parameters: z.object({
      state: z.string().optional().describe('Filter by state'),
      requested_for: z.string().optional().describe('Filter by requestor'),
      priority: z.string().optional().describe('Filter by priority'),
    }),
    execute: async (filters) => stringify(await mcp.callTool('get-service-requests', filters)),
  }),
];
