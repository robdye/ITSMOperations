/**
 * Azure Monitor / Log Analytics — Structured operational logging.
 * Complements OpenTelemetry with custom events and KQL query templates.
 */

// ── KQL Query Templates ──
// These can be used in Azure Monitor Workbooks or Log Analytics

export const KQL_TEMPLATES = {
  // Agent activity over time
  agentActivity: `
    customEvents
    | where name startswith "itsm."
    | summarize count() by bin(timestamp, 1h), name
    | render timechart`,

  // Worker routing distribution
  workerRouting: `
    customEvents
    | where name == "itsm.worker.routed"
    | extend workerId = tostring(customDimensions.workerId)
    | summarize count() by workerId
    | render piechart`,

  // HITL approval latency
  hitlLatency: `
    customEvents
    | where name == "itsm.hitl.completed"
    | extend latencyMs = toint(customDimensions.latencyMs)
    | summarize avg(latencyMs), percentile(latencyMs, 95) by bin(timestamp, 1h)
    | render timechart`,

  // Content safety blocks
  safetyBlocks: `
    customEvents
    | where name == "itsm.content_safety.blocked"
    | extend reason = tostring(customDimensions.reason)
    | summarize count() by reason, bin(timestamp, 1d)
    | render barchart`,

  // ServiceNow API latency
  snowApiLatency: `
    dependencies
    | where type == "HTTP" and target contains "service-now.com"
    | summarize avg(duration), percentile(duration, 95), count() by bin(timestamp, 15m)
    | render timechart`,

  // Error rate by worker
  errorsByWorker: `
    exceptions
    | extend workerId = tostring(customDimensions.workerId)
    | summarize count() by workerId, bin(timestamp, 1h)
    | render timechart`,

  // Model usage and token consumption
  modelUsage: `
    customMetrics
    | where name == "gen_ai.client.token.usage"
    | extend model = tostring(customDimensions["gen_ai.request.model"])
    | summarize sum(value) by model, bin(timestamp, 1h)
    | render timechart`,

  // SLA breach prediction accuracy
  slaPrediction: `
    customEvents
    | where name == "itsm.sla.prediction"
    | extend predicted = tobool(customDimensions.predicted_breach)
    | extend actual = tobool(customDimensions.actual_breach)
    | summarize
        total = count(),
        true_positive = countif(predicted and actual),
        false_positive = countif(predicted and not actual),
        false_negative = countif(not predicted and actual)
      by bin(timestamp, 1d)`,

  // Top 10 busiest users
  topUsers: `
    customEvents
    | where name == "itsm.message.received"
    | extend userId = tostring(customDimensions.userId)
    | summarize interactions = count() by userId
    | top 10 by interactions`,
} as const;

// ── Custom Event Tracking ──
// Uses OpenTelemetry API to record custom events that appear in Log Analytics

import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('itsm-log-analytics');

export interface CustomEvent {
  name: string;
  properties: Record<string, string | number | boolean>;
}

/**
 * Track a custom event (appears in Log Analytics customEvents table).
 */
export function trackEvent(event: CustomEvent): void {
  const span = tracer.startSpan(event.name);
  for (const [key, value] of Object.entries(event.properties)) {
    span.setAttribute(key, value);
  }
  span.end();
}

/**
 * Track a metric (appears in Log Analytics customMetrics table).
 */
export function trackMetric(name: string, value: number, dimensions?: Record<string, string>): void {
  const span = tracer.startSpan(`metric.${name}`);
  span.setAttribute('metric.name', name);
  span.setAttribute('metric.value', value);
  if (dimensions) {
    for (const [key, val] of Object.entries(dimensions)) {
      span.setAttribute(key, val);
    }
  }
  span.end();
}

/**
 * Track worker routing for analytics.
 */
export function trackWorkerRouting(workerId: string, intent: string, confidence: number): void {
  trackEvent({
    name: 'itsm.worker.routed',
    properties: { workerId, intent, confidence },
  });
}

/**
 * Track HITL approval completion.
 */
export function trackHitlCompletion(approvalId: string, status: string, latencyMs: number): void {
  trackEvent({
    name: 'itsm.hitl.completed',
    properties: { approvalId, status, latencyMs },
  });
}

/**
 * Track content safety block.
 */
export function trackSafetyBlock(reason: string, inputType: 'input' | 'output'): void {
  trackEvent({
    name: 'itsm.content_safety.blocked',
    properties: { reason, inputType },
  });
}

/**
 * Get available KQL templates for dashboard creation.
 */
export function getKqlTemplates(): Record<string, string> {
  return { ...KQL_TEMPLATES };
}

/**
 * Get Log Analytics status.
 */
export function getLogAnalyticsStatus(): {
  kqlTemplatesAvailable: number;
  tracerName: string;
} {
  return {
    kqlTemplatesAvailable: Object.keys(KQL_TEMPLATES).length,
    tracerName: 'itsm-log-analytics',
  };
}
