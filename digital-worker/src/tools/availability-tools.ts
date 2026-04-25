// ITSM Availability Management tools
// ITIL 4 Practice: Availability Management
// Side effects: create_slo (write)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const availabilityTools = [
  tool({
    name: 'get_service_availability',
    description: 'Get availability metrics for a service — uptime percentage, MTTR, MTBF.',
    parameters: z.object({
      service_name: z.string().describe('Name of the service to check'),
      period: z.string().optional().describe('Time period: "7d", "30d", "90d", "1y"'),
    }),
    execute: async ({ service_name, period }) => {
      return stringify({ status: 'pending_integration', message: 'Service availability metrics not yet connected to monitoring MCP', service_name, period });
    },
  }),

  tool({
    name: 'list_slo_status',
    description: 'List SLO/SLI status for all services — current attainment vs target.',
    parameters: z.object({
      service_name: z.string().optional().describe('Filter by specific service name'),
      breached_only: z.string().optional().describe('Set to "true" to show only breached SLOs'),
    }),
    execute: async ({ service_name, breached_only }) => {
      return stringify({ status: 'pending_integration', message: 'SLO status listing not yet connected to monitoring MCP', service_name, breached_only });
    },
  }),

  tool({
    name: 'check_error_budget',
    description: 'Check remaining error budget for a service — how much downtime is left before SLO breach.',
    parameters: z.object({
      service_name: z.string().describe('Name of the service'),
      period: z.string().optional().describe('Budget period: "monthly", "quarterly", "yearly"'),
    }),
    execute: async ({ service_name, period }) => {
      return stringify({ status: 'pending_integration', message: 'Error budget check not yet connected to monitoring MCP', service_name, period });
    },
  }),

  tool({
    name: 'get_availability_trends',
    description: 'Get availability trends over a time period — weekly/monthly uptime history.',
    parameters: z.object({
      service_name: z.string().optional().describe('Filter by service name (all services if omitted)'),
      period: z.string().optional().describe('Time period: "30d", "90d", "6m", "1y"'),
      granularity: z.string().optional().describe('Data granularity: "daily", "weekly", "monthly"'),
    }),
    execute: async ({ service_name, period, granularity }) => {
      return stringify({ status: 'pending_integration', message: 'Availability trends not yet connected to monitoring MCP', service_name, period, granularity });
    },
  }),

  tool({
    name: 'create_slo',
    description: 'Create or update an SLO definition for a service. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      service_name: z.string().describe('Name of the service'),
      slo_name: z.string().describe('SLO name, e.g. "Availability" or "Latency P99"'),
      target: z.string().describe('SLO target value, e.g. "99.9" for 99.9% uptime'),
      measurement: z.string().describe('How it is measured, e.g. "uptime_percentage", "p99_latency_ms"'),
      period: z.string().optional().describe('Measurement period: "monthly", "quarterly"'),
    }),
    execute: async (data) => {
      return stringify({ status: 'pending_integration', message: 'SLO creation not yet connected to monitoring MCP', data });
    },
  }),

  tool({
    name: 'get_outage_history',
    description: 'Get outage history for a service — past incidents that caused downtime.',
    parameters: z.object({
      service_name: z.string().describe('Name of the service'),
      period: z.string().optional().describe('Time period: "30d", "90d", "6m", "1y"'),
    }),
    execute: async ({ service_name, period }) => {
      return stringify({ status: 'pending_integration', message: 'Outage history not yet connected to monitoring MCP', service_name, period });
    },
  }),
];
