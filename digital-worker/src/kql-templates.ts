/**
 * KQL Query Templates — ITSM Monitoring & Alerting.
 * Provides reusable Kusto Query Language templates for Azure Monitor
 * alert rules, Log Analytics workbooks, and dashboards.
 */

// ── KQL Query Templates ──

export const KQL_QUERIES = {
  /** Agent error rate over the last 1 hour */
  agentErrorRate: `
    let timeRange = 1h;
    let totalRequests = customEvents
      | where timestamp > ago(timeRange)
      | where name startswith "itsm."
      | summarize total = count();
    let errors = exceptions
      | where timestamp > ago(timeRange)
      | where customDimensions has "itsm"
      | summarize errorCount = count();
    totalRequests | join kind=inner errors on $left.total == $left.total
    | extend errorRate = round(todouble(errorCount) / todouble(total) * 100, 2)
    | project errorRate, total, errorCount`,

  /** Tool call latency percentiles (P50/P95/P99) */
  toolCallLatency: `
    customEvents
    | where name == "itsm.tool.call.completed"
    | where timestamp > ago(1h)
    | extend durationMs = todouble(customDimensions.durationMs)
    | extend toolName = tostring(customDimensions.toolName)
    | extend workerId = tostring(customDimensions.workerId)
    | summarize
        p50 = percentile(durationMs, 50),
        p95 = percentile(durationMs, 95),
        p99 = percentile(durationMs, 99),
        callCount = count()
      by toolName, bin(timestamp, 5m)
    | order by timestamp desc`,

  /** HITL approval response times */
  hitlApprovalResponseTimes: `
    customEvents
    | where name == "itsm.hitl.completed"
    | where timestamp > ago(24h)
    | extend latencyMs = todouble(customDimensions.latencyMs)
    | extend approvalStatus = tostring(customDimensions.status)
    | extend workerId = tostring(customDimensions.workerId)
    | summarize
        avgResponseMs = avg(latencyMs),
        p50ResponseMs = percentile(latencyMs, 50),
        p95ResponseMs = percentile(latencyMs, 95),
        totalApprovals = count(),
        approved = countif(approvalStatus == "approved"),
        rejected = countif(approvalStatus == "rejected"),
        timedOut = countif(approvalStatus == "timed_out")
      by bin(timestamp, 1h)
    | order by timestamp desc`,

  /** ServiceNow API error rate */
  serviceNowApiErrorRate: `
    dependencies
    | where type == "HTTP" and target contains "service-now.com"
    | where timestamp > ago(1h)
    | summarize
        totalCalls = count(),
        failedCalls = countif(success == false),
        errorRate = round(countif(success == false) * 100.0 / count(), 2)
      by bin(timestamp, 5m)
    | order by timestamp desc`,

  /** Token usage by model and worker */
  tokenUsageByModelWorker: `
    customMetrics
    | where name == "gen_ai.client.token.usage"
    | where timestamp > ago(24h)
    | extend model = tostring(customDimensions["gen_ai.request.model"])
    | extend workerId = tostring(customDimensions["worker.id"])
    | extend tokenType = tostring(customDimensions["gen_ai.token.type"])
    | summarize
        totalTokens = sum(value),
        avgTokensPerCall = avg(value),
        callCount = count()
      by model, workerId, tokenType, bin(timestamp, 1h)
    | order by totalTokens desc`,

  /** Failed content safety checks */
  failedContentSafetyChecks: `
    customEvents
    | where name == "itsm.content_safety.blocked"
    | where timestamp > ago(24h)
    | extend reason = tostring(customDimensions.reason)
    | extend inputType = tostring(customDimensions.inputType)
    | extend workerId = tostring(customDimensions.workerId)
    | summarize
        blockCount = count(),
        distinctReasons = dcount(reason)
      by reason, inputType, workerId, bin(timestamp, 1h)
    | order by blockCount desc`,

  /** Conversation volume trends */
  conversationVolumeTrends: `
    customEvents
    | where name == "itsm.message.received"
    | where timestamp > ago(7d)
    | extend userId = tostring(customDimensions.userId)
    | extend channelType = tostring(customDimensions.channelType)
    | summarize
        messageCount = count(),
        uniqueUsers = dcount(userId)
      by channelType, bin(timestamp, 1h)
    | order by timestamp desc`,

  /** SLA breach prediction accuracy */
  slaBreachPredictionAccuracy: `
    customEvents
    | where name == "itsm.sla.prediction"
    | where timestamp > ago(7d)
    | extend predicted = tobool(customDimensions.predicted_breach)
    | extend actual = tobool(customDimensions.actual_breach)
    | extend incidentPriority = tostring(customDimensions.priority)
    | summarize
        total = count(),
        truePositive = countif(predicted and actual),
        falsePositive = countif(predicted and not(actual)),
        trueNegative = countif(not(predicted) and not(actual)),
        falseNegative = countif(not(predicted) and actual)
      by incidentPriority, bin(timestamp, 1d)
    | extend accuracy = round((truePositive + trueNegative) * 100.0 / total, 2)
    | extend precision = iff(truePositive + falsePositive > 0, round(truePositive * 100.0 / (truePositive + falsePositive), 2), 0.0)
    | extend recall = iff(truePositive + falseNegative > 0, round(truePositive * 100.0 / (truePositive + falseNegative), 2), 0.0)
    | order by timestamp desc`,

  /** Worker routing distribution */
  workerRoutingDistribution: `
    customEvents
    | where name == "itsm.worker.routed"
    | where timestamp > ago(24h)
    | extend workerId = tostring(customDimensions.workerId)
    | extend intent = tostring(customDimensions.intent)
    | extend confidence = todouble(customDimensions.confidence)
    | summarize
        routeCount = count(),
        avgConfidence = avg(confidence),
        minConfidence = min(confidence)
      by workerId, intent, bin(timestamp, 1h)
    | order by routeCount desc`,

  /** Reasoning trace duration */
  reasoningTraceDuration: `
    customEvents
    | where name == "itsm.reasoning.trace"
    | where timestamp > ago(24h)
    | extend durationMs = todouble(customDimensions.durationMs)
    | extend traceSteps = toint(customDimensions.stepCount)
    | extend workerId = tostring(customDimensions.workerId)
    | extend traceType = tostring(customDimensions.traceType)
    | summarize
        avgDurationMs = avg(durationMs),
        p50DurationMs = percentile(durationMs, 50),
        p95DurationMs = percentile(durationMs, 95),
        p99DurationMs = percentile(durationMs, 99),
        avgSteps = avg(traceSteps),
        traceCount = count()
      by workerId, traceType, bin(timestamp, 1h)
    | order by timestamp desc`,

  // ── Alert-specific queries ──

  /** ALERT: Agent error rate > threshold (used in alert rules) */
  alertAgentErrorRateHigh: `
    let timeRange = 1h;
    let total = toscalar(
      customEvents
      | where timestamp > ago(timeRange) and name startswith "itsm."
      | count
    );
    exceptions
    | where timestamp > ago(timeRange)
    | where customDimensions has "itsm"
    | summarize errorCount = count()
    | extend errorRate = round(todouble(errorCount) / todouble(total) * 100, 2)
    | where errorRate > 5`,

  /** ALERT: P95 tool latency > 10s */
  alertToolLatencyHigh: `
    customEvents
    | where name == "itsm.tool.call.completed"
    | where timestamp > ago(15m)
    | extend durationMs = todouble(customDimensions.durationMs)
    | summarize p95 = percentile(durationMs, 95) by bin(timestamp, 5m)
    | where p95 > 10000`,

  /** ALERT: ServiceNow API failures > 10 in 5 min */
  alertServiceNowFailuresHigh: `
    dependencies
    | where type == "HTTP" and target contains "service-now.com"
    | where timestamp > ago(5m)
    | where success == false
    | summarize failureCount = count()
    | where failureCount > 10`,

  /** ALERT: Token usage spike (>2x baseline) */
  alertTokenUsageSpike: `
    let baseline = toscalar(
      customMetrics
      | where name == "gen_ai.client.token.usage"
      | where timestamp between (ago(7d) .. ago(1d))
      | summarize avg(value)
    );
    customMetrics
    | where name == "gen_ai.client.token.usage"
    | where timestamp > ago(1h)
    | summarize currentAvg = avg(value)
    | where currentAvg > baseline * 2`,

  /** ALERT: HITL approvals pending > 30 min */
  alertHitlApprovalsPending: `
    customEvents
    | where name == "itsm.hitl.requested"
    | where timestamp > ago(24h)
    | extend approvalId = tostring(customDimensions.approvalId)
    | join kind=leftanti (
        customEvents
        | where name == "itsm.hitl.completed"
        | where timestamp > ago(24h)
        | extend approvalId = tostring(customDimensions.approvalId)
      ) on approvalId
    | where timestamp < ago(30m)
    | summarize pendingCount = count()
    | where pendingCount > 0`,
} as const;

/** Get a KQL query by name */
export function getKqlQuery(name: keyof typeof KQL_QUERIES): string {
  return KQL_QUERIES[name];
}

/** Get all KQL query names */
export function getKqlQueryNames(): string[] {
  return Object.keys(KQL_QUERIES);
}
