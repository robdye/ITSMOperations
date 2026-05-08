# Architecture

This page is the architectural overview the README intentionally
defers to. It describes the three deployment units, the ITIL 4
practice boundaries the workers map to, and the NIST 800-53 control
families the platform implements.

## Three deployment units

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ digital-worker          │  │ mcp-server              │  │ mcp-server-enrichment   │
│ Container Apps          │  │ Container Apps          │  │ Container Apps          │
│ rg-portfolio-agent      │  │ rg-itsm-operations      │  │ rg-itsm-operations      │
│ port 3978               │  │ port 3002               │  │ port 8080               │
├─────────────────────────┤  ├─────────────────────────┤  ├─────────────────────────┤
│ - Bot Framework         │  │ - MCP transport         │  │ - Read-only enrichment  │
│ - Agent loop            │  │ - ServiceNow CRUD       │  │   sources               │
│ - 18 specialist workers │  │ - 18 widgets            │  │ - KEV, MSRC, NVD,       │
│ - ACS / Voice Live      │  │ - Adaptive Cards        │  │   Azure Status, M365    │
│ - Cases + reminders     │  │ - Skybridge             │  │   Health, Holidays      │
│ - Mission Control SPA   │  │ - Tools (60+)           │  │ - OBO + provenance      │
│ - Reviewer + meta       │  │                         │  │ - Fixtures + cache      │
└────────────┬────────────┘  └────────────┬────────────┘  └────────────┬────────────┘
             │                            │                            │
             ▼                            ▼                            ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │ Azure Cosmos (AlexCases) │ Azure Storage (audit + AlexTrustScore)      │
   │ Azure Key Vault (kv-itsm-operations) │ Azure OpenAI (gpt-4o + o4-mini) │
   │ Azure Communication Services │ Azure Monitor + App Insights            │
   └────────────────────────────────────────────────────────────────────────┘
```

### `digital-worker`

The agent loop. This is what an operator talks to over Teams, M365
Copilot, ACS voice, or the Mission Control SPA. Hosts:

- The Bot Framework activity loop (`@microsoft/agents-hosting`)
- The agent factory + tool decorator (`@openai/agents`)
- All 18 specialist workers (incident, change, problem, asset,
  monitoring, knowledge, vendor, capacity, continuity, etc.)
- The autonomous control loop (signal-router → workflow-engine →
  outcome-verifier → reasoning-trace)
- The voice path (acsBridge + voiceProxy / voiceLiveTransport +
  voiceApprovals)
- Cases + reminders + correlation
- Reviewer-worker (safety review for high-blast-radius work)
- Meta-monitor (raises alerts when its own KPIs go off-track)
- Red-team agent + AlexTrustScore (continuous adversarial probing)
- Mission Control static SPA + REST + SSE feeds

### `mcp-server`

The Model Context Protocol server that backs every tool the
`digital-worker` calls. It sits in front of:

- ServiceNow (incidents, changes, problems, assets, KB, vendors)
- Azure Monitor (KQL alerts, traces)
- Azure Search (KB indexer + retrieval)
- Purview DLP (record classification, PII redaction)
- 18 widgets (Skybridge MIME `text/html+skybridge`) for embedding in
  M365 Copilot
- 4 Adaptive Cards (CAB pack, outcome story, shift handover, ITSM
  briefing)

### `mcp-server-enrichment`

A read-only enrichment server that aggregates external data sources
for incidents, problems, and changes. Always runs in OBO mode, always
returns provenance:

- CISA KEV (Known Exploited Vulnerabilities)
- NVD (CVE detail by id and by product)
- MSRC (monthly security release)
- Azure Service Health
- M365 Service Communications API
- Nager.Date (public holidays for change-window-planner)

Every response is wrapped in an `EnrichmentEnvelope`:

```ts
{
  data: T,
  provenance: {
    source: string;           // e.g. "enrichment.cisa-kev"
    fetchedAt: string;        // ISO 8601
    fixtureUsed: boolean;     // true in demo mode
    sourceUrl?: string;       // citation
  }
}
```

## ITIL 4 practice boundaries

Each ITIL 4 practice maps to exactly one specialist worker. There is
no shared agent state across practices — the chain-of-command
escalation goes through the audit table, not via direct in-process
calls. This is what lets us run the workers as independent units of
work and what makes the kill-switch + change-freeze gates effective
(they can stop the routing, not the workers).

| ITIL 4 practice | Worker | Key responsibilities |
| --- | --- | --- |
| Incident management | `incident-manager` | Triage, P1/P2 bridge, paging, RCA hand-off |
| Change enablement | `change-manager` | Risk scoring, CAB pack, collision detection, PIR |
| Problem management | `problem-manager` | Pattern detection, KEDB review, root-cause assignment |
| Service request management | `service-desk-manager` | Catalogue requests, fulfilment routing |
| Service level management | `sla-manager` | Breach forecasting, escalation, SLA reporting |
| Service configuration management | `asset-cmdb-manager` | CMDB hygiene, EOL/EOS scans, ownership |
| Service desk | `service-desk-manager` | Front-of-house Tier-1 |
| Knowledge management | `knowledge-manager` | KB gap analysis, post-incident KB capture |
| Monitoring & event management | `monitoring-manager` | Signal triage from Azure Monitor + Datadog |
| Capacity & performance management | `capacity-manager` | Capacity plans, autoscale gates |
| IT asset management | `asset-cmdb-manager` | (shared with config) |
| Service continuity management | `continuity-manager` | DR runbook drills, test reports |
| Information security management | `security-manager` | KEV / MSRC enrichment, prompt-shield review |
| Supplier management | `vendor-manager` | Contract reviews, vendor SLA tracking |
| Release management | `release-manager` | Release calendar, freeze windows |
| Financial management for IT services | `finops-manager` | Cost anomalies, budget alerts |

The five **AI-governance workers** are not ITIL 4 practices but they
extend the same chain-of-command:

- `agent-inventory-audit` — full inventory of registered agents.
- `agent-compliance-dashboard` — control-by-control compliance.
- `agent-change-control` — RFC for AI components.
- `agent-ownership-transfer` — agent re-assignment workflow.
- `shadow-agent-discovery` — find unregistered AI use.

## NIST 800-53 control mapping

The platform implements the **AC** (access control), **AU** (audit),
**IA** (identification & authentication), **SC** (system &
communications protection), and **SI** (system & information
integrity) families. The matrix below captures the mapping.

| Control | Implementation |
| --- | --- |
| **AC-2** Account Management | Managed Identity for every Azure resource. Per-agent identities for the AI-governance workers. |
| **AC-3** Access Enforcement | HITL classifier on every tool (`hitl.ts`). Reviewer-worker on high-blast-radius. State machine on cases (no writes after close). |
| **AC-4** Information Flow Enforcement | Enrichment provenance envelopes carry the source url + fixture flag. A2A scope map gates inter-agent intents. |
| **AC-6** Least Privilege | Per-tool RBAC via `tools_settings`. Storage Table Data Contributor scoped to the `AlexTrustScore` table only. |
| **AU-2** Event Logging | Every tool call, every state transition, every approval emits to `auditTrail` (Azure Table). |
| **AU-3** Content of Audit Records | Audit row carries `workerId`, `toolName`, `riskLevel`, `triggeredBy`, `parameters`, `resultSummary`, `requiredConfirmation`, `durationMs`. |
| **AU-9** Protection of Audit Information | Audit table is immutable from the agent service identity (write-only RBAC). |
| **IA-2** Identification & Authentication | DefaultAzureCredential / Managed Identity throughout. OAuth OBO for ServiceNow + enrichment. AAD Object Id correlated with voice approvals. |
| **SC-8** Transmission Confidentiality & Integrity | TLS 1.2+ everywhere. Voice control plane uses ACS-managed PCM16 24 kHz. |
| **SC-13** Cryptographic Protection | Key Vault for all secrets. RBAC-enabled Key Vault. Soft-delete + 90 day retention. |
| **SC-28** Protection of Information at Rest | Azure-managed encryption on Cosmos, Storage, Key Vault. Purview DLP redacts PII before any tool return. |
| **SI-4** Information System Monitoring | Meta-monitor + AlexTrustScore + reviewer-worker form the continuous monitoring layer. |
| **SI-10** Information Input Validation | Azure AI Content Safety (prompt shields) on every user input. Fail-closed if Content Safety is misconfigured. |

## Where to learn more

- [docs/a2a.md](a2a.md) — A2A inbound policy
- [docs/case-management.md](case-management.md) — Cases lifecycle and persistence
- [docs/voice.md](voice.md) — Voice path (ACS, Voice Live, intent classifier)
- [docs/enrichment.md](enrichment.md) — Enrichment server contract
- [docs/observability.md](observability.md) — OpenTelemetry + KQL alerts
- [docs/coverage.md](coverage.md) — Test coverage per module
- [README.md](../README.md) — Top-level overview, frameworks, and run-locally guide
- [DEMO-SCRIPT.md](../DEMO-SCRIPT.md) — Live demo walkthrough
