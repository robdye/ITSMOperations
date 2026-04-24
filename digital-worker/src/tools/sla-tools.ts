// ITSM SLA Management tools
// ITIL 4 Practice: Service Level Management
// Side effects: none (read-only)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const slaTools = [
  tool({
    name: 'show_sla_dashboard',
    description: 'Show SLA compliance dashboard — breaches, at-risk tickets, compliance rates by priority.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.getSlaDashboard()),
  }),
];
