// ITSM Change Management tools
// ITIL 4 Practice: Change Enablement
// Side effects: none currently (all read-only queries + analysis)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const changeTools = [
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
];
