// ITSM Risk Management tools
// ITIL 4 Practice: Risk Management
// Side effects: create_risk_entry (write), update_risk_entry (write)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const riskTools = [
  tool({
    name: 'assess_change_risk',
    description: 'Assess the risk score for a change request — considers blast radius, CI criticality, and history.',
    parameters: z.object({
      change_sys_id: z.string().describe('ServiceNow sys_id of the change request to assess'),
    }),
    execute: async ({ change_sys_id }) => {
      return stringify({ status: 'pending_integration', message: 'Change risk assessment not yet connected to ServiceNow MCP', change_sys_id });
    },
  }),

  tool({
    name: 'get_risk_register',
    description: 'Get the current risk register — all active risks with likelihood, impact, and mitigations.',
    parameters: z.object({
      status: z.string().optional().describe('Filter by risk status: "open", "mitigated", "accepted", "closed"'),
    }),
    execute: async ({ status }) => {
      return stringify({ status: 'pending_integration', message: 'Risk register not yet connected to ServiceNow MCP', filter_status: status });
    },
  }),

  tool({
    name: 'create_risk_entry',
    description: 'Create a new entry in the risk register. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      title: z.string().describe('Risk title'),
      description: z.string().describe('Detailed risk description'),
      likelihood: z.string().describe('Likelihood: "1" (Rare) to "5" (Almost Certain)'),
      impact: z.string().describe('Impact: "1" (Negligible) to "5" (Catastrophic)'),
      mitigation: z.string().optional().describe('Mitigation plan or strategy'),
      owner: z.string().optional().describe('Risk owner'),
    }),
    execute: async (data) => {
      return stringify({ status: 'pending_integration', message: 'Risk entry creation not yet connected to ServiceNow MCP', data });
    },
  }),

  tool({
    name: 'update_risk_entry',
    description: 'Update an existing risk register entry. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      sys_id: z.string().describe('ServiceNow sys_id of the risk entry'),
      fields: z.string().describe('JSON string of fields to update, e.g. \'{"likelihood":"3","mitigation":"Added monitoring"}\''),
    }),
    execute: async ({ sys_id, fields }) => {
      return stringify({ status: 'pending_integration', message: 'Risk entry update not yet connected to ServiceNow MCP', sys_id, fields });
    },
  }),

  tool({
    name: 'calculate_combined_risk',
    description: 'Calculate combined risk score across change, security, and continuity dimensions.',
    parameters: z.object({
      scope: z.string().optional().describe('Scope to assess: "all", "changes", "security", "continuity"'),
    }),
    execute: async ({ scope }) => {
      return stringify({ status: 'pending_integration', message: 'Combined risk calculation not yet connected to ServiceNow MCP', scope });
    },
  }),

  tool({
    name: 'get_risk_heatmap_data',
    description: 'Get risk data formatted for heatmap visualisation — likelihood vs impact matrix.',
    parameters: z.object({}),
    execute: async () => {
      return stringify({ status: 'pending_integration', message: 'Risk heatmap data not yet connected to ServiceNow MCP' });
    },
  }),
];
