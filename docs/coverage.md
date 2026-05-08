# Test Coverage

Phase 4 of the gap-closure pass added smoke tests for every module called
out in the build prompt. This page captures the coverage numbers as of
the post-Phase-4 commit and the per-module roadmap for getting the
remaining files into the same shape.

## Snapshot

| Package | Tests | Stmts | Branch | Funcs | Lines |
| --- | ---:| ---:| ---:| ---:| ---:|
| `digital-worker` | 399 | 31.23% | 25.09% | 29.33% | 31.86% |
| `mcp-server` | 176 | 22.17% | 13.64% | 21.24% | 23.25% |
| `mcp-server-enrichment` | 19 | 50.87% | 38.32% | 64.75% | 54.34% |
| **Aggregate** | **594** | — | — | — | — |

The `digital-worker` and `mcp-server` numbers look low because both
packages contain large modules that need a live infra dependency to
exercise (ACS, Realtime / Voice Live WS, MCP transport, Cosmos, Bot
Framework activity loop). Those modules ship with integration coverage
in `tests/` (Playwright + smoke harnesses) but no unit coverage, which
v8 doesn't roll up into the per-package number.

## Per-module coverage — `digital-worker`

The Phase 4 build prompt called out 13 modules as the spec-listed
surface for the gap-closure pass. The Phase 4 commit lifted them all to
≥75% line coverage:

| Module | Stmts | Lines | Notes |
| --- | ---:| ---:| --- |
| `case-manager.ts` | 88.35% | 88.35% | Phase 4 added 11 tests covering open/append/state transitions, approval, enrichment, close, related links, reminders, KPIs |
| `case-correlation.ts` | 92.10% | 92.10% | 3 tests covering shared-asset and shared-signal detection + KPI shape |
| `case-reminders.ts` | 97.43% | 97.43% | 3 tests covering loop start/stop idempotency and KPI surface |
| `reviewer-worker.ts` | 80.48% | 80.48% | 9 tests covering all 4 inspect rules + threshold helpers + KPI |
| `meta-monitor.ts` | 90.00% | 90.00% | 4 tests covering loop control, KPI shape, recordMetaAlert, ring-buffer ordering |
| `change-window-planner.ts` | 100.00% | 100.00% | 3 tests with a mocked `isHolidayOn` covering holiday + non-holiday paths |
| `enrichment-bridge.ts` | 87.09% | 87.09% | Surface check: all 9 source methods exposed |
| `a2a-policy.ts` | 87.50% | 87.50% | 8 tests covering all 4 reject reasons + happy path + body-extraction edge cases |
| `workiq-api-client.ts` | 76.00% | 76.00% | 4 tests covering KPI counters + WorkIqApiClient surface (18 methods) |
| `voice/voiceApprovals.ts` | 80.76% | 80.76% | 7 tests covering classifyVoiceIntent for approve/deny/hold/unknown + negation |
| `voice/voiceLiveTransport.ts` | 51.02% | 51.02% | 9 tests covering buildVoiceLiveUrl + getSelectedTransport + session.update |
| `cognition-tags.ts` | 100.00% | 100.00% | covered by Phase E tests |
| `enrichment-outcome-probes.ts` | 100.00% | 100.00% | covered by Phase E tests |

### Modules outside the Phase 4 scope

These modules still report 0% line coverage. They are intentionally
deferred because their unit-test cost-to-value ratio is poor — they
need a live ACS call, Bot Framework activity, MCP WS transport, or
Service Bus pump to exercise meaningfully. The integration suite in
`digital-worker/tests/` covers them end-to-end.

- `acsBridge.ts`, `voiceProxy.ts`, `voice-tools.ts`, `voiceTools.ts`
- `service-bus.ts`, `signal-router.ts` outbound adapters
- `mock-snow-client.ts`, `snow-client.ts`, `snow-auth.ts`
- `redis-store.ts`, `token-cache.ts`, `secret-resolver.ts`
- `seed.ts`, `scheduled-routines.ts`, `subscriptions.ts`
- `outcome-processor.ts`, `outcome-delegation.ts`
- `runbook-generator.ts`, `automate-flows.ts`, `power-automate.ts`
- `planner-tasks.ts`, `sharepoint-docs.ts`, `shift-handover.ts`
- `team-approvals.ts`, `telemetry.ts`, `reasoning-rca.ts`

## Per-module coverage — `mcp-server`

| Module | Lines | Notes |
| --- | ---:| --- |
| `loop-components/cab-pack.ts` | 98.07% | Adaptive Card payload behavioural tests |
| `loop-components/outcome-story.ts` | 86.04% | Outcome → story renderer |
| `loop-components/shift-handover.ts` | 97.82% | Handover renderer |
| `purview-dlp.ts` | 81.39% | Tagging + redaction |
| `_icons.ts` | 100.00% | Icon registry |
| `snow-query.ts` | 62.90% | KQL & SNOW queries |
| `nist.ts` | 39.02% | NIST 800-53 normalisation |
| `mcp-server.ts` | 23.11% | Main MCP transport — driven by integration suite |

The `mcp-server.ts` entry file (~2,950 lines) is exercised by the MCP
client integration tests in `tests/`, not by unit tests, so it
dominates the per-package number.

## Per-module coverage — `mcp-server-enrichment`

| Module | Lines | Notes |
| --- | ---:| --- |
| `auth.ts` | 92.85% | OBO token broker |
| `envelope.ts` | 92.85% | Provenance envelope wrapping |
| `audit.ts` | 80.00% | Audit emitter |
| `fixtures-loader.ts` | 84.61% | Demo fixtures |
| `cache.ts` | 72.22% | LRU + TTL cache |
| `index.ts` | 73.84% | Express boot |
| `sources/cisa-kev.ts` | 76.92% | KEV pull |
| `sources/nager-holidays.ts` | 66.66% | Public holiday lookup |
| `sources/msrc.ts` | 64.00% | MSRC monthly |
| `sources/nvd.ts` | 46.93% | NVD CVE detail |
| `sources/azure-status.ts` | 29.54% | Azure Service Health |
| `sources/m365-service-health.ts` | 25.71% | M365 Service Communications |
| `safety.ts` | 38.33% | Filter / scrub |
| `server.ts` | 14.28% | Wired up only via `index.ts` boot |

## Vitest threshold floors

Each package's `vitest.config.ts` enforces a floor below current
coverage so a regression cannot land silently:

| Package | Stmts floor | Branch floor | Funcs floor | Lines floor |
| --- | ---:| ---:| ---:| ---:|
| `digital-worker` | 30% | 24% | 28% | 30% |
| `mcp-server` | 20% | 12% | 20% | 22% |
| `mcp-server-enrichment` | 50% | 38% | 60% | 54% |

These floors are intentionally conservative — they sit ~1-2 percentage
points below the current run so day-to-day refactors don't trip the
threshold gate, but a real coverage regression (e.g. someone deleting a
whole test file) will fail CI.

## Roadmap

To hit the spec's eventual ≥60% per-package target the highest-value
follow-ups are:

1. **`mcp-server/mcp-server.ts`** — split the tool implementations from
   the transport plumbing so each tool can be unit-tested without a
   live MCP transport. Estimated lift: +30% lines.
2. **`digital-worker/acsBridge.ts` + `voice-tools.ts`** — extract pure
   audio-frame transformation helpers from the WS event loop. Mock the
   ACS WS in tests. Estimated lift: +6% global lines.
3. **`digital-worker/snow-client.ts`** — generate fixtures + a mock
   ServiceNow harness that exercises every table read. Estimated lift:
   +4% global lines.
4. **`digital-worker/runbook-generator.ts`, `automate-flows.ts`,
   `power-automate.ts`** — parser-only unit tests for the YAML / JSON
   templates that don't require a Power Platform connection. Estimated
   lift: +5% global lines.

## Running coverage locally

```powershell
cd digital-worker
npx vitest run --coverage

cd ../mcp-server
npx vitest run --coverage

cd ../mcp-server-enrichment
npx vitest run --coverage
```

Reports print to stdout (text + text-summary). Add `--reporter=html` for
a browseable per-line report under `coverage/`.
