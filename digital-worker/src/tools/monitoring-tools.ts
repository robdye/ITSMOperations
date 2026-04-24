// ITSM Monitoring and Event Management tools
// ITIL 4 Practice: Monitoring and Event Management
// Side effects: none (all read-only / guidance)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const monitoringTools = [
  tool({
    name: 'get_active_alerts',
    description: 'Retrieve active monitoring alerts from the monitoring backend. READ OPERATION.',
    parameters: z.object({}),
    execute: async () =>
      'Use Application Insights or Azure Monitor integration to retrieve active alerts. Not yet connected to a monitoring backend.',
  }),

  tool({
    name: 'classify_event',
    description: 'Classify a monitoring event as informational, warning, or exception per ITIL 4 event types. READ OPERATION.',
    parameters: z.object({
      event_description: z.string().describe('Description of the monitoring event to classify'),
    }),
    execute: async ({ event_description }) => {
      const lower = event_description.toLowerCase();
      let classification: string;

      if (/critical|down|outage|failure|exception|crash|unresponsive/i.test(lower)) {
        classification = 'EXCEPTION';
      } else if (/warning|threshold|degraded|slow|high utilization|elevated/i.test(lower)) {
        classification = 'WARNING';
      } else {
        classification = 'INFORMATIONAL';
      }

      return stringify({
        event_description,
        classification,
        guidance:
          classification === 'EXCEPTION'
            ? 'Exception detected — trigger incident creation and immediate investigation.'
            : classification === 'WARNING'
              ? 'Warning — monitor closely. If threshold persists, escalate to exception.'
              : 'Informational — log for trending and capacity analysis. No action required.',
      });
    },
  }),

  tool({
    name: 'correlate_events',
    description: 'Correlate monitoring events with recent active incidents and changes. READ OPERATION.',
    parameters: z.object({
      event_description: z.string().describe('Description of the event to correlate'),
    }),
    execute: async ({ event_description }) => {
      const activeIncidents = await mcp.callTool('get-incidents', { state: 'active' });
      return stringify({
        event_description,
        active_incidents: activeIncidents,
        correlation_guidance:
          'Review active incidents and recent changes for overlapping CIs or timeframes. ' +
          'If the event maps to an existing incident, link it. ' +
          'If no correlation exists and the event is an exception, create a new incident.',
      });
    },
  }),
];
