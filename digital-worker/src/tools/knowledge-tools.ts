// ITSM Knowledge Management tools
// ITIL 4 Practice: Knowledge Management
// Side effects: update_knowledge_article (write)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const knowledgeTools = [
  tool({
    name: 'search_knowledge',
    description: 'Search the ServiceNow knowledge base for articles matching a query.',
    parameters: z.object({ query: z.string().describe('Search query for knowledge articles') }),
    execute: async ({ query }) => stringify(await mcp.searchKnowledge(query)),
  }),

  tool({
    name: 'update_knowledge_article',
    description: 'Update an existing knowledge article in ServiceNow. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      sys_id: z.string().describe('sys_id of the knowledge article to update'),
      fields: z.record(z.unknown()).describe('Fields to update, e.g. short_description, text, workflow_state'),
    }),
    execute: async ({ sys_id, fields }) => stringify(await mcp.updateKnowledgeArticle(sys_id, fields)),
  }),
];
