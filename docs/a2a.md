# Agent-to-Agent (A2A) inbound policy

The `digital-worker` service exposes a Bot Framework `/api/messages`
endpoint that any peer agent can call. Inbound A2A traffic is governed
by `digital-worker/src/a2a-policy.ts`, which enforces three layers of
checks before the message reaches the agent loop, plus emits an audit
record for every decision (allow or reject).

This page documents the policy, the env-var surface, the operator
console KPI feed, and the audit shape.

## Decision flow

```
inbound /api/messages
        │
        ▼
   activity body  ──▶  extractA2AContextFromBody(headers, body)
                        │
                        ▼
                  evaluateInboundA2A({ callerAgentId, intent, preview })
                        │
        ┌────────────────┼────────────────────────────────┐
        │                │                                │
        ▼                ▼                                ▼
  governance      caller checks                     scope match
  (kill-switch,   (allow-list,                      (intent prefix
   change-freeze)  rate limit)                       in scope map)
        │                │                                │
        └────────┬───────┴────────────────────────────────┘
                 │
                 ▼
             allow / reject  ──▶  audit log + KPI counters
```

## Reject reasons

| Reason | Cause |
| --- | --- |
| `killed` | Kill-switch is engaged. Every A2A request is rejected until the operator clears it. |
| `frozen` | Change-freeze is active. A2A is blocked to prevent peer agents from driving changes during a freeze. |
| `missing-agent-id` | Inbound request did not include an `x-agent-id` header (or the body's caller field). |
| `agent-not-allowed` | `callerAgentId` is not on the `A2A_ALLOWED_AGENTS` list and the list is not `*`. |
| `rate-limited` | Caller exceeded `A2A_RATE_LIMIT_PER_HOUR` (default 60) within a sliding 1-hour window. |
| `scope-denied` | Caller is allow-listed but the message intent is outside its declared scope in `A2A_AGENT_SCOPES`. |

## Configuration

A2A policy is driven entirely from environment variables — there is no
admin UI for it (operators toggle the kill-switch and change-freeze
from Mission Control instead).

| Variable | Default | What it does |
| --- | --- | --- |
| `A2A_ALLOWED_AGENTS` | unset (deny all) | Comma-separated list of `callerAgentId`s, or `*` for any. The string is lowercased before comparison. |
| `A2A_AGENT_SCOPES` | falls back to a built-in map | JSON map of `callerAgentId → string[]` of allowed intent prefixes. Use a trailing dot for prefix match (`incident.`) or an exact match (`incident.lookup`). `['*']` is the wildcard. |
| `A2A_RATE_LIMIT_PER_HOUR` | `60` | Per-caller cap. Counts reset on a 1-hour sliding window per caller. |

### Built-in scope defaults

If `A2A_AGENT_SCOPES` is unset, a small set of well-known peer agents
get reasonable defaults so they don't hard-fail in dev:

```json
{
  "portfolio-pm":  ["*"],
  "fabric-admin":  ["fabric.", "workspace.", "capacity."],
  "finops-agent":  ["cost.", "budget.", "forecast."],
  "service-now":   ["*"]
}
```

## Intent classification

The intent is the first whitespace-delimited token of the message body's
`text` field, lowercased. So `text: "incident.lookup INC0001"` ↦
`intent = "incident.lookup"`. For natural-language messages from peer
agents this gives a reasonable proxy without forcing a structured
schema. The match function:

- if scope entry ends with `.` → prefix match (`"incident."` matches `"incident.lookup"`)
- otherwise → exact match
- `*` → always allow

## Audit shape

Every decision (allow or reject) emits an `auditTrail` row through
`logAuditEntry`. The row carries:

```json
{
  "workerId": "a2a-policy",
  "workerName": "A2A Inbound Policy",
  "toolName": "a2a.allow | a2a.reject",
  "riskLevel": "notify | block",
  "triggeredBy": "<callerAgentId>",
  "triggerType": "a2a",
  "parameters": "{\"callerAgentId\":\"...\",\"intent\":\"...\",\"preview\":\"...\"}",
  "resultSummary": "rejected: scope-denied — intent='change.create' not in scope",
  "requiredConfirmation": false,
  "durationMs": 0
}
```

The `preview` field is truncated to 200 characters. Audit failures are
swallowed (best-effort) so the policy never throws on the inbound
message path.

## KPI surface

`a2a-policy.ts` keeps an in-memory KPI struct that's exposed at
`GET /api/a2a/kpi`:

```ts
interface A2APolicyKpi {
  attempts: number;
  allowed: number;
  rejected: number;
  byReason: {
    killed: number;
    frozen: number;
    'missing-agent-id': number;
    'agent-not-allowed': number;
    'rate-limited': number;
    'scope-denied': number;
  };
  /** Top 10 callers by attempts (rolling). */
  topCallers: Array<{ agentId: string; attempts: number }>;
  uptimeSec: number;
}
```

Mission Control's **A2A Activity** panel reads this every 5 seconds.

## Operator runbook

- **Kill all A2A**: toggle the kill-switch. Every inbound request will
  reject with `killed`. Used during incidents.
- **Block one peer**: remove its `callerAgentId` from
  `A2A_ALLOWED_AGENTS` and restart the digital-worker container
  (`az containerapp revision restart`). The change picks up at next
  cold start; in-flight requests complete normally.
- **Tighten scope**: add or refine an entry in `A2A_AGENT_SCOPES`.
  Restart required.
- **Investigate a reject**: filter the audit table for
  `WorkerId == 'a2a-policy' and ToolName == 'a2a.reject'` over the
  incident window. The `parameters` field contains the message preview
  for the rejected attempt.

## Tests

A2A policy is covered by 8 smoke tests in
[`digital-worker/src/__tests__/a2a-policy.test.ts`](../digital-worker/src/__tests__/a2a-policy.test.ts):

- `extractA2AContextFromBody` — header string, header array, missing both
- `evaluateInboundA2A` — missing-agent-id, agent-not-allowed,
  wildcard-allow, scope-denied, scope-allow

The kill-switch and change-freeze paths are exercised in the
`kill-switch.test.ts` and `change-freeze.test.ts` suites.
