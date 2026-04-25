// ITSM Measurement & Reporting tools
// ITIL 4 Practice: Measurement & Reporting
// Side effects: none (all read-only queries + analysis)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const reportingTools = [
  tool({
    name: 'generate_kpi_summary',
    description: 'Generate a KPI summary across ITSM practices for a given period.',
    parameters: z.object({
      period: z.string().describe('Reporting period: "weekly", "monthly", "quarterly"'),
      practice: z.string().optional().describe('Filter by ITIL practice, e.g. "incident", "change", "problem"'),
    }),
    execute: async ({ period, practice }) => {
      return stringify({ status: 'pending_integration', message: 'KPI summary generation not yet connected to reporting MCP', period, practice });
    },
  }),

  tool({
    name: 'get_csf_status',
    description: 'Get Critical Success Factor (CSF) status — progress against strategic objectives.',
    parameters: z.object({
      csf_id: z.string().optional().describe('Specific CSF ID to check (all CSFs if omitted)'),
    }),
    execute: async ({ csf_id }) => {
      return stringify({ status: 'pending_integration', message: 'CSF status not yet connected to reporting MCP', csf_id });
    },
  }),

  tool({
    name: 'generate_service_review_pack',
    description: 'Generate a monthly service review data pack — KPIs, SLA performance, incidents, changes.',
    parameters: z.object({
      month: z.string().optional().describe('Month in YYYY-MM format (defaults to current month)'),
      service_name: z.string().optional().describe('Filter by specific service'),
    }),
    execute: async ({ month, service_name }) => {
      return stringify({ status: 'pending_integration', message: 'Service review pack generation not yet connected to reporting MCP', month, service_name });
    },
  }),

  tool({
    name: 'get_trend_analysis',
    description: 'Get trend analysis for a specific ITSM metric over time.',
    parameters: z.object({
      metric: z.string().describe('Metric name, e.g. "incident_volume", "mttr", "change_success_rate", "sla_compliance"'),
      period: z.string().optional().describe('Time period: "30d", "90d", "6m", "1y"'),
      granularity: z.string().optional().describe('Data granularity: "daily", "weekly", "monthly"'),
    }),
    execute: async ({ metric, period, granularity }) => {
      return stringify({ status: 'pending_integration', message: 'Trend analysis not yet connected to reporting MCP', metric, period, granularity });
    },
  }),

  tool({
    name: 'list_improvement_initiatives',
    description: 'List active continual improvement initiatives with status and progress.',
    parameters: z.object({
      status: z.string().optional().describe('Filter by status: "proposed", "in_progress", "completed", "cancelled"'),
      practice: z.string().optional().describe('Filter by ITIL practice'),
    }),
    execute: async ({ status, practice }) => {
      return stringify({ status: 'pending_integration', message: 'Improvement initiative listing not yet connected to reporting MCP', filter_status: status, practice });
    },
  }),

  tool({
    name: 'generate_executive_summary',
    description: 'Generate an executive-level ITSM summary — high-level health, risks, and recommendations.',
    parameters: z.object({
      period: z.string().optional().describe('Reporting period: "weekly", "monthly", "quarterly"'),
    }),
    execute: async ({ period }) => {
      return stringify({ status: 'pending_integration', message: 'Executive summary generation not yet connected to reporting MCP', period });
    },
  }),
];
