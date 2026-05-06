# ITSM Operations — Observability

Observability stack: **OpenTelemetry → Azure Monitor (Application Insights)**.
Everything in this doc is sourced from `digital-worker/src/telemetry.ts` and
the KQL alerts in `infra/modules/monitoring.bicep`.

## OTel attribute cardinality + cost audit

The agent loop emits GenAI semantic-convention spans on every model call,
tool invocation, MCP request, and worker route. The audit below documents
**exactly which attributes ship with each span**, why nothing in that list
contains user content, and where to look if a future change tries to add
one.

### Span: `gen_ai.<operation>` (model inference)
Started in `startInferenceSpan()`. Attributes:

| Attribute                       | Type   | Why it's safe |
|---------------------------------|--------|---------------|
| `gen_ai.system`                 | string | constant `'openai'` |
| `gen_ai.request.model`          | string | model deployment name (low cardinality) |
| `gen_ai.usage.input_tokens`     | int    | counter only |
| `gen_ai.usage.output_tokens`    | int    | counter only |

**Not attached:** prompts, completions, full messages, tool arguments,
tool outputs, system instructions. The OTel semantic-convention guidance
explicitly recommends keeping prompts/completions out of attributes for
cost + cardinality + privacy reasons; we follow that guidance.

### Span: `tool.<name>`
Started in `startToolSpan()`. Attributes:

| Attribute        | Type   | Notes |
|------------------|--------|-------|
| `gen_ai.tool.name` | string | tool function name |
| `worker.id`        | string | worker that invoked it |

No tool arguments, no return values.

### Span: `worker.route`
Started in `startRoutingSpan()`. Attributes:

| Attribute                | Type | Notes |
|--------------------------|------|-------|
| `worker.id`              | string | resolved worker |
| `routing.confidence`     | string | low/medium/high bucket |
| `user.message_length`    | int    | length only — **not the message itself** |

### Span: `mcp.<tool>`
Started in `startMcpSpan()`. Attributes:

| Attribute        | Type   | Notes |
|------------------|--------|-------|
| `mcp.tool`       | string | MCP tool name |
| `mcp.server_url` | string | MCP server URL (low cardinality, fixed per env) |

### Metrics
Emitted via `initMetrics()`:

| Metric                    | Type      | Dimensions |
|---------------------------|-----------|------------|
| `itsm.worker.invocations` | counter   | `worker.id`, `routing.confidence` |
| `itsm.tool.calls`         | counter   | `tool.name`, `worker.id` |
| `itsm.response.latency`   | histogram | `worker.id` |

All dimensions are bounded sets; no per-incident or per-user dimensions.

## Token spend — Realtime / Voice Live alert

Real-time / voice traffic is the most expensive thing Alex can do. Cost
controls live in `infra/modules/monitoring.bicep`:

1. `ITSM-DigitalWorker-TokenUsageSpike-Warning` — global token spike
   (current 1h avg > 2× 7d baseline).
2. `ITSM-DigitalWorker-RealtimeTokenSpike-Critical` — Realtime-only
   token spike (current 1h Realtime tokens > 2× 24h Realtime rolling
   baseline). Severity 1.

The Realtime alert filters on
`gen_ai.request.model` ∈ `{ gpt-realtime, gpt-realtime-2025-08-28 }` so a
day where Voice Live cost is double the previous day pages on its own
without being masked by chat-completions traffic.

## What if I want full prompt/completion logging?

Don't ship it as a span attribute. Use the `reasoning-trace` store
instead — it's already wired into the agent harness, scoped per
conversation, redacted, and readable from Mission Control. It is **not**
exported to Application Insights as a span so cost + cardinality stay
bounded.

## Validating the audit

1. Run an integration call against a non-prod tenant.
2. Open Application Insights → Logs.
3. `dependencies | where name startswith "gen_ai." | project customDimensions`.
4. Confirm the only keys you see are the ones in the tables above.
5. `traces | where timestamp > ago(1h) | summarize count() by length(message)`
   — confirm no message is unusually large (no leaked completions).

If a new keyword appears in customDimensions that isn't in the tables
above, add a regression test in `digital-worker/src/__tests__/telemetry.test.ts`
that asserts the keyword is **not** present and raise a PR to clean it up.
