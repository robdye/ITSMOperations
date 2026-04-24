// ITSM Problem Management tools
// ITIL 4 Practice: Problem Management
// Side effects: create_problem (write)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const problemTools = [
  tool({
    name: 'show_problem_dashboard',
    description: 'Show the problem dashboard — open problems, known errors, and root cause analysis status.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.getProblems()),
  }),

  tool({
    name: 'create_problem',
    description: 'Create a new problem record in ServiceNow. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      short_description: z.string().describe('Problem description'),
      description: z.string().optional().describe('Detailed description'),
      priority: z.string().optional().describe('Priority: "1"-"4"'),
      category: z.string().optional().describe('Problem category'),
    }),
    execute: async (data) => stringify(await mcp.createProblem(data)),
  }),

  tool({
    name: 'update_problem',
    description: 'Update an existing problem record in ServiceNow. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      sys_id: z.string().describe('sys_id of the problem to update'),
      fields: z.record(z.unknown()).describe('Fields to update'),
    }),
    execute: async ({ sys_id, fields }) => stringify(await mcp.updateProblem(sys_id, fields)),
  }),
];
