# Phase E — Enrichment MCP Server Architecture

> **Mission:** Give Alex (the digital worker) safe, bounded, observable access to five free public threat / availability / calendar feeds — without ever doing direct HTTP from the agent loop.

## Why a separate MCP server?

The agent runtime in `digital-worker/` is the only thing that holds an OBO token, a TurnContext, and the customer's tenant. We could have used `node-fetch` from inside `digital-worker/src/` and called it a day. We didn't. Three reasons:

1. **Provenance is auditable.** Every external call goes through one chokepoint that stamps a provenance envelope — `source`, `sourceUrl`, `cacheHit`, `fixtureUsed`, `fetchedAt`. No source-of-truth for "did Alex really cite CISA?" disagreement.
2. **Caching is shared.** A single 1-hour TTL on the KEV catalog beats 50 workers each minting their own copy. The MCP server is the cache.
3. **Demo isolation is mechanical, not aspirational.** When `x-itsm-profile: demo` is on the request, the source modules read from `__fixtures__/*.json` instead of calling the public API. The fixture path is the only branch — there's no other way for fixture mode to "leak" a live call.

## Topology

```
┌─────────────────────────┐         OBO + x-ms-tenant-id + x-caller-agent-id
│  digital-worker (3978)  │  ────────────────────────────────►  ┌────────────────────────────┐
│                         │  StreamableHTTP (MCP)                │  mcp-server-enrichment    │
│  enrichment-bridge.ts   │                                      │  (3010)                    │
│   • lookupKev           │  ◄─────────────  envelope.data       │                            │
│   • cveDetail           │                  + envelope.provenance│  KEV    NVD    MSRC       │
│   • msrcMonthly         │                                      │  Status M365   Holidays   │
│   • azureStatus         │                                      │  + cache + safety + audit │
│   • holidaysByCountry   │                                      └────────────────────────────┘
└─────────────────────────┘                                                   │
            │                                                                 │
            │  signal-router.publish(enrichment.kev.match)                    ▼
            ▼                                                       Public APIs (when prod)
   workflow-subscriptions:                                          OR  __fixtures__/*.json (when demo)
     KEV  → major-incident-response (severity:critical)
     MSRC → vulnerability-to-change
     Azure → cognition-graph upstream-degraded:<region> (30m)
```

## The envelope

Every tool returns the same shape:

```ts
interface EnrichmentEnvelope<T> {
  data: T;                    // The source-specific payload
  provenance: {
    source: string;           // e.g. 'cisa-kev'
    sourceUrl: string;        // The canonical upstream URL
    fetchedAt: string;        // ISO timestamp
    cacheHit: boolean;        // true ⇒ MCP returned a hot copy
    fixtureUsed: boolean;     // true ⇒ demo mode, no live call
    cacheTtlMs: number;       // The TTL that was applied
    notes?: string;           // Free-form: rate-limit hits, retry-after, etc.
  };
}
```

The bridge re-exports `EnvelopeProvenance` and `EnrichmentEnvelope<T>` so consumers (case-manager, change-window-planner, outcome probes) can type-check against the same shape.

## Caching policy

| Source | TTL | Rationale |
|--------|-----|-----------|
| CISA KEV | 1h | Catalog is authoritative; daily updates at most. 1h is a sane middle-ground. |
| NIST NVD CVE detail | 6h | Per-CVE data is stable once published. NVD's polite use guidance suggests caching. |
| MSRC monthly CVRF | 24h | Patch Tuesday cadence — one fetch per day is plenty. |
| Azure Status feed | 60s | Need to be fast on the leading edge of an incident. 60s keeps a single replica's RPS bounded. |
| M365 Service Health | 5m | Graph API is rate-limited per app; 5m matches the typical SLA-update cadence of the underlying Service Communications API. |
| Nager.Date holidays | 30d | National-holiday data only changes annually. 30d is conservative. |

The cache is in-memory per-replica. We deliberately do NOT use Redis here — keeping the cache process-local means: (a) no cross-tenant cache pollution, (b) no extra failure mode on Redis outage, (c) trivially testable.

## Safety pipeline

`safety.ts` wraps every outbound payload before it can be returned to the bridge:

1. **Content Safety** (when `CONTENT_SAFETY_ENDPOINT` configured) — POST the payload string to Azure Content Safety; reject if any category fires above threshold. When unconfigured, falls back to a heuristic regex-based screen.
2. **Purview-style PII redaction** — secret-key patterns (`AKIA...`, `xoxb-...`, `Bearer eyJ...`, etc.) and PII patterns (SSNs, credit cards, emails in source URLs) are stripped before logging.

Both layers are mandatory, not optional. The agent loop never sees an unscreened response.

## Audit attribution

Every tool call produces an audit entry:

```
tool=enrichment:<source>   triggerType=a2a   triggeredBy=<callerAgentId>
parameters=<sanitized JSON of input args>
resultSummary=<source>: cacheHit=<bool> fixtureUsed=<bool>
```

Audit entries flow into the same Azure Storage Table the rest of `digital-worker` writes to, so the existing dashboards already show enrichment activity.

## Trigger semantics

| Source signal | Workflow | Modifications applied |
|---------------|----------|-----------------------|
| `enrichment.kev.match` | `major-incident-response` | Severity hard-set to `critical`; origin `observed` |
| `enrichment.msrc.critical` | `vulnerability-to-change` | Default `runWorkflowWithModes` flow |
| `enrichment.azure.status.degraded` | (none) | Tags cognition graph `upstream-degraded:<region>` for 30 min |

Each subscription respects the trigger-policy gate (suppress / notify-only / propose / dry-run / auto). The KEV branch additionally promotes severity before invoking `runMajorIncidentResponse`, so the resulting Adaptive Card / SNOW worknote treats the run as P1 from the start.

## Reviewer escalation on Critical CVSS

`effectiveReviewBlastRadius()` in `workflow-subscriptions.ts` inspects the signal payload for any of:

- `payload.cvss.baseScore`
- `payload.cvssBaseScore`
- `payload.baseScore`

When the score is `>= 9.0`, the worker's nominal blast radius is replaced with `1.0` for the review gate call. This guarantees the reviewer worker runs even on workflows that nominally have low blast radius. Blocking concerns downgrade the run to `propose`, which routes the decision through the Teams Adaptive Card flow.

## Outcome probes

`outcome-probes.ts` composes the existing `majorIncidentResponseProbe` with the Phase E `kevProbe` via `withEnrichmentFirst()`:

```
ctx → kevProbe(ctx)
        ├─ inconclusive (signal type mismatch) → fall back to majorIncidentResponseProbe
        └─ otherwise → return KEV verdict
```

The KEV probe inspects:

- The audit ring for a `snow.create_incident`-style write with a `priority 1` summary
- The workflow result step outputs for a CISA / KEV citation
- The signal payload's `cveId` to ensure the citation references the right CVE

The MSRC probe is registered directly (no prior probe to compose with) and follows the same pattern looking for an RFC creation + MSRC citation.

## Holidays consult

`change-window-planner.ts` is the **only** sanctioned consumer of `enrichmentBridge.isHolidayOn`. The change-manager surface area calls `evaluateChangeWindow({date, country, caseId})` before proposing any window. On a holiday hit, the verdict carries the matched `PublicHoliday` so the worknote can read:

> Refused — 2024-12-25 is a national holiday (Christmas Day) in GB.

Each consult is appended to the case via `case-manager.appendEnrichment` so the audit trail records the exact citation, including the source URL.

## Demo profile

When `loadTenantProfile(tenantId).profile === 'demo'` (or env `ENRICHMENT_DEV_MODE=1`):

- The bridge mints `dev-mode-token` instead of calling OBO. This avoids the Entra round-trip during demo replay.
- The MCP server passes `x-itsm-profile: demo` through to source modules.
- Source modules read from `__fixtures__/*.json` and tag `fixtureUsed=true` in the envelope.
- The audit ring still records the call so reviewers can see what would have happened.

The fixtures (KEV with Log4Shell, MSRC October 2024 with CVE-2024-43572, holiday calendars for US/GB/DE 2024, Azure Status East US degradation, M365 Exchange health degraded) are deliberately curated to produce a clean, deterministic demo path.

## Deployment

The `infra/modules/mcp-enrichment.bicep` module deploys the enrichment server as a third Container App in the same managed environment:

- Image: `${acrLoginServer}/itsm-mcp-enrichment:latest`
- Port: 3010
- Identity: SystemAssigned
- Probes: `/health` for both liveness and readiness
- Scale: 1–3 replicas, http-scaling at 40 concurrent requests

`container-apps.bicep` wires `MCP_ENRICHMENT_ENDPOINT=https://itsm-ops-${env}-enrichment.${envDomain}` into the digital-worker env, deterministically computed from the env name (no module dependency cycle).

## What we deliberately did NOT add (Phase E backlog)

These were considered and explicitly deferred:

- **GitHub Advisory Database** — overlaps with NVD enough that the marginal value didn't justify another OAuth integration this round.
- **MITRE ATT&CK** — useful for attack-chain narratives, but offline static data; better fit for a future "knowledge pack" container.
- **Azure Retail Pricing API** — relevant to FinOps; left to a future Phase G FinOps pillar.
- **Electricity Maps / Climatiq** — sustainability signals; not in the demo critical path.
- **AbuseIPDB / Shodan / HIBP** — useful but require keys and stricter rate-limit handling; deferred until we have a secure-by-default secrets-broker pattern in place.
- **Wikipedia / OpenAlex** — research-grade data; not relevant to the immediate ops loop.
- **Weather / geoip / CPE dictionary** — adjacent but redundant given the holiday + status feeds already cover the calendar / location dimensions we need.

These belong to a Phase F or later. Phase E ships the five sources that move the demo and clear an obvious gap in Alex's autonomous loop today.
