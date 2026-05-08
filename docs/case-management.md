# Case management

The Cases system in `digital-worker` is the persistent unit of work
that holds an incident, change, problem, or shadow-agent investigation
together across the multi-step agent loop. It is implemented in three
modules:

- [`case-manager.ts`](../digital-worker/src/case-manager.ts) — CRUD,
  state machine, KPI, in-memory + Cosmos backing store.
- [`case-correlation.ts`](../digital-worker/src/case-correlation.ts)
  — link discovery between cases (shared assets, shared signals).
- [`case-reminders.ts`](../digital-worker/src/case-reminders.ts) —
  reminder loop that nags the on-call when a case sits idle.

This page documents the lifecycle, the persistence layout, the API
surface, and the operator console feed.

## Lifecycle

```
            openCase(...)
                 │
                 ▼
            ┌─────────┐
            │ open    │ ◀─────────────┐
            └────┬────┘               │ setState('open')
                 │                    │
                 ▼ setState           │
            ┌─────────┐               │
            │ pending │ ──────────────┘
            └────┬────┘
                 │ recordApprovalDecision()
                 ▼
            ┌─────────┐                ┌──────────┐
            │ working │ ─────────────▶ │ closed   │
            └─────────┘  setState      └──────────┘
                         appendActivity / appendEnrichment / addRelatedSignal
                         can be called in any non-closed state
```

Valid states: `open`, `pending`, `working`, `closed`. Each transition
emits an `appendActivity` entry with the actor and reason so the
audit timeline is complete without separate audit calls.

## Persistence

### Cosmos DB (production)

Container: `AlexCases`, partition key: `/tenantId`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | UUID. Same as Cosmos `id`. |
| `tenantId` | string | Partition key. Always set to the AAD tenant id. |
| `subject` | string | Free text, indexed for `findCaseBySubject`. |
| `state` | enum | `open` / `pending` / `working` / `closed`. |
| `createdAt` | ISO 8601 | UTC. |
| `closedAt` | ISO 8601? | Set on close. |
| `nextReminderAt` | ISO 8601? | When the reminder loop should nag. |
| `activity` | array | Append-only timeline of `{ ts, actor, kind, message }`. |
| `enrichment` | array | Provenance-tagged enrichment results from `enrichmentBridge`. |
| `approvals` | array | `{ approvalId, requestedAt, approver, decidedAt?, decision?, reason? }`. |
| `relatedSignals` | array | `{ signalId, kind, addedAt }`. |
| `relatedWorkflows` | array | `{ workflowId, kind, addedAt }`. |
| `closeReason` | string? | Filled by the close call. |

### In-memory fallback (dev / test)

If Cosmos is not configured (no `COSMOS_ENDPOINT`), the same surface
is served from a `Map<string, Case>` so unit tests and local dev work
without an Azure dependency. The fallback is what powers the 11 cases
smoke tests in
[`__tests__/case-manager.test.ts`](../digital-worker/src/__tests__/case-manager.test.ts).

## Public surface

### `case-manager.ts`

```ts
openCase(input: { subject: string; createdBy?: string; tenantId?: string }): Promise<Case>;
getCase(id: string): Promise<Case | null>;
findCaseBySubject(subject: string): Promise<Case | null>;
listOpenCases(): Promise<Case[]>;
listCasesDueForReminder(now?: Date): Promise<Case[]>;

setState(id: string, state: 'open' | 'pending' | 'working', actor: string, reason?: string): Promise<void>;
appendActivity(id: string, entry: { actor: string; kind: string; message: string }): Promise<void>;
appendEnrichment(id: string, env: { source: string; summary: string; detail?: unknown }): Promise<void>;
addRelatedSignal(id: string, signalId: string, kind?: string): Promise<void>;
addRelatedWorkflow(id: string, workflowId: string, kind?: string): Promise<void>;
setNextReminder(id: string, when: Date): Promise<void>;

recordApprovalRequest(id: string, approvalId: string, approver?: string): Promise<void>;
recordApprovalDecision(id: string, approvalId: string, decision: 'approved' | 'denied', reason?: string): Promise<void>;

close(id: string, actor: string, reason: string): Promise<void>;

getCaseKpi(): { open: number; closed: number; pending: number; working: number; uptimeSec: number; ... };
```

### `case-correlation.ts`

```ts
findRelatedCases(caseId: string): Promise<RelatedCase[]>;
getCorrelationKpi(): { lookups: number; matches: number; sharedAssetMatches: number; sharedSignalMatches: number; uptimeSec: number };
```

Two correlation rules ship out of the box:

1. **Shared signals** — two cases that have the same `relatedSignals[].signalId`.
2. **Shared assets** — two cases whose `subject` contains the same CMDB
   asset id (matched via the `enrichment.cmdb.lookup` provenance tag).

### `case-reminders.ts`

```ts
startCaseReminderLoop(): void;   // idempotent
stopCaseReminderLoop(): void;    // safe to call when not running
getReminderKpi(): { ticks: number; remindersFired: number; escalations: number; nagsPerHour: number; uptimeSec: number };
```

The loop ticks every minute and `listCasesDueForReminder()` returns
cases whose `nextReminderAt` is in the past. For each, the reminder
emits an Adaptive Card to the case owner and bumps `nextReminderAt`
by an exponentially-backing-off interval (5m → 15m → 1h → 4h →
escalate).

## Operator console

Mission Control's **Cases** panel polls `GET /api/cases/kpi` every 5
seconds and surfaces:

- Open / pending / working / closed counts (live)
- Cases due for reminder in the next hour
- The 5 longest-running open cases, with the actor who opened them
- A breakdown of `closeReason` values over the last 24h (success vs.
  cancelled vs. timed-out)

Operators can drill into any case by clicking the row, which loads the
full activity + enrichment + approvals timeline.

## NIST 800-53 mapping

Cases are the system of record for the **AU** (audit) and **AC**
(access control) families. Specifically:

- AU-2 / AU-3: every state transition + approval + enrichment is an
  append-only timeline entry with actor and timestamp.
- AC-3: state machine prevents writes to closed cases.
- AC-4: enrichment provenance carries the source URL + fixture flag so
  reviewers can verify the data origin during a CAB.

## Tests

- 11 smoke tests in
  [`__tests__/case-manager.test.ts`](../digital-worker/src/__tests__/case-manager.test.ts).
- 3 smoke tests in
  [`__tests__/case-correlation.test.ts`](../digital-worker/src/__tests__/case-correlation.test.ts).
- 3 smoke tests in
  [`__tests__/case-reminders.test.ts`](../digital-worker/src/__tests__/case-reminders.test.ts).
- Coverage: case-manager 88%, case-correlation 92%, case-reminders 97%.
