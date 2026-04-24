// ITSM Briefing tool — orchestrator-level aggregate view
// Used by Command Center for cross-practice briefings

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const briefingTools = [
  tool({
    name: 'show_itsm_briefing',
    description: 'Get a comprehensive ITSM operations briefing — incidents, problems, changes, SLAs, and key metrics.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.getItsmBriefing()),
  }),
];
