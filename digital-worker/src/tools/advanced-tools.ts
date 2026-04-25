// ITSM Operations — Advanced Tools (Wave 2)
// Wraps reasoning RCA, vision processing, and Adaptive Card capabilities as agent tools.

import { tool } from '@openai/agents';
import { z } from 'zod';
import { analyzeRootCause, generateFiveWhys, generatePostIncidentReview } from '../reasoning-rca';
import { processScreenshot, processVendorPDF } from '../vision-processor';
import {
  buildCABVotingCard,
  buildApprovalCard,
} from '../adaptive-cards';
import { autonomousActions } from '../autonomous-actions';

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const advancedTools = [
  // ── Reasoning RCA Tools ──

  tool({
    name: 'analyze_root_cause',
    description:
      'Route incident/problem data to a reasoning model for deep Root Cause Analysis. Returns structured RCA with chain-of-thought, confidence, and recommendations.',
    parameters: z.object({
      incident_id: z.string().describe('Primary incident ID'),
      title: z.string().describe('Incident title'),
      description: z.string().describe('Incident description'),
      severity: z.string().describe('Severity level (P1-P4)'),
      affected_ci: z.string().optional().describe('Affected configuration item'),
      related_incidents: z
        .array(
          z.object({
            incidentId: z.string(),
            title: z.string(),
            description: z.string(),
            severity: z.string(),
          })
        )
        .optional()
        .describe('Related incidents for pattern analysis'),
      recent_changes: z
        .array(
          z.object({
            changeId: z.string(),
            description: z.string(),
            date: z.string(),
          })
        )
        .optional()
        .describe('Recent changes on the affected CI'),
    }),
    execute: async (params) => {
      const incident = {
        incidentId: params.incident_id,
        title: params.title,
        description: params.description,
        severity: params.severity,
        affectedCI: params.affected_ci,
      };
      const related = (params.related_incidents ?? []).map((r) => ({
        incidentId: r.incidentId,
        title: r.title,
        description: r.description,
        severity: r.severity,
      }));
      const cmdb = {
        ciName: params.affected_ci ?? 'Unknown',
        recentChanges: params.recent_changes,
      };
      const result = await analyzeRootCause(incident, related, cmdb);
      return stringify(result);
    },
  }),

  tool({
    name: 'generate_five_whys',
    description: 'Generate a Five-Whys root cause analysis for a problem statement. Returns the causal chain and actionable recommendations.',
    parameters: z.object({
      problem: z.string().describe('Problem statement to analyze'),
      context: z.string().describe('Additional context (affected services, timeline, etc.)'),
    }),
    execute: async ({ problem, context }) => {
      const result = await generateFiveWhys(problem, context);
      return stringify(result);
    },
  }),

  tool({
    name: 'generate_pir',
    description:
      'Generate a full Post-Incident Review document using a reasoning model. Returns structured PIR with analysis, chain-of-thought, and action items.',
    parameters: z.object({
      incident_id: z.string().describe('Incident ID'),
      title: z.string().describe('Incident title'),
      severity: z.string().describe('Severity level'),
      description: z.string().describe('Incident description'),
      timeline: z
        .array(z.object({ time: z.string(), event: z.string() }))
        .describe('Incident timeline events'),
      resolution: z.string().describe('How the incident was resolved'),
    }),
    execute: async (params) => {
      const incident = {
        incidentId: params.incident_id,
        title: params.title,
        description: params.description,
        severity: params.severity,
      };
      const result = await generatePostIncidentReview(incident, params.timeline, params.resolution);
      return stringify(result);
    },
  }),

  // ── Vision Processing Tools ──

  tool({
    name: 'process_screenshot',
    description:
      'Analyze an error screenshot using GPT-4o vision. Extracts error codes, messages, affected services, and severity for incident triage.',
    parameters: z.object({
      image_base64: z.string().describe('Base64-encoded image data (PNG or JPEG)'),
    }),
    execute: async ({ image_base64 }) => {
      const result = await processScreenshot(image_base64);
      return stringify(result);
    },
  }),

  tool({
    name: 'process_document',
    description:
      'Extract structured data from a document or PDF image using vision. Useful for vendor RCA docs, contracts, and technical bulletins.',
    parameters: z.object({
      document_base64: z.string().describe('Base64-encoded document image or PDF page'),
    }),
    execute: async ({ document_base64 }) => {
      const result = await processVendorPDF(document_base64);
      return stringify(result);
    },
  }),

  // ── Adaptive Card Tools ──

  tool({
    name: 'send_cab_vote_card',
    description:
      'Send a CAB Voting Adaptive Card to a Teams channel. CAB members can approve, reject, or defer with comments.',
    parameters: z.object({
      channel_id: z.string().describe('Teams channel ID to post to'),
      change_id: z.string().describe('Change ID (e.g., CHG0012345)'),
      title: z.string().describe('Change title'),
      risk: z.string().describe('Risk level (Low/Medium/High)'),
      rollback: z.string().describe('Rollback plan summary'),
      implementer: z.string().describe('Name of the implementer'),
    }),
    execute: async ({ channel_id, change_id, title, risk, rollback, implementer }) => {
      const cardJson = buildCABVotingCard(change_id, title, risk, rollback, implementer);
      const result = await autonomousActions.sendAdaptiveCard(channel_id, cardJson as unknown as Record<string, unknown>);
      return stringify({ cardSent: result.success, messageId: result.id, error: result.error });
    },
  }),

  tool({
    name: 'send_approval_card',
    description: 'Send a generic Approval Adaptive Card to a Teams channel. Supports approve/reject with comments.',
    parameters: z.object({
      channel_id: z.string().describe('Teams channel ID to post to'),
      request_id: z.string().describe('Request ID'),
      type: z.string().describe('Request type (e.g., "Access Request", "Procurement")'),
      description: z.string().describe('Request description'),
      requestor: z.string().describe('Name of the requestor'),
    }),
    execute: async ({ channel_id, request_id, type, description, requestor }) => {
      const cardJson = buildApprovalCard(request_id, type, description, requestor);
      const result = await autonomousActions.sendAdaptiveCard(channel_id, cardJson as unknown as Record<string, unknown>);
      return stringify({ cardSent: result.success, messageId: result.id, error: result.error });
    },
  }),
];
