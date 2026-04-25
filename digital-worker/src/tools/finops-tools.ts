// ITSM FinOps / Cost Management tools
// ITIL 4 Practice: Financial Management of IT Services
// Side effects: create_cost_optimization_change (write)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const finopsTools = [
  tool({
    name: 'get_azure_cost_summary',
    description: 'Get Azure cost summary by resource group or subscription.',
    parameters: z.object({
      subscription_id: z.string().optional().describe('Azure subscription ID'),
      resource_group: z.string().optional().describe('Filter by resource group name'),
      period: z.string().optional().describe('Time period: "7d", "30d", "90d", "1y"'),
    }),
    execute: async ({ subscription_id, resource_group, period }) => {
      return stringify({ status: 'pending_integration', message: 'Azure cost summary not yet connected to FinOps MCP', subscription_id, resource_group, period });
    },
  }),

  tool({
    name: 'get_cost_by_service',
    description: 'Get cost breakdown by service or configuration item.',
    parameters: z.object({
      service_name: z.string().optional().describe('Filter by service or CI name'),
      period: z.string().optional().describe('Time period: "7d", "30d", "90d"'),
      group_by: z.string().optional().describe('Group costs by: "service", "resource_group", "resource_type", "tag"'),
    }),
    execute: async ({ service_name, period, group_by }) => {
      return stringify({ status: 'pending_integration', message: 'Cost by service breakdown not yet connected to FinOps MCP', service_name, period, group_by });
    },
  }),

  tool({
    name: 'identify_waste',
    description: 'Identify orphaned or underutilised Azure resources that could be removed or downsized.',
    parameters: z.object({
      subscription_id: z.string().optional().describe('Azure subscription ID'),
      resource_group: z.string().optional().describe('Filter by resource group'),
      resource_type: z.string().optional().describe('Filter by resource type, e.g. "Microsoft.Compute/virtualMachines"'),
    }),
    execute: async ({ subscription_id, resource_group, resource_type }) => {
      return stringify({ status: 'pending_integration', message: 'Waste identification not yet connected to FinOps MCP', subscription_id, resource_group, resource_type });
    },
  }),

  tool({
    name: 'get_rightsizing_recommendations',
    description: 'Get VM and resource rightsizing recommendations based on utilisation data.',
    parameters: z.object({
      subscription_id: z.string().optional().describe('Azure subscription ID'),
      resource_group: z.string().optional().describe('Filter by resource group'),
      min_savings: z.string().optional().describe('Minimum monthly savings threshold in USD, e.g. "50"'),
    }),
    execute: async ({ subscription_id, resource_group, min_savings }) => {
      return stringify({ status: 'pending_integration', message: 'Rightsizing recommendations not yet connected to FinOps MCP', subscription_id, resource_group, min_savings });
    },
  }),

  tool({
    name: 'create_cost_optimization_change',
    description: 'Create a cost optimisation RFC (change request) from a recommendation. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      recommendation_id: z.string().describe('ID of the rightsizing or waste recommendation'),
      short_description: z.string().describe('Brief description of the optimisation'),
      estimated_savings: z.string().optional().describe('Estimated monthly savings in USD'),
      justification: z.string().optional().describe('Business justification for the change'),
    }),
    execute: async (data) => {
      return stringify({ status: 'pending_integration', message: 'Cost optimisation RFC creation not yet connected to FinOps MCP', data });
    },
  }),

  tool({
    name: 'get_cost_trends',
    description: 'Get cost trends over time with forecast — spend trajectory and budget burn rate.',
    parameters: z.object({
      subscription_id: z.string().optional().describe('Azure subscription ID'),
      service_name: z.string().optional().describe('Filter by service name'),
      period: z.string().optional().describe('Historical period: "30d", "90d", "6m", "1y"'),
      forecast_days: z.string().optional().describe('Number of days to forecast, e.g. "30", "90"'),
    }),
    execute: async ({ subscription_id, service_name, period, forecast_days }) => {
      return stringify({ status: 'pending_integration', message: 'Cost trends and forecast not yet connected to FinOps MCP', subscription_id, service_name, period, forecast_days });
    },
  }),
];
