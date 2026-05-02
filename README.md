# Alex IT Ops — ITIL 4 Multi-Agent Digital Worker

> **An autonomous AI digital employee for IT Service Management.** Not a chatbot — a colleague that triages incidents at 3 AM, predicts SLA breaches before they happen, prepares your CAB agenda while you sleep, and learns from every outcome.

![CI](https://img.shields.io/github/actions/workflow/status/robdye/ITSMOperations/ci.yml?label=CI&logo=github)
![Tests](https://img.shields.io/badge/tests-216%20passing-brightgreen)
![Deploy](https://img.shields.io/github/actions/workflow/status/robdye/ITSMOperations/deploy.yml?label=Deploy&logo=microsoft-azure)
![Node](https://img.shields.io/badge/node-20%20%7C%2022-339933?logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## What it is

**Alex IT Ops** is a production-grade *digital worker* — an autonomous AI employee that operates inside an IT Service Management organisation. It works through Microsoft Teams, M365 Copilot, voice channels, and a browser-based mission control. Where a chatbot answers questions, Alex *takes action*: it opens incident bridges, drafts changes, escalates SLA breaches, sends the morning ops briefing, and runs a continuous control loop that observes signals, forecasts trouble, decides whether to act autonomously or seek human approval, and grades its own outcomes.

The system follows **ITIL 4** practice boundaries, applies **NIST 800-53** control families, enforces a **Human-in-the-Loop** policy on every write operation by default, and is built on Microsoft's first-class agent platform (Microsoft Agent 365 + Microsoft Agents SDK) so it integrates natively with Microsoft 365.

### Use cases

- **Tier-1 incident response** — auto-triage, ServiceNow CRUD, P1/P2 bridge spin-up, on-call paging, post-incident knowledge capture
- **Change enablement** — risk scoring, CAB agenda preparation, collision detection, post-implementation review
- **SLA stewardship** — breach forecasting, escalation, auto-paging on the on-call rota
- **Knowledge & CMDB hygiene** — KB gap analysis, EOL/EOS asset scans, CMDB completeness audits, KEDB review
- **Operations briefings** — daily standup brief, weekly recurring-incident pattern analysis, monthly health report
- **AI governance** — agent inventory, compliance dashboard, shadow-agent discovery, change control for AI components

### Live deployment

A reference instance runs in Azure Container Apps with the latest revision, image tag `cassidy-mcp-migration-20260501`, on the Cassidy MCP-first contract. **216 unit tests** across **28 files** pass against every commit (run in ~5 s). All infrastructure is reproducible via Bicep.

---

## Key capabilities at a glance

| Area | What it does |
|------|-------------|
| **18 specialist workers** | One agent per ITIL 4 practice — Incident, Change, Problem, Asset/CMDB, SLA, Knowledge, Vendor, Service Desk, Monitoring, Release, Capacity, Continuity, Security — plus 5 AI-Governance workers |
| **Autonomous control loop** | Signal ingestion → DAG workflow execution → outcome verification → automatic threshold tuning → governance kill-switches |
| **MCP-first M365 integration** | Mail, Teams, Calendar, Planner, People delivered over Microsoft Agent 365 OBO MCP servers, with direct Microsoft Graph as a graceful fallback |
| **ServiceNow integration** | Full CRUD on incidents, changes, problems, assets, knowledge and vendors via a dedicated MCP server |
| **Voice & avatar** | Azure Speech Avatar (Lisa/Ava) over WebRTC, with voice-optimised ITSM tooling |
| **Mission control** | Real-time SPA showing active workers, pending approvals, foresight forecasts, and governance state |
| **Scheduled routines** | 18+ cron-driven autonomous jobs — SLA prediction, stale-ticket sweeps, CMDB audits, shift handover, monthly health report |
| **Foresight & memory** | Cluster mining + 24 h forecast, experiential memory of past incidents, CI ↔ incident cognition graph |
| **Governance** | Kill switch, workflow freeze/release, autonomy thresholds tuned dynamically from outcome history |
| **Compliance & safety** | Azure AI Content Safety prompt shields, Purview DLP classification + PII redaction, full audit trail, OAuth OBO, Managed Identity throughout |

---

## Frameworks & standards

Alex IT Ops sits on top of standards-based frameworks rather than bespoke plumbing.

| Layer | Standard / Framework | What it gives us |
|-------|---------------------|------------------|
| Practice model | **ITIL 4** | 13 service-management practices each map to one specialist worker, with explicit boundaries and chain-of-command escalation |
| Security controls | **NIST 800-53** (rev 5) | Audit logging (AU), HITL (AC-2/AC-3), DLP (SC-8/SC-28), least privilege via Managed Identity (IA-2) |
| Agent runtime | **Microsoft Agents SDK** (`@microsoft/agents-hosting`) | Teams + M365 transport, `TurnContext` activity model, OAuth |
| Agent platform | **Microsoft Agent 365** (`@microsoft/agents-a365-runtime` + `agents-a365-tooling`) | OBO token exchange, MCP-tool gateway, allow-listed M365 MCP servers |
| Tool calling | **OpenAI Agents SDK** (`@openai/agents`) | Agent factory, tool decoration, run-context propagation, hooks |
| Tool transport | **Model Context Protocol** (`@modelcontextprotocol/sdk`) | Vendor-neutral tool discovery and invocation across MCP servers |
| LLM access | **Azure OpenAI Service** | GPT-4o (reasoning), o4-mini (routing), via Managed Identity |
| Telemetry | **OpenTelemetry** + GenAI semantic conventions | `gen_ai.*` spans, W3C Trace Context across MCP calls |
| Observability | **Azure Monitor / Application Insights / Log Analytics** | KQL alerts, distributed tracing, custom events |
| Safety | **Azure AI Content Safety** | Prompt shields (jailbreak detection), content classification, fail-closed |
| Data governance | **Microsoft Purview DLP** | Record classification, PII auto-redaction before tool returns |
| UX surfaces | **Adaptive Cards 1.6** + **Skybridge widgets** + **Fluent UI v9** | Universal Actions for HITL, embedded widgets in M365 Copilot |
| Infrastructure | **Bicep / Azure Verified Modules** | Reproducible IaC for every Azure resource |
| CI/CD | **GitHub Actions** | Typecheck → test → Docker build → ACR push → Container Apps deploy |

---

## Architecture — Logical view

How a user request becomes an action, and how the autonomous loop closes around outcomes.

```mermaid
flowchart TB
    classDef surface fill:#1e3a8a,stroke:#1e40af,color:#fff
    classDef worker fill:#7c2d12,stroke:#9a3412,color:#fff
    classDef platform fill:#065f46,stroke:#047857,color:#fff
    classDef integration fill:#581c87,stroke:#6b21a8,color:#fff
    classDef store fill:#374151,stroke:#4b5563,color:#fff

    subgraph S[User and system surfaces]
        S1[M365 Copilot +<br/>Declarative Agent]
        S2[Microsoft Teams<br/>chat + Approvals]
        S3[Voice + Avatar<br/>WebRTC client]
        S4[Mission Control<br/>browser SPA]
        S5[ServiceNow webhooks<br/>+ Azure Monitor]
    end
    class S1,S2,S3,S4,S5 surface

    subgraph O[Orchestrator]
        O1[ITOps Command Center<br/>agent.ts]
        O2[Worker Registry<br/>intent classifier]
        O3[Agent Harness<br/>threads TurnContext<br/>into runContext]
        O4[Escalation Chain<br/>worker → CC → human]
    end

    subgraph W[Specialist workers — ITIL 4 practices]
        W1[Tier 1 core<br/>Incident · Change · Problem<br/>Asset/CMDB · SLA · Knowledge · Vendor]
        W2[Tier 2 extended<br/>Service Desk · Monitoring · Release]
        W3[Tier 3 strategic<br/>Capacity · Continuity · Security]
        W4[AI governance<br/>Inventory · Compliance · Change Control<br/>Ownership · Shadow discovery]
    end
    class W1,W2,W3,W4 worker

    subgraph A[Autonomous platform — Pillars 3–10]
        A1[Signal router<br/>subscriptions + cooldown]
        A2[Workflow engine<br/>DAG + linear]
        A3[Foresight<br/>cluster mining + 24h forecast]
        A4[Outcome verifier + judge<br/>did the action succeed?]
        A5[Autonomy gate + tuner<br/>propose / approve / auto<br/>thresholds tuned from outcomes]
        A6[Governance<br/>kill / freeze / release]
        A7[Goal seeker<br/>plan → pursue]
        A8[Cognition graph<br/>+ experiential memory]
    end
    class A1,A2,A3,A4,A5,A6,A7,A8 platform

    subgraph I[Tool layer]
        I1[M365 MCP-first wrappers<br/>m365-tools.ts<br/>OBO via Agent 365<br/>Graph fallback]
        I2[ServiceNow MCP server<br/>incidents · changes · problems<br/>assets · KB · vendors]
        I3[Domain tools<br/>finops · monitoring · release<br/>reporting · risk · catalogue]
        I4[Voice tools<br/>spoken-format ITSM]
        I5[Skybridge widgets<br/>+ Adaptive Cards 1.6]
    end
    class I1,I2,I3,I4,I5 integration

    subgraph St[State and safety]
        St1[Cosmos DB<br/>state · reasoning traces]
        St2[Azure Tables<br/>AlexOutcomes · TunerState<br/>Governance · Signals]
        St3[Redis<br/>session + token cache]
        St4[Service Bus<br/>5 inter-worker topics]
        St5[Content Safety<br/>+ Purview DLP]
        St6[Audit trail<br/>+ HITL approval queue]
    end
    class St1,St2,St3,St4,St5,St6 store

    S1 --> O1
    S2 --> O1
    S3 --> O1
    S4 --> O1
    S5 --> A1

    O1 --> O2 --> O3
    O3 --> W1 & W2 & W3 & W4
    O3 -. fallback .-> O4

    W1 & W2 & W3 & W4 --> I1 & I2 & I3 & I4
    W1 & W2 & W3 & W4 -. embedded .-> I5

    A1 --> A2 --> A4 --> A5 --> A2
    A3 --> A1
    A6 -. gates .-> A1 & A2
    A7 --> A1
    A8 -. enriches .-> A4

    I1 -. side effects .-> St6
    I2 & I3 -.-> St1
    A2 & A4 --> St2
    O3 -.-> St3
    W1 & W2 & W3 -.-> St4
    O3 & I1 & I2 -. mediated by .-> St5
```

**Reading the diagram**

- **Surfaces** call into a single orchestrator (`agent.ts`) which classifies intent, picks a worker, and threads the live `TurnContext` into the OpenAI Agents SDK's `runContext` so every tool can mint an OBO token if needed.
- **Workers** are scoped Agent instances — each has only the tools and instructions for one ITIL practice. They escalate via the worker→Command Center→human chain.
- **The autonomous platform** runs in parallel: ServiceNow webhooks and monitoring alerts arrive as `Signal`s, are routed to subscribed workflows, and the workflow engine executes a DAG. After the workflow finishes, the outcome verifier grades it, the autonomy tuner adjusts thresholds, and governance can hard-stop the loop at any time.
- **The tool layer** is uniform: every M365 side effect goes through `m365-tools.ts` (MCP-first, Graph fallback) so the same code path works whether a human, a cron job, or a signal triggered the action. Every call returns a tagged `source` so we can audit which path actually delivered.

---

## Architecture — Physical view (Azure deployment)

The runtime topology — what's deployed, where it lives, and how packets flow.

```mermaid
flowchart LR
    classDef m365 fill:#1f2937,stroke:#374151,color:#fff
    classDef edge fill:#1e3a8a,stroke:#1e40af,color:#fff
    classDef compute fill:#065f46,stroke:#047857,color:#fff
    classDef data fill:#7c2d12,stroke:#9a3412,color:#fff
    classDef ai fill:#581c87,stroke:#6b21a8,color:#fff
    classDef obs fill:#374151,stroke:#4b5563,color:#fff

    subgraph U[End users]
        U1[Teams /<br/>M365 Copilot]
        U2[Voice client<br/>browser]
        U3[Mission Control<br/>browser]
    end

    subgraph M[Microsoft Graph and M365]
        M1[Graph API<br/>Mail · Calendar<br/>Planner · Users]
        M2[M365 MCP servers<br/>Mail · Teams · Calendar<br/>Planner · OneDrive · SP]
        M3[Teams Approvals<br/>Universal Actions]
    end
    class M1,M2,M3 m365

    subgraph X[Microsoft Agent 365 plane]
        X1[Tooling gateway<br/>OBO + tool discovery]
        X2[Agentic auth<br/>OBO token broker]
    end
    class X1,X2 edge

    subgraph AZ[Azure subscription — Bicep-managed]
        direction TB

        subgraph AC[Container Apps environment]
            AC1[Digital Worker<br/>Express · port 3978<br/>Node 20]
            AC2[ServiceNow MCP server<br/>Express + SSE · port 3002<br/>Node 22]
        end
        class AC1,AC2 compute

        subgraph FN[Function App — Linux Y1]
            FN1[Durable timers<br/>11 cron triggers]
            FN2[Durable orchestrators<br/>major-incident-bridge<br/>change-rollback<br/>cab-voting-cycle]
            FN3[HTTP triggers<br/>SNOW webhook]
        end
        class FN1,FN2,FN3 compute

        subgraph DAT[Data plane]
            D1[Cosmos DB<br/>state · traces · memory]
            D2[Azure Storage<br/>Tables: outcomes · tuner<br/>governance · signals · audit]
            D3[Azure Cache for Redis<br/>session · tokens]
            D4[Azure Service Bus<br/>5 topics]
            D5[Azure AI Search<br/>hybrid + vector index]
        end
        class D1,D2,D3,D4,D5 data

        subgraph AI[AI services]
            AI1[Azure OpenAI<br/>GPT-4o + o4-mini]
            AI2[Azure AI Content Safety<br/>prompt shields]
            AI3[Azure Speech<br/>Avatar · Voice Live]
            AI4[Azure AI Foundry<br/>hub · project · evals]
        end
        class AI1,AI2,AI3,AI4 ai

        subgraph SEC[Identity and secrets]
            SEC1[Key Vault<br/>secrets at rest]
            SEC2[3 User-Assigned MIs<br/>Incident · Change · Security]
            SEC3[ACR<br/>image registry]
        end
        class SEC1,SEC2,SEC3 compute

        subgraph OBS[Observability]
            OBS1[Application Insights<br/>OTel traces + metrics]
            OBS2[Log Analytics workspace<br/>KQL + 5 alert rules]
        end
        class OBS1,OBS2 obs
    end

    subgraph SN[ServiceNow tenant]
        SN1[ServiceNow REST API<br/>Table · OAuth OBO]
    end

    U1 -- HTTPS --> AC1
    U2 -- WSS --> AC1
    U3 -- HTTPS --> AC1

    AC1 -- OBO token request --> X2
    AC1 -- discover and invoke tools --> X1
    X1 --> M2
    AC1 -- Graph fallback<br/>app-only client_credentials --> M1

    AC1 -- MCP /SSE --> AC2
    AC2 -- HTTPS --> SN1

    FN1 & FN2 -- HTTP POST<br/>x-scheduled-secret --> AC1
    FN3 -- POST /api/signals --> AC1
    SN1 -. webhook .-> FN3

    AC1 -- Managed Identity --> AI1 & AI2 & AI3 & AI4
    AC1 --> D1 & D2 & D3 & D4 & D5
    AC2 --> D5

    AC1 -- secrets<br/>at startup --> SEC1
    AC1 & AC2 -. pulled by .- SEC2
    SEC2 -- ACR pull --> SEC3

    AC1 & AC2 & FN1 -- OTel exporter --> OBS1
    OBS1 --> OBS2

    AC1 -- card actions --> M3
```

**Why this shape**

- **Two stateless containers + a Function App**: the digital worker and the ServiceNow MCP server scale horizontally on Azure Container Apps; long-running and time-driven work lives in Durable Functions so the worker can be killed and replaced without losing in-flight state.
- **Managed Identity throughout**: no static credentials in the runtime. ACR pulls, Key Vault reads, OpenAI calls, Speech, Tables, Cosmos, Search and Service Bus all authenticate via the worker's user-assigned MI. The only secret in the worker's env is the HMAC secret used to authenticate Durable Functions calling back into the worker.
- **OBO over Microsoft Agent 365**: when a real Teams/M365 user is on the line, the worker exchanges their bearer token for an OBO token via Microsoft Agent 365 and calls dedicated M365 MCP servers. This keeps user-context attribution end-to-end (their mailbox, their calendar) rather than the worker pretending to be the user with app-only permissions.
- **Graph as a graceful fallback**: cron jobs, signal-router actions, and mission-control buttons run *autonomously* — there is no user `TurnContext`. Those paths fall back to a dedicated Graph application identity (`Mail.Send`, `Calendars.ReadWrite`, `User.Read.All`, admin-consented) so the same code path produces the right side effect with the right attribution.
- **All persistent state outside compute**: Cosmos DB, Azure Tables, Redis, Service Bus, AI Search. The worker container has no on-disk state; it can be rolled, scaled, or replaced freely.
- **Bicep-managed**: every box in the diagram is provisioned by [`infra/main.bicep`](infra/main.bicep). Bring-up is one `az deployment group create`.

---

## Directory Structure

```
ITSMOperations/
│
├── digital-worker/                          # Main agent service (Express, port 3978)
│   ├── package.json                         # Node 20, 25 deps, 12 devDeps
│   ├── tsconfig.json                        # ES2019 target, strict, commonjs
│   ├── Dockerfile                           # Multi-stage: node:20-slim builder → runtime
│   ├── vitest.config.ts                     # v8 coverage, 50/40/40/50 thresholds
│   ├── kql-alerts.json                      # 5 Azure Monitor KQL alert rules (ARM)
│   ├── .env                                 # Environment config (~60 variables)
│   ├── src/
│   │   ├── [Core Agent Framework]
│   │   │   ├── index.ts                     # Entry point: Express server, routes, startup
│   │   │   ├── agent.ts                     # Teams message handler + worker routing
│   │   │   ├── agent-harness.ts             # Worker factory (creates scoped OpenAI Agent instances)
│   │   │   ├── agent-framework.ts           # Agent lifecycle management
│   │   │   ├── agent-tools.ts               # Tool registration and invocation
│   │   │   ├── client.ts                    # Standalone client for non-Teams invocation
│   │   │   ├── openai-config.ts             # Azure OpenAI model configuration
│   │   │   ├── worker-definitions.ts        # 18+ ITIL 4 worker definitions with instructions
│   │   │   ├── worker-registry.ts           # Intent classifier (keyword scoring + LLM fallback)
│   │   │   ├── worker-delegation.ts         # ITIL chain-of-command delegation
│   │   │   ├── escalation-chain.ts          # 3-level escalation: Worker → Command Center → Human
│   │   │   ├── workflow-engine.ts           # Multi-step workflow orchestration
│   │   │   └── horizontal-scaling.ts        # Container scaling configuration
│   │   │
│   │   ├── [Scheduled & Autonomous]
│   │   │   ├── scheduled-routines.ts        # 18 autonomous cron-based routines
│   │   │   ├── shift-handover.ts            # 8-hour shift handover briefing generator
│   │   │   ├── incident-monitor.ts          # P1/P2 incident polling and auto-bridge
│   │   │   └── autonomous-actions.ts        # Self-initiated workflow triggers
│   │   │
│   │   ├── [Azure Service Integrations]
│   │   │   ├── cosmos-store.ts              # Cosmos DB persistence (state, traces, memory)
│   │   │   ├── redis-store.ts               # Azure Redis Cache (session, conversation cache)
│   │   │   ├── service-bus.ts               # Azure Service Bus (5 topics, pub/sub messaging)
│   │   │   ├── secret-resolver.ts           # Key Vault secret resolution at startup
│   │   │   ├── content-safety.ts            # Azure AI Content Safety (prompt shields)
│   │   │   ├── apim-gateway.ts              # Azure API Management gateway proxy
│   │   │   ├── log-analytics.ts             # Azure Monitor event tracking + KQL templates
│   │   │   ├── kql-templates.ts             # Reusable KQL queries (error rate, latency, tokens)
│   │   │   ├── telemetry.ts                 # OpenTelemetry SDK (GenAI semantic conventions)
│   │   │   ├── foundry-agents.ts            # Azure AI Foundry Agent Service integration
│   │   │   ├── computer-use.ts              # Foundry Computer Use (browser automation)
│   │   │   ├── copilot-tuning.ts            # Fine-tuning pipeline (extract → dataset → deploy)
│   │   │   └── vision-processor.ts          # Image/screenshot analysis via GPT-4o Vision
│   │   │
│   │   ├── [Security & Governance]
│   │   │   ├── hitl.ts                      # Human-in-the-loop classification (read/write/notify)
│   │   │   ├── approval-queue.ts            # Adaptive Card approval flow with timeout
│   │   │   ├── audit-trail.ts               # Azure Table Storage audit logging + redaction
│   │   │   ├── conditional-access.ts        # Entra Conditional Access policy enforcement
│   │   │   ├── token-cache.ts               # Managed identity token caching
│   │   │   └── reasoning-trace.ts           # Reasoning chain persistence (Cosmos DB)
│   │   │
│   │   ├── [M365 Integrations]
│   │   │   ├── graph-mail.ts                # Microsoft Graph Mail (send/read email)
│   │   │   ├── graph-connector.ts           # Microsoft Graph Connector (KB → M365 search)
│   │   │   ├── teams-approvals.ts           # Teams Approvals API (Universal Actions)
│   │   │   ├── teams-channel.ts             # Teams channel management (incident bridges)
│   │   │   ├── planner-tasks.ts             # Microsoft Planner (task creation/tracking)
│   │   │   ├── sharepoint-docs.ts           # SharePoint document library integration
│   │   │   ├── power-automate.ts            # Power Automate flow triggers + callbacks
│   │   │   ├── power-automate-flows.ts      # Flow definitions (CAB voting, change approval, etc.)
│   │   │   ├── workiq-client.ts             # WorkIQ (M365 Copilot) API client
│   │   │   └── connected-agents.ts          # A2A protocol (Agent-to-Agent discovery + messaging)
│   │   │
│   │   ├── [Cross-Cutting]
│   │   │   ├── mcp-tool-setup.ts            # Cassidy-pattern MCP discovery + invokeMcpTool (OBO)
│   │   │   ├── m365-tools.ts                # 7 static M365 wrappers (MCP-first → Graph fallback)
│   │   │   ├── mcp-client.ts                # Legacy MCP client for ServiceNow MCP Server
│   │   │   ├── memory-store.ts              # Tiered memory persistence (Redis → Cosmos → in-memory)
│   │   │   ├── conversation-memory.ts       # Conversation-scoped memory management
│   │   │   ├── reasoning-rca.ts             # Automated root cause analysis engine
│   │   │   ├── adaptive-cards.ts            # Adaptive Card 1.6 templates (4 card types)
│   │   │   ├── doc-generator.ts             # Document generation (PIR reports, CAB packs)
│   │   │   ├── presentation-generator.ts    # PPTX generator (pptxgenjs) for current-state decks
│   │   │   └── email-service.ts             # Email composition and delivery
│   │   │
│   │   ├── [Autonomous Platform — Pillars 3–10]
│   │   │   ├── signal-router.ts             # Subscription match + cooldown gating
│   │   │   ├── workflow-engine.ts           # DAG + linear workflow execution
│   │   │   ├── workflow-subscriptions.ts    # Signal→workflow subscription registry
│   │   │   ├── snow-signal-mapper.ts        # ServiceNow webhook → internal Signal envelope
│   │   │   ├── snow-client.ts               # Inbound webhook client
│   │   │   ├── async-jobs.ts                # Long-running job tracker (/api/jobs)
│   │   │   ├── foresight.ts                 # Cluster mining + 24h forecast
│   │   │   ├── outcome-verifier.ts          # Post-action success/failure detection
│   │   │   ├── outcome-judge.ts             # LLM-as-judge for outcome grading
│   │   │   ├── trigger-policy.ts            # propose / approve / auto decision logic
│   │   │   ├── autonomy-gate.ts             # confidence × (1 − 0.5 × blastRadius) dampener
│   │   │   ├── autonomy-tuner.ts            # Dynamic threshold tuning from outcome history
│   │   │   ├── governance.ts                # Kill switch / workflow freeze / release
│   │   │   ├── goal-seeker.ts               # Proactive plan → pursue (Pillar 9)
│   │   │   ├── cognition-graph.ts           # CI ↔ incident ↔ service relationship graph
│   │   │   ├── experiential-memory.ts       # Past-incident fingerprint recall
│   │   │   ├── anticipatory-store.ts        # Azure Tables persistence for outcomes / tuner / signals
│   │   │   ├── anticipatory-broadcaster.ts  # SSE broadcaster for foresight / outcomes / governance
│   │   │   ├── routine-delivery.ts          # Routine result delivery (Email + Teams)
│   │   │   └── demo/                        # Scripted-storm + tenant-profile demo harness
│   │   │
│   │   ├── [Voice & Avatar]
│   │   │   ├── voice/voiceProxy.ts          # WebSocket proxy → Azure Voice Live
│   │   │   ├── voice/voiceTools.ts          # Voice-optimized ITSM tool definitions
│   │   │   ├── voice/voiceGate.ts           # Feature gate for voice enablement
│   │   │   └── voice/voice.html             # Browser-based voice client (WebRTC)
│   │   │
│   │   ├── [Tools — 19 Domain Modules]
│   │   │   ├── tools/index.ts               # Tool registry — maps tools to workers
│   │   │   ├── tools/incident-tools.ts      # Incident CRUD, triage, correlation
│   │   │   ├── tools/change-tools.ts        # Change lifecycle, risk scoring, CAB
│   │   │   ├── tools/problem-tools.ts       # Problem management, KEDB, RCA
│   │   │   ├── tools/asset-cmdb-tools.ts    # CMDB queries, CI relationships, health
│   │   │   ├── tools/sla-tools.ts           # SLA compliance, breach prediction
│   │   │   ├── tools/knowledge-tools.ts     # KB search, article management
│   │   │   ├── tools/monitoring-tools.ts    # Azure Monitor alerts, event correlation
│   │   │   ├── tools/release-tools.ts       # Release pipeline management
│   │   │   ├── tools/service-desk-tools.ts  # Service catalog, request fulfilment
│   │   │   ├── tools/briefing-tools.ts      # Ops briefing generation
│   │   │   ├── tools/comms-tools.ts         # Email, Teams, notification dispatch
│   │   │   ├── tools/m365-tools.ts          # M365 Graph API operations
│   │   │   ├── tools/finops-tools.ts        # Azure cost analysis, right-sizing
│   │   │   ├── tools/request-tools.ts       # Service request management
│   │   │   ├── tools/catalogue-tools.ts     # Service catalogue browsing
│   │   │   ├── tools/risk-tools.ts          # Risk assessment and scoring
│   │   │   ├── tools/deployment-tools.ts    # Deployment tracking and rollback
│   │   │   ├── tools/availability-tools.ts  # Availability and uptime monitoring
│   │   │   ├── tools/reporting-tools.ts     # KPI reporting and dashboards
│   │   │   └── tools/advanced-tools.ts      # Cross-domain advanced operations
│   │   │
│   │   ├── [UI]
│   │   │   └── mission-control.html         # Mission Control dashboard (single-page)
│   │   │
│   │   └── [Tests — 28 files / 216 tests]
│   │       ├── __tests__/agent-harness.test.ts            # Verifies TurnContext threading via run({ context })
│   │       ├── __tests__/anticipatory-store.test.ts       # Anticipatory Tables-backed store
│   │       ├── __tests__/approval-queue.test.ts
│   │       ├── __tests__/async-jobs.test.ts               # Long-running job tracking
│   │       ├── __tests__/audit-trail.test.ts
│   │       ├── __tests__/autonomy-gate.test.ts            # Trigger-policy confidence dampener
│   │       ├── __tests__/autonomy-tuner.test.ts           # Auto-threshold raise/lower from outcomes
│   │       ├── __tests__/cognition-graph.test.ts          # CI ↔ incident relationship graph
│   │       ├── __tests__/contract-equivalence.test.ts     # Worker tool contract parity
│   │       ├── __tests__/demo-runner.test.ts              # Scripted-storm scenario runner
│   │       ├── __tests__/escalation-chain.test.ts
│   │       ├── __tests__/experiential-memory.test.ts      # Past-incident fingerprint recall
│   │       ├── __tests__/foresight.test.ts                # Cluster mining + trend forecast
│   │       ├── __tests__/goal-seeker.test.ts              # Plan → pursue (Pillar 9)
│   │       ├── __tests__/governance.test.ts               # Kill / freeze / release switches
│   │       ├── __tests__/hitl.test.ts
│   │       ├── __tests__/m365-tools.test.ts               # MCP-first wrappers + Graph fallback (23)
│   │       ├── __tests__/mcp-tool-setup.test.ts           # Cassidy MCP discovery + invokeMcpTool (11)
│   │       ├── __tests__/openai-config.test.ts
│   │       ├── __tests__/outcome-verifier.test.ts         # Post-action success grading
│   │       ├── __tests__/reasoning-trace.test.ts
│   │       ├── __tests__/routine-delivery.test.ts         # 18 cron routines
│   │       ├── __tests__/signal-router.test.ts            # Subscription match + cooldown
│   │       ├── __tests__/snow-mapper.test.ts              # ServiceNow webhook → Signal
│   │       ├── __tests__/trigger-policy.test.ts           # propose / approve / auto decision
│   │       ├── __tests__/worker-delegation.test.ts
│   │       ├── __tests__/worker-registry.test.ts
│   │       └── __tests__/workflow-engine-dag.test.ts      # DAG topological scheduler
│   │
│   └── eval/                                # Golden dataset (20 scenarios) for Foundry Evals
│
├── mcp-server/                              # ServiceNow MCP Server (Express, port 3002)
│   ├── package.json                         # Node 22, ESM, MCP SDK + zod + express
│   ├── tsconfig.json                        # TypeScript config
│   ├── Dockerfile                           # Multi-stage: node:22-slim, tsx runtime
│   ├── vitest.config.ts                     # Test config
│   ├── widgets/                             # Widget source (esbuild → assets/)
│   ├── assets/                              # Built widget HTML bundles
│   ├── src/
│   │   ├── index.ts                         # Express + SSE transport, port 3002
│   │   ├── mcp-server.ts                    # MCP tool/resource registration (18 widgets)
│   │   ├── snow-client.ts                   # ServiceNow REST API client (Table API)
│   │   ├── snow-auth.ts                     # OAuth OBO authentication for ServiceNow
│   │   ├── snow-query.ts                    # Safe query builder (injection prevention)
│   │   ├── eol-client.ts                    # endoflife.date API client (EOL/EOS data)
│   │   ├── azure-monitor.ts                 # Azure Monitor metrics reader
│   │   ├── search-client.ts                 # Azure AI Search (hybrid + vector queries)
│   │   ├── search-indexer.ts                # AI Search index management
│   │   ├── card-renderer.ts                 # Adaptive Card rendering utilities
│   │   ├── purview-dlp.ts                   # Purview DLP record classification + PII redaction
│   │   └── __tests__/
│   │       ├── snow-client.test.ts          # ServiceNow client tests
│   │       ├── snow-query.test.ts           # Query builder injection prevention tests
│   │       └── purview-dlp.test.ts          # DLP classification tests
│   │
│   └── .env.example                         # Environment variable template
│
├── functions/                               # Azure Durable Functions (Node 20, Linux)
│   ├── package.json                         # @azure/functions v4 + durable-functions v3
│   ├── tsconfig.json                        # TypeScript config
│   ├── host.json                            # Functions host configuration
│   ├── local.settings.json                  # Local dev settings
│   └── src/
│       ├── timers/
│       │   └── scheduled-routines.ts        # 11 timer triggers → POST /api/scheduled
│       ├── orchestrators/
│       │   ├── major-incident-bridge.ts     # Durable orchestrator: P1/P2 bridge lifecycle
│       │   ├── change-rollback.ts           # Durable orchestrator: failed change rollback
│       │   └── cab-voting-cycle.ts          # Durable orchestrator: CAB voting workflow
│       └── http/
│           └── triggers.ts                  # HTTP-triggered functions
│
├── appPackage/                              # Teams App Package
│   ├── manifest.json                        # Teams manifest
│   ├── declarativeAgent.json                # DA v1.6: 22 skills, 8 plugins, 11 capabilities
│   ├── instruction.txt                      # Full DA instructions (en-US)
│   ├── instruction-short.txt                # Compact instructions for DA
│   ├── instruction.fr-FR.txt                # French localization
│   ├── instruction.es-ES.txt                # Spanish localization
│   ├── instruction.ja-JP.txt                # Japanese localization
│   ├── eol-plugin.json                      # EOL data plugin definition
│   ├── change-mgmt-plugin.json              # Change management plugin (legacy)
│   ├── color.png                            # App icon (192×192)
│   ├── outline.png                          # App icon outline (32×32)
│   └── plugins/                             # 8 Domain API Plugins
│       ├── change-plugin.json               # Change management operations
│       ├── incident-plugin.json             # Incident management operations
│       ├── problem-plugin.json              # Problem management operations
│       ├── sla-plugin.json                  # SLA compliance operations
│       ├── knowledge-plugin.json            # Knowledge base operations
│       ├── cmdb-asset-plugin.json           # CMDB/Asset operations
│       ├── monitoring-plugin.json           # Monitoring and alerting operations
│       └── briefing-plugin.json             # Ops briefing generation
│
├── cowork-skills/                           # 22 Copilot Cowork Skill Definitions
│   ├── incident-manager/                    # Incident management skill
│   ├── change-manager/                      # Change enablement skill
│   ├── problem-manager/                     # Problem management skill
│   ├── asset-cmdb-manager/                  # IT asset / CMDB skill
│   ├── sla-manager/                         # Service level management skill
│   ├── knowledge-manager/                   # Knowledge management skill
│   ├── vendor-manager/                      # Supplier management skill
│   ├── service-desk-manager/                # Service desk skill
│   ├── monitoring-manager/                  # Monitoring & event management skill
│   ├── release-manager/                     # Release management skill
│   ├── capacity-manager/                    # Capacity & performance skill
│   ├── continuity-manager/                  # Service continuity skill
│   ├── security-manager/                    # Information security skill
│   ├── finops-manager/                      # Cloud FinOps skill
│   ├── shift-handover/                      # Shift handover briefing skill
│   ├── computer-use/                        # Computer Use (browser automation) skill
│   ├── agent-change-control/                # AI Governance: agent change control
│   ├── agent-compliance-dashboard/          # AI Governance: compliance dashboard
│   ├── agent-inventory-audit/               # AI Governance: agent inventory audit
│   ├── agent-ownership-transfer/            # AI Governance: ownership transfer
│   ├── shadow-agent-discovery/              # AI Governance: shadow agent detection
│   └── demo-data/                           # Demo scenario data
│
├── infra/                                   # Infrastructure as Code (Bicep)
│   ├── main.bicep                           # Root orchestration (29 Azure resources)
│   ├── main.json                            # Compiled ARM template
│   ├── main.parameters.json                 # Parameter file
│   └── modules/
│       ├── container-apps.bicep             # Container Apps Environment + 2 apps
│       ├── cognitive-services.bicep         # OpenAI + Content Safety + Speech
│       ├── data-services.bicep              # Cosmos DB + Redis + Service Bus + AI Search + Storage
│       ├── monitoring.bicep                 # Log Analytics + App Insights + KQL Alerts
│       ├── identity.bicep                   # 3 User-Assigned MIs + RBAC assignments
│       └── ai-foundry.bicep                 # AI Foundry Hub + Project + OpenAI Connection
│
├── .github/workflows/                       # CI/CD Pipelines
│   ├── ci.yml                               # Typecheck + test + Docker build (3 jobs)
│   ├── deploy.yml                           # ACR push + Container Apps deploy + health checks
│   └── foundry-evals.yml                    # Golden dataset eval + red-team scan
│
├── teamsapp.yml                             # Teams Toolkit project config
├── eslint.config.mjs                        # Shared ESLint config (TypeScript)
├── gen-icons.js                             # Icon generator utility
├── DEMO-SCRIPT.md                           # Demo walkthrough script
└── env/                                     # Environment configuration templates
```

---

## Capability index (developer reference)

| Capability | Description | Key Files |
|------------|-------------|-----------|
| **Worker Delegation** | ITIL chain-of-command routing (Monitoring → Incident → Problem → Change → Release) | `worker-delegation.ts`, `worker-registry.ts` |
| **Escalation Chain** | 3-level escalation: Worker retry → Command Center → Human-in-the-Loop | `escalation-chain.ts` |
| **Scheduled Routines** | 18 autonomous jobs (SLA prediction, stale tickets, CAB prep, CMDB audit, shift handover) | `scheduled-routines.ts`, `functions/src/timers/` |
| **Approval Queue** | Adaptive Card approval/rejection with configurable timeout (30 min default) | `approval-queue.ts`, `teams-approvals.ts` |
| **Audit Trail** | Azure Table Storage logging with recursive sensitive parameter redaction | `audit-trail.ts` |
| **HITL Controls** | All tool calls classified as read/write/notify with confirmation gates for mutations | `hitl.ts` |
| **ServiceNow CRUD** | Full create/read/update for incidents, changes, problems, assets, knowledge, vendors | `mcp-server/src/snow-client.ts` |
| **M365 Integration** | Email, Teams channels, Planner tasks, SharePoint docs, Graph Connectors | `graph-mail.ts`, `planner-tasks.ts`, `sharepoint-docs.ts` |
| **Voice Operations** | Azure Speech Avatar (Lisa/Ava) with WebRTC, voice-optimized ITSM tools | `voice/voiceProxy.ts`, `voice/voiceTools.ts` |
| **Content Safety** | Azure AI Content Safety prompt shields with fail-closed policy | `content-safety.ts` |
| **Reasoning Traces** | Full agent decision chain persisted in Cosmos DB for auditability | `reasoning-trace.ts`, `reasoning-rca.ts` |
| **Service Bus Events** | Decoupled inter-worker messaging across 5 topics | `service-bus.ts` |
| **Computer Use** | Foundry Computer Use for browser-based automation tasks | `computer-use.ts` |
| **Fine-Tuning Pipeline** | Extract resolved incidents/problems → create tuning dataset → deploy tuned model | `copilot-tuning.ts` |
| **A2A Protocol** | Agent-to-Agent discovery and messaging (federated agent mesh) | `connected-agents.ts` |
| **Power Automate** | 4 flow integrations (CAB voting, change approval, emergency change, incident escalation) | `power-automate.ts`, `power-automate-flows.ts` |
| **FinOps** | Azure cost anomaly detection, right-sizing recommendations, budget forecasting | `tools/finops-tools.ts` |
| **DLP Classification** | Purview-based record classification with PII auto-redaction | `mcp-server/src/purview-dlp.ts` |

---

## Request lifecycle — sequence

A user asks Alex to "schedule a 30-minute incident bridge with Sarah at 2 PM tomorrow". Here's the live path:

```mermaid
sequenceDiagram
    autonumber
    actor U as User in Teams
    participant W as Digital Worker
    participant H as Agent Harness
    participant A as Specialist Worker<br/>(Incident Manager)
    participant T as m365-tools.<br/>scheduleCalendarEvent
    participant X as Microsoft Agent 365
    participant M as M365 MCP Server<br/>(CalendarTools)
    participant G as Microsoft Graph

    U->>W: Activity (TurnContext + bearer token)
    W->>W: Content Safety prompt-shield check
    W->>H: classify intent → pick worker
    H->>A: run(agent, prompt, { context: { turnContext, ... } })
    A->>A: LLM decides: call schedule_teams_meeting
    A->>T: execute(args, runContext)

    alt MCP-first path (real user, OBO available)
        T->>X: GetAgenticUserToken(authorization, scope, turnContext)
        X-->>T: OBO token
        T->>M: callTool("createEvent", args)<br/>Authorization: OBO + agent-id + tenant-id
        M->>G: Graph /me/events as user
        G-->>M: event { id, joinUrl, webLink }
        M-->>T: result
        T-->>A: { source: 'mcp', success: true, joinUrl }
    else Graph fallback (cron / no TurnContext / MCP unavailable)
        T->>G: client_credentials → Graph /users/{sender}/events
        G-->>T: event payload
        T-->>A: { source: 'graph', success: true, joinUrl }
    end

    A->>A: format response with joinUrl + calendar links
    A-->>H: finalOutput
    H-->>W: HarnessResult
    W->>W: log reasoning trace + audit
    W-->>U: Adaptive Card with bridge details
```

The same diagram describes the autonomous path — only steps 1–3 differ (the trigger is a `Signal` from the signal-router rather than a user activity, and the `else` branch is taken because there's no `TurnContext` to OBO with).

---

## Cassidy MCP-first / Graph-fallback pattern

Every Microsoft 365 side effect (mail, Teams chat/channel, calendar, Planner, people lookup) goes through one static wrapper in `m365-tools.ts`. The wrapper picks a path based on what's available *right now*:

```mermaid
flowchart LR
    classDef ok fill:#065f46,stroke:#047857,color:#fff
    classDef warn fill:#7c2d12,stroke:#9a3412,color:#fff
    classDef neutral fill:#374151,stroke:#4b5563,color:#fff

    Start([Caller invokes wrapper<br/>e.g. sendEmail]) --> HasTC{TurnContext<br/>present?}

    HasTC -- yes --> Discover[mcp-tool-setup<br/>discover + cache MCP tools<br/>via Agent 365 OBO]
    Discover --> HasTool{Suitable<br/>MCP tool<br/>discovered?}
    HasTool -- yes --> CallMCP[invokeMcpTool<br/>OBO + tenant header]
    CallMCP --> MCPOK{Success?}
    MCPOK -- yes --> ReturnMCP[Return source: 'mcp']
    class ReturnMCP ok
    MCPOK -- no --> FBGraph

    HasTool -- no --> FBGraph
    HasTC -- no --> FBGraph[Graph fallback<br/>app-only client_credentials]

    FBGraph --> GraphOK{Success?}
    GraphOK -- yes --> ReturnGraph[Return source: 'graph']
    class ReturnGraph ok
    GraphOK -- no --> Unavailable[Return source: 'unavailable'<br/>structured failure]
    class Unavailable warn
```

**Why two paths matter**

- The MCP path keeps **user-context attribution end-to-end** — Sarah's calendar shows the meeting was created by Sarah, not by a service principal pretending to be her. This is essential for compliance and audit.
- The Graph path keeps the autonomous loop alive — cron jobs, signal-router actions, and mission-control buttons have no `TurnContext` and *must* still be able to send mail, schedule a Teams bridge, or post a channel message. Without the fallback, the digital worker would be a chatbot only.
- The tagged `source` on every result is the audit primitive — you can run a KQL query against the audit table and answer "which mail was sent on a user's behalf vs. by the service identity?" trivially.

---

## Autonomous Platform (Pillars 3–10)

The digital worker isn't just a chat-driven agent — it runs an autonomous control loop that observes signals, predicts breaches, takes graded action, verifies outcomes, and tunes its own thresholds.

```mermaid
flowchart LR
    classDef obs fill:#1e3a8a,stroke:#1e40af,color:#fff
    classDef act fill:#065f46,stroke:#047857,color:#fff
    classDef grade fill:#581c87,stroke:#6b21a8,color:#fff
    classDef gov fill:#7c2d12,stroke:#9a3412,color:#fff

    S1[ServiceNow webhooks<br/>· Azure Monitor alerts<br/>· SLA timers · cron] -->|POST /api/signals| SR[Signal Router<br/>match + cooldown]
    class S1,SR obs

    SR -->|matched| WE[Workflow Engine<br/>DAG · Kahn topological]
    SR -->|no match| Drop[Drop or<br/>fire-and-forget log]

    WE --> AG[Autonomy Gate<br/>confidence × 1−0.5·blast]
    AG -->|propose| HQ[HITL approval queue<br/>Adaptive Card]
    AG -->|approve| HQ
    AG -->|auto| Exec[Execute tools<br/>via m365-tools<br/>+ ServiceNow MCP]
    HQ -->|approved| Exec
    HQ -->|denied / timeout| Cancel[Cancel +<br/>record outcome]
    class WE,AG,HQ,Exec act

    Exec --> OV[Outcome Verifier<br/>+ LLM judge]
    OV --> Tables[(Azure Tables<br/>AlexOutcomes)]
    OV --> Tune[Autonomy Tuner<br/>raises/lowers thresholds]
    class OV,Tune,Tables grade

    Tune -. updates .- AG

    F[Foresight<br/>cluster mining<br/>24h forecast] -. forecasts .-> SR
    OV -. feeds .- F
    F --> Tables

    GOV[Governance<br/>kill / freeze / release] -. blocks .- SR & WE & Exec
    class GOV gov

    Goal[Goal Seeker<br/>plan → pursue] -. emits signals .-> SR
```

| Pillar | Module | Responsibility |
|--------|--------|---------------|
| **3. Signal ingestion** | [`signal-router.ts`](digital-worker/src/signal-router.ts), [`workflow-subscriptions.ts`](digital-worker/src/workflow-subscriptions.ts), [`snow-signal-mapper.ts`](digital-worker/src/snow-signal-mapper.ts) | Ingest ServiceNow webhooks, monitoring alerts, SLA breaches as `Signal` envelopes; route to subscriptions; enforce per-workflow cooldowns |
| **4. DAG workflows** | [`workflow-engine.ts`](digital-worker/src/workflow-engine.ts) | Linear (legacy) + DAG (Kahn topological) execution. Failure semantics mark transitive descendants `skipped` while independent branches keep running |
| **5. Foresight** | [`foresight.ts`](digital-worker/src/foresight.ts), [`anticipatory-store.ts`](digital-worker/src/anticipatory-store.ts), [`anticipatory-broadcaster.ts`](digital-worker/src/anticipatory-broadcaster.ts) | Mine clusters from incoming signals; 24h rolling forecast; SSE-broadcast forecasts and outcomes to mission-control |
| **6. Outcome verification** | [`outcome-verifier.ts`](digital-worker/src/outcome-verifier.ts), [`outcome-judge.ts`](digital-worker/src/outcome-judge.ts) | Post-action: did the workflow actually fix the thing? Hybrid heuristic + LLM judge; record success/failure to `AlexOutcomes` Table |
| **7. Trigger policy + autonomy** | [`trigger-policy.ts`](digital-worker/src/trigger-policy.ts), [`autonomy-gate.ts`](digital-worker/src/autonomy-gate.ts), [`autonomy-tuner.ts`](digital-worker/src/autonomy-tuner.ts) | Decide `propose` / `approve` / `auto`. Effective confidence = `confidence × (1 − 0.5 × blastRadius)`. Tuner raises auto-threshold after sustained failures, lowers after sustained successes |
| **8. Governance** | [`governance.ts`](digital-worker/src/governance.ts) | Kill switch (per-workflow or platform-wide), freeze, release. Survives restart via `AlexGovernance` Table. Honored by signal-router and workflow-engine |
| **9. Experiential memory + cognition graph** | [`experiential-memory.ts`](digital-worker/src/experiential-memory.ts), [`cognition-graph.ts`](digital-worker/src/cognition-graph.ts) | Past-incident fingerprint recall; CI ↔ incident ↔ service ↔ change graph queries via `/api/experience/*` and `/api/cognition/graph` |
| **10. Goal pursuit** | [`goal-seeker.ts`](digital-worker/src/goal-seeker.ts) | Proactive plan→pursue: turn high-level goals into a sequence of investigative actions; surface plans on `/api/goals/plan`, execute on `/api/goals/pursue` |

**State persistence**: All autonomous-loop state (outcomes, tuner state, governance flags, signal history, experience fingerprints) lives in Azure Table Storage under partitions `AlexOutcomes`, `AlexTunerState`, `AlexGovernance`, `AlexSignals`, `experiential` (the last partition is reused on the AlexOutcomes table — no new table needed). When Tables aren't configured, every store falls back to an in-memory implementation so unit tests and local dev work offline.

**Public endpoints (Pillars 3–10)**:
- `GET /api/foresight` (clusters + forecast)
- `POST /api/foresight/run` (secret-gated)
- `GET /api/outcomes`
- `POST /api/governance/{kill,release,freeze}` (secret-gated)
- `GET /api/autonomy/thresholds`
- `GET /api/goals/plan`, `POST /api/goals/pursue` (secret-gated)
- `GET /api/experience/recent`, `GET /api/experience/find`
- `GET /api/cognition/graph`
- `GET /api/jobs`, `GET /api/jobs/:id`

All gated POSTs require the `x-scheduled-secret` header (timing-safe compare against `SCHEDULED_SECRET`).

---

## ITIL 4 Worker Mapping

| Worker | ITIL 4 Practice | Tier | Tools Module | HITL Level |
|--------|----------------|------|-------------|------------|
| Incident Manager | Incident Management | 1 | `incident-tools.ts` | Write: required, Read: none |
| Change Manager | Change Enablement | 1 | `change-tools.ts` | Write: required, CAB: required |
| Problem Manager | Problem Management | 1 | `problem-tools.ts` | Write: required |
| Asset/CMDB Manager | IT Asset / Configuration Management | 1 | `asset-cmdb-tools.ts` | Write: required |
| SLA Manager | Service Level Management | 1 | `sla-tools.ts` | Read: none, Escalation: optional |
| Knowledge Manager | Knowledge Management | 1 | `knowledge-tools.ts` | Harvest: required, Search: none |
| Vendor Manager | Supplier Management | 1 | `(shared tools)` | Write: required |
| Service Desk Manager | Service Desk | 2 | `service-desk-tools.ts` | Write: optional |
| Monitoring Manager | Monitoring & Event Management | 2 | `monitoring-tools.ts` | Read: none, Alert: optional |
| Release Manager | Release Management | 2 | `release-tools.ts` | Deploy: required |
| Capacity Manager | Capacity & Performance Management | 3 | `(shared tools)` | Read: none |
| Continuity Manager | Service Continuity Management | 3 | `availability-tools.ts` | DR actions: required |
| Security Manager | Information Security Management | 3 | `(shared tools)` | All: required |
| FinOps Manager | Financial Management of IT Services | — | `finops-tools.ts` | Read: none |
| Reporting Manager | Measurement & Reporting | — | `reporting-tools.ts` | Read: none |
| Shift Handover | (Cross-cutting) | — | `briefing-tools.ts` | None |
| Computer Use Operator | (Automation) | — | `computer-use.ts` | Required |
| Request Fulfilment | Request Fulfilment | — | `request-tools.ts` | Optional |
| Catalogue Manager | Service Catalogue Management | — | `catalogue-tools.ts` | Read: none |
| Risk Manager | Risk Management | — | `risk-tools.ts` | Read: none |
| Deployment Manager | Deployment Management | — | `deployment-tools.ts` | Required |
| Availability Manager | Availability Management | — | `availability-tools.ts` | Read: none |

**AI Governance Workers** (5 additional, Cowork-only):

| Worker | Purpose | Skill ID |
|--------|---------|----------|
| Agent Change Control | ITIL-aligned change management for agent modifications | `agent-change-control` |
| Agent Compliance Dashboard | Compliance posture assessment for all agents | `agent-compliance-dashboard` |
| Agent Inventory Audit | Discover and catalogue all agents in the tenant | `agent-inventory-audit` |
| Agent Ownership Transfer | Managed handover of agent ownership | `agent-ownership-transfer` |
| Shadow Agent Discovery | Detect unregistered/shadow agents across the tenant | `shadow-agent-discovery` |

---

## Declarative Agent Configuration

The declarative agent (`appPackage/declarativeAgent.json`) is a v1.6 schema configuration:

### Capabilities (11)

| Capability | Configuration |
|------------|---------------|
| `CodeInterpreter` | Enabled (data analysis, chart generation) |
| `People` | Enabled (Entra people lookup) |
| `Email` | Enabled (Graph Mail read/send) |
| `TeamsMessages` | Enabled (Teams message search) |
| `OneDriveAndSharePoint` | Scoped to `absx68251802.sharepoint.com/Shared Documents` |
| `WebSearch` | Enabled (Bing grounding) |
| `GraphConnectors` | Connection: `servicenow-kb-connector` |
| `Image` | Enabled (image understanding) |
| `CopilotConnectors` | Connectors: `servicenow`, `azure-devops` |
| `EnterpriseGraphSearch` | Enabled (enterprise-wide search) |
| `Memory` | Enabled (cross-conversation memory) |

### Skills (22)

13 ITIL practice skills + 5 AI governance skills + shift-handover + finops-manager + computer-use-operator + knowledge-harvester.

### Plugins (8 + 1)

8 domain plugins (`change`, `incident`, `problem`, `sla`, `knowledge`, `cmdb-asset`, `monitoring`, `briefing`) + 1 EOL data plugin.

### Knowledge Sources (4)

| Source | Type | Details |
|--------|------|---------|
| ServiceNow KB | GraphConnector | `servicenow-kb-connector` — articles, runbooks, KEDB |
| Operational Docs | SharePoint | `absx68251802.sharepoint.com/sites/itsm-operations` — runbooks, DR plans, PIR reports |
| ITSM Knowledge | AzureAISearch | Index `itsm-knowledge-v1`, semantic config `default`, vector field `content_vector` |
| Microsoft Learn | MicrosoftLearn | Scoped: `azure`, `microsoft-365`, `security` |

### Tool Overrides

| Tool | HITL | Approval Audience |
|------|------|-------------------|
| `create-change-request` | Required | ChangeManagers |
| `update-cmdb-ci` | Required | — |
| `create-incident` | Optional | — |
| `update-incident` | Required | — |
| `create-problem` | Required | — |
| `search-knowledge` | — (citation: required) | — |
| `harvest-knowledge` | Required | KnowledgeManagers |
| `update-change-request` | Required | — |
| `generate-cab-agenda` | Optional | — |
| `get-azure-alerts` | — (citation: required) | — |

### Behavior Overrides

**Refuses when:**
- User requests bypass of CAB approval process
- User requests deletion of audit records or logs
- User requests change implementation outside approved window without ECAB authorization
- User requests bulk deletion of ServiceNow records
- User requests access to another user's credentials or tokens
- User attempts to disable HITL controls or safety gates

**Always cites:**
- NIST 800-53 control reference when discussing security controls
- ITIL 4 practice name when performing service management activities
- ServiceNow record number when referencing specific tickets
- SLA target when discussing service level compliance

### Localization

| Language | File |
|----------|------|
| English (default) | `instruction-short.txt` |
| French | `instruction.fr-FR.txt` |
| Spanish | `instruction.es-ES.txt` |
| Japanese | `instruction.ja-JP.txt` |

---

## Azure Infrastructure

All 29 Azure resources are deployed via Bicep (`infra/main.bicep`):

| # | Resource | Type | Purpose |
|---|----------|------|---------|
| 1 | `itsmops{env}acr` | Container Registry (Basic) | Docker image registry for digital-worker and mcp-server |
| 2 | `itsm-ops-{env}-kv` | Key Vault | Secrets store (ServiceNow credentials, API keys) |
| 3 | `itsm-ops-{env}-law` | Log Analytics Workspace | Centralized log collection and KQL queries |
| 4 | `itsm-ops-{env}-ai` | Application Insights | APM, distributed tracing, custom events/metrics |
| 5–9 | KQL Alert Rules (5) | Scheduled Query Rules | Error rate, tool latency, ServiceNow failures, token spikes, HITL pending |
| 10 | `itsm-ops-openai` | Azure OpenAI | GPT-4o (reasoning), o4-mini (fast routing) |
| 11 | `itsm-ops-safety` | Content Safety | Prompt shields, content classification |
| 12 | `itsm-speech-avatar` | Speech Service | Voice avatar (Lisa character, Ava Multilingual voice) |
| 13 | `itsmopscosmosdb` | Cosmos DB | State, reasoning traces, memory, conversation history |
| 14 | Azure Redis Cache | Redis | Session cache, token cache, conversation cache |
| 15 | `itsmopsservicebus` | Service Bus | 5 topics for inter-worker pub/sub messaging |
| 16 | Azure AI Search | Cognitive Search | Hybrid + vector search on ITSM knowledge base |
| 17 | `itsmops{env}st` | Storage Account | Function App storage, audit trail tables |
| 18 | Container Apps Environment | Managed Environment | Shared networking/logging for containers |
| 19 | `itsm-digital-worker` | Container App | Digital worker service (port 3978) |
| 20 | `itsm-mcp-server` | Container App | MCP server service (port 3002) |
| 21 | `itsm-ops-{env}-plan` | App Service Plan (Y1) | Consumption plan for Function App |
| 22 | `itsm-ops-{env}-func` | Function App (Linux, Node 20) | Durable Functions for timers + orchestrators |
| 23 | AI Foundry Hub | Machine Learning Hub | AI project management |
| 24 | AI Foundry Project | Machine Learning Project | Agent evaluation and tuning |
| 25 | OpenAI Connection | ML Connection | Foundry ↔ Azure OpenAI linkage |
| 26 | Incident Manager MI | User-Assigned Managed Identity | Scoped RBAC for incident operations |
| 27 | Change Manager MI | User-Assigned Managed Identity | Scoped RBAC for change operations |
| 28 | Security Manager MI | User-Assigned Managed Identity | Scoped RBAC for security operations |
| 29 | ACR Pull Roles (2) | Role Assignments | Digital Worker + MCP Server pull from ACR |

**Container App FQDN**: `<your-container-app>.azurecontainerapps.io`

---

## M365 Integration

| Integration | Module | Description |
|-------------|--------|-------------|
| **Graph Mail** | `graph-mail.ts` | Send/read emails via Microsoft Graph. Used for shift handover briefings, PIR reports, SLA breach notifications. Sender: `alexitops@{tenant}.onmicrosoft.com`. |
| **Teams Approvals** | `teams-approvals.ts` | Universal Actions for HITL approval workflows. Configurable timeout (`APPROVAL_TIMEOUT_MS`, default 30 min). Callback at `/api/approvals/callback`. |
| **Teams Channels** | `teams-channel.ts` | Auto-create incident bridge channels for P1/P2. Post incident details, invite resolver groups, track bridge lifecycle. |
| **Planner Tasks** | `planner-tasks.ts` | Create action items in Microsoft Planner (remediation tasks, PIR follow-ups, knowledge gaps). Requires `PLANNER_GROUP_ID` and `PLANNER_PLAN_ID`. |
| **SharePoint Docs** | `sharepoint-docs.ts` | Read/write to SharePoint document library (DR plans, runbooks, architecture docs). Requires `SHAREPOINT_SITE_ID` and `SHAREPOINT_DRIVE_ID`. |
| **Graph Connectors** | `graph-connector.ts` | Indexes ServiceNow KB articles into M365 search via External Connector `servicenow-kb-connector`. Enables natural language KB search from any M365 surface. |
| **Copilot Connectors** | DA config | Pre-built connectors for ServiceNow and Azure DevOps data. |
| **Power Automate** | `power-automate.ts` | 4 HTTP-triggered flows: CAB voting, change approval, emergency change fast-track, incident escalation. Callback at `/api/flows/callback`. |
| **WorkIQ** | `workiq-client.ts` | M365 Copilot API client for cross-agent data queries. |

---

## Security Architecture

### Key Vault + Managed Identity
- All secrets resolved at startup via `secret-resolver.ts`
- `DefaultAzureCredential` for keyless auth (Managed Identity in Azure, `az login` locally)
- Key Vault: `kv-itsm-operations` with RBAC authorization and soft delete (90 days)
- Pre-warmed managed identity tokens to avoid IMDS cold-start delay (~60s)

### Content Safety + Prompt Shields
- Azure AI Content Safety (`content-safety.ts`) evaluates all user inputs
- Categories: hate, violence, self-harm, sexual content
- **Fail-closed policy**: if Content Safety is misconfigured, all inputs are blocked
- Prompt injection detection via Foundry red-team scanning in CI

### OAuth OBO for ServiceNow
- `snow-auth.ts` handles OAuth On-Behalf-Of flow for ServiceNow API access
- Supports both basic auth (dev) and OAuth (production)

### Purview DLP Classification
- `purview-dlp.ts` classifies every ServiceNow record before returning to the agent
- PII auto-redaction for sensitive fields
- Operation-level access control (read vs. write per classification)

### Conditional Access
- `conditional-access.ts` enforces Entra Conditional Access policies
- Token validation via `authorizeJWT` middleware on protected routes

### HITL Controls
- Every tool call classified as `read`, `write`, or `notify` (`hitl.ts`)
- `write` and `notify` operations require user confirmation
- Configurable per-tool overrides in `declarativeAgent.json` → `tools_settings`
- Approval timeout with automatic cancellation

### Audit Trail
- `audit-trail.ts` logs all tool calls to Azure Table Storage
- Recursive sanitization of sensitive parameters (passwords, tokens, API keys) before logging
- Timing-safe authentication (`crypto.timingSafeEqual`) for scheduled endpoints
- Bounded in-memory collections with FIFO eviction

### Query Sanitization
- `snow-query.ts` (SnowQuery builder) prevents ServiceNow query injection
- Parameterized query construction — no string interpolation of user input
- Tested with injection prevention test suite (`snow-query.test.ts`)

---

## Observability

### OpenTelemetry
- Full OTel instrumentation via `telemetry.ts`
- **GenAI semantic conventions**: `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.tool.name`
- W3C Trace Context propagation across MCP calls and ServiceNow requests
- Auto-instrumentation via `@opentelemetry/auto-instrumentations-node`
- Dual export: Application Insights (production) + OTLP (development)

### Azure Monitor / Log Analytics
- `log-analytics.ts` tracks custom events: `itsm.tool.call.completed`, `itsm.hitl.requested`, `itsm.hitl.completed`
- `kql-templates.ts` provides reusable KQL query templates:
  - Agent error rate (hourly)
  - Tool call latency percentiles (P50/P95/P99)
  - Worker routing distribution
  - Token usage trends

### KQL Alert Rules (5)

| Alert | Severity | Window | Condition |
|-------|----------|--------|-----------|
| Agent Error Rate > 5% | Critical (0) | 1 hour | Error rate exceeds 5% of total requests |
| Tool Call P95 Latency > 10s | Warning (2) | 15 min | P95 latency exceeds 10 seconds |
| ServiceNow API Failures > 10 | Critical (0) | 5 min | More than 10 failed ServiceNow HTTP calls |
| Token Usage Spike > 2× Baseline | Warning (2) | 1 hour | Current usage exceeds 2× 7-day rolling average |
| HITL Approvals Pending > 30 min | Info (3) | 1 hour | Approvals pending without response for 30+ minutes |

### Reasoning Traces
- `reasoning-trace.ts` persists full agent decision chains in Cosmos DB
- Queryable via `/api/reasoning` endpoint (filter by conversationId, type, since)
- Statistics: total traces, conversations, trace types distribution

### Mission Control Dashboard
- `mission-control.html` — single-page dashboard served at `/mission-control`
- Real-time view of: active workers, pending approvals, recent tool calls, service status

---

## MCP Server

The MCP Server (`mcp-server/`, port 3002) bridges M365 Copilot to ServiceNow and Azure services.

### Widgets (18)

| # | Widget | Type | Description |
|---|--------|------|-------------|
| 1 | `change-dashboard` | Skybridge (read-only) | Change management overview with status breakdown |
| 2 | `change-request` | Skybridge (read-only) | Single change request detail view |
| 3 | `blast-radius` | Skybridge (read-only) | CI dependency graph for impact analysis |
| 4 | `risk-forecast` | Skybridge (read-only) | EOL risk timeline visualization |
| 5 | `asset-lifecycle` | Skybridge (read-only) | Asset lifecycle status dashboard |
| 6 | `change-briefing` | Skybridge (read-only) | Change risk briefing summary |
| 7 | `change-metrics` | Skybridge (read-only) | Change KPIs and success rates |
| 8 | `incident-dashboard` | Skybridge (read-only) | Active incidents by priority and status |
| 9 | `problem-dashboard` | Skybridge (read-only) | Problem backlog and RCA progress |
| 10 | `sla-dashboard` | Skybridge (read-only) | SLA compliance heat map |
| 11 | `itsm-briefing` | Skybridge (read-only) | Cross-practice ops briefing |
| 12 | `mission-control` | Skybridge (read-only) | Platform health and worker status |
| 13 | `change-form` | Interactive | Change request creation form |
| 14 | `audit-trail` | Interactive | Audit log viewer with filtering |
| 15 | `finops-dashboard` | Interactive | Azure cost analysis dashboard |
| 16 | `shadow-agents` | Interactive | Shadow agent discovery results |
| 17 | `schedule-control` | Interactive | Scheduled routine management |
| 18 | `handover` | Interactive | Shift handover report viewer |

**Widget Features**: Fluent UI v9 design system, dark mode support, WCAG 2.1 accessibility, `text/html+skybridge` MIME type, server-side data injection via `window.__TOOL_DATA__`.

### Adaptive Cards (4)

| Card | File | Purpose |
|------|------|---------|
| CAB Voting | `adaptive-cards.ts` | CAB members vote approve/reject/defer with comments |
| Change Form | `adaptive-cards.ts` | RFC submission with risk assessment fields |
| Incident Escalation | `adaptive-cards.ts` | P1/P2 escalation notification with action buttons |
| Approval | `adaptive-cards.ts` | Generic HITL approval card (Universal Actions 1.6) |

### Tool Routing

8 domain plugins route tool calls across the MCP server:

| Plugin | Domain | Key Operations |
|--------|--------|----------------|
| `change-plugin` | Change Management | CRUD changes, risk scoring, CAB agenda, collision detection, PIR |
| `incident-plugin` | Incident Management | CRUD incidents, triage, correlation, dashboard |
| `problem-plugin` | Problem Management | CRUD problems, KEDB, RCA tracking |
| `sla-plugin` | SLA Management | Compliance queries, breach prediction, escalation |
| `knowledge-plugin` | Knowledge Management | KB search, article management, gap analysis |
| `cmdb-asset-plugin` | CMDB / Asset | CI queries, relationships, EOL/EOS lifecycle |
| `monitoring-plugin` | Monitoring | Azure alerts, event correlation, metrics |
| `briefing-plugin` | Operations | Cross-practice briefing generation |

---

## Voice & Avatar

- **Azure Speech Avatar**: Lisa character, casual-sitting style
- **Voice**: `en-US-AvaMultilingualNeural`
- **Authentication**: Entra token auth via Managed Identity (no subscription key required)
- **Custom Subdomain**: `itsm-speech-avatar.cognitiveservices.azure.com` (required when `disableLocalAuth=true`)
- **WebRTC ICE Relay**: Token fetched server-side via `/api/voice/avatar-config`
- **WebSocket Proxy**: `voiceProxy.ts` bridges browser audio ↔ Azure Voice Live
- **Voice-Optimized Tools**: `voiceTools.ts` provides concise, spoken-format ITSM queries
- **Feature Gate**: `voiceGate.ts` controls voice enablement per environment
- **Client**: `voice/voice.html` served at `/voice`
- **Configuration**: `AZURE_SPEECH_REGION=westus2`, `VOICELIVE_MODEL=gpt-4o`

---

## Scheduled Routines

| # | Routine | Schedule | Worker | Description |
|---|---------|----------|--------|-------------|
| 1 | `incident-stale-check` | `0 */4 * * *` (every 4h) | Incident Manager | Find open incidents with no updates in 24+ hours |
| 2 | `incident-recurring-pattern` | `0 6 * * 1` (Mon 06:00) | Incident Manager | Weekly recurring incident pattern analysis |
| 3 | `sla-breach-prediction` | `*/30 * * * *` (every 30m) | SLA Manager | Predict SLA breaches within next 2 hours |
| 4 | `sla-breach-escalation` | `*/30 * * * *` (every 30m) | SLA Manager | Trigger escalation for approaching/breached SLAs |
| 5 | `change-collision-check` | `0 7 * * 1-5` (weekdays 07:00) | Change Manager | Daily change collision and conflict detection |
| 6 | `change-pir-overdue` | `0 9 * * 3` (Wed 09:00) | Change Manager | Check for overdue post-implementation reviews |
| 7 | `vendor-contract-expiry` | `0 8 * * 1` (Mon 08:00) | Vendor Manager | Weekly contract expiry check (30/60/90 day windows) |
| 8 | `vendor-license-compliance` | `0 8 1 * *` (1st of month 08:00) | Vendor Manager | Monthly software license compliance audit |
| 9 | `knowledge-gap-analysis` | `0 7 * * 5` (Fri 07:00) | Knowledge Manager | Weekly KB gap analysis against incident categories |
| 10 | `asset-eol-scan` | `0 6 1 * *` (1st of month 06:00) | Asset/CMDB Manager | Monthly EOL/EOS asset lifecycle scan |
| 11 | `asset-warranty-check` | `0 6 15 * *` (15th of month 06:00) | Asset/CMDB Manager | Bi-monthly warranty expiration check |
| 12 | `problem-kedb-review` | `0 9 * * 4` (Thu 09:00) | Problem Manager | Weekly known error database review |
| 13 | `monday-cab-prep` | `0 7 * * 1` (Mon 07:00) | Change Manager | CAB agenda preparation, calendar invites, Teams posting |
| 14 | `emergency-change-fast-track` | `*/15 * * * *` (every 15m) | Change Manager | Fast-track emergency change approval flow |
| 15 | `major-incident-bridge` | `*/5 * * * *` (every 5m) | Incident Manager | Auto-create Teams bridge for new P1/P2 incidents |
| 16 | `daily-ops-standup` | `0 8 * * 1-5` (weekdays 08:00) | Reporting Manager | Daily ops briefing across all practice areas |
| 17 | `incident-to-problem-promotion` | `0 */2 * * *` (every 2h) | Problem Manager | Detect repeat incidents and auto-create problem records |
| 18 | `cmdb-health-audit` | `0 2 * * *` (daily 02:00) | Asset/CMDB Manager | CMDB completeness and accuracy audit |
| 19 | `post-incident-kb-capture` | `0 * * * *` (every hour) | Knowledge Manager | Draft KB articles from recently resolved incidents |
| 20 | `monthly-health-report` | `0 6 1 * *` (1st of month 06:00) | Reporting Manager | Monthly ITSM health report with KPI trends |

**Execution**: Routines are triggered externally by Azure Durable Functions timer triggers via HTTP POST to `/api/scheduled` with `{ routineId }`. No in-process cron — `DISABLE_CRON=true` delegates all scheduling to Durable Functions.

---

## Environment Variables

### Agent Identity & Auth

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | `development` or `production` |
| `PORT` | Server port (default: `3978`) |
| `MicrosoftAppId` | Agent 365 App ID |
| `MicrosoftAppTenantId` | Entra tenant ID |
| `MicrosoftAppType` | `SingleTenant` |
| `SCHEDULED_SECRET` | HMAC secret for `/api/scheduled` endpoint (timing-safe) |
| `MANAGER_EMAIL` | IT operations manager email address |
| `MANAGER_NAME` | IT operations manager display name |

### Azure OpenAI

| Variable | Description |
|----------|-------------|
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL |
| `AZURE_OPENAI_MODEL` | Primary model deployment (e.g., `gpt-4o`) |
| `AZURE_OPENAI_API_VERSION` | API version (e.g., `2025-01-01-preview`) |
| `AZURE_OPENAI_REASONING_DEPLOYMENT` | Reasoning model (e.g., `o4-mini`) |
| `ROUTING_MODEL` | Model for worker routing (optional override) |
| `REASONING_MODEL` | Model for complex reasoning (optional override) |
| `ENABLE_LLM_ROUTING` | `true`/`false` — hybrid regex + LLM routing |

### MCP Server

| Variable | Description |
|----------|-------------|
| `MCP_CHANGE_ENDPOINT` | MCP server URL (e.g., `https://change-mgmt-mcp.{env}.azurecontainerapps.io/change/mcp`) |

### Azure Services

| Variable | Description |
|----------|-------------|
| `COSMOS_CONNECTION_STRING` | Cosmos DB connection string |
| `COSMOS_DATABASE` | Cosmos DB database name (default: `itsm-db`) |
| `REDIS_URL` | Azure Redis Cache connection string |
| `SERVICE_BUS_CONNECTION_STRING` | Service Bus connection string |
| `SERVICE_BUS_NAMESPACE` | Service Bus namespace name |
| `KEY_VAULT_NAME` | Key Vault name for secret resolution |
| `CONTENT_SAFETY_ENDPOINT` | Azure AI Content Safety endpoint |
| `CONTENT_SAFETY_KEY` | Content Safety key (optional if using MI) |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Application Insights connection string |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint for dev tracing |

### Voice & Avatar

| Variable | Description |
|----------|-------------|
| `AZURE_SPEECH_REGION` | Speech service region (e.g., `westus2`) |
| `AZURE_SPEECH_ENDPOINT` | Custom subdomain endpoint |
| `AVATAR_CHARACTER` | Avatar character (default: `lisa`) |
| `AVATAR_STYLE` | Avatar style (default: `casual-sitting`) |
| `AVATAR_VOICE` | Voice name (default: `en-US-AvaMultilingualNeural`) |
| `VOICELIVE_ENDPOINT` | Voice Live endpoint for real-time conversation |
| `VOICELIVE_MODEL` | Voice Live model (default: `gpt-4o`) |

### M365 Integration

| Variable | Description |
|----------|-------------|
| `GRAPH_MAIL_SENDER` | Email sender address for Graph Mail |
| `GRAPH_CONNECTOR_ID` | Graph Connector external connection ID |
| `PLANNER_GROUP_ID` | M365 Group ID for Planner |
| `PLANNER_PLAN_ID` | Planner Plan ID |
| `SHAREPOINT_SITE_ID` | SharePoint site ID |
| `SHAREPOINT_DRIVE_ID` | SharePoint drive ID |
| `ITSM_TEAM_ID` | Teams team ID for incident bridges |
| `ITSM_ALERTS_CHANNEL_ID` | Teams channel ID for alert posting |
| `APPROVAL_TIMEOUT_MS` | HITL approval timeout (default: `1800000` / 30 min) |

### Power Automate

| Variable | Description |
|----------|-------------|
| `POWER_AUTOMATE_CAB_VOTING_URL` | CAB voting flow trigger URL |
| `POWER_AUTOMATE_CHANGE_APPROVAL_URL` | Change approval flow trigger URL |
| `POWER_AUTOMATE_EMERGENCY_CHANGE_URL` | Emergency change flow trigger URL |
| `POWER_AUTOMATE_INCIDENT_ESCALATION_URL` | Incident escalation flow trigger URL |

### AI Foundry & Advanced

| Variable | Description |
|----------|-------------|
| `FOUNDRY_ENDPOINT` | Azure AI Foundry endpoint |
| `FOUNDRY_PROJECT` | Foundry project name |
| `FOUNDRY_HUB` | Foundry hub name |
| `FOUNDRY_API_KEY` | Foundry API key |
| `ENABLE_FOUNDRY_DELEGATION` | Enable A2A delegation via Foundry |
| `COMPUTER_USE_ENDPOINT` | Foundry Computer Use endpoint |
| `COMPUTER_USE_API_KEY` | Computer Use API key |
| `COPILOT_TUNING_ENDPOINT` | Fine-tuning pipeline endpoint |
| `TUNED_MODEL_DEPLOYMENT` | Tuned model deployment name |
| `APIM_ENDPOINT` | Azure API Management endpoint |
| `APIM_SUBSCRIPTION_KEY` | APIM subscription key |

### Scheduler

| Variable | Description |
|----------|-------------|
| `DISABLE_CRON` | `true` to use Durable Functions instead of in-process cron |
| `ENABLE_LOCAL_POLLING` | `true` for local dev incident polling |

---

## Prerequisites

- **Node.js** 20+ (digital-worker, functions) / 22+ (mcp-server)
- **TypeScript** 5.9+
- **Azure CLI** (`az`) with active subscription
- **Teams Toolkit** CLI (`teamsapp`) or VS Code extension
- **ServiceNow** instance with REST API access (Table API, OAuth)
- **Docker** (for container builds)
- **Azure subscription** with the following resource providers:
  - `Microsoft.ContainerRegistry`
  - `Microsoft.App` (Container Apps)
  - `Microsoft.DocumentDB` (Cosmos DB)
  - `Microsoft.Cache` (Redis)
  - `Microsoft.ServiceBus`
  - `Microsoft.CognitiveServices` (OpenAI, Content Safety, Speech)
  - `Microsoft.Search` (AI Search)
  - `Microsoft.KeyVault`
  - `Microsoft.Web` (Function App)
  - `Microsoft.MachineLearningServices` (AI Foundry)

---

## Quick Start

```bash
# 1. Clone
git clone <repo-url> && cd ITSMOperations

# 2. Install dependencies
cd digital-worker && npm install
cd ../mcp-server && npm install
cd ../functions && npm install
cd ..

# 3. Configure environment
# Edit digital-worker/.env with your Azure/ServiceNow credentials
# Edit mcp-server/.env with ServiceNow instance details

# 4. Run tests
cd digital-worker && npm test       # 216 tests across 28 files
cd ../mcp-server && npm test        # MCP-server tests

# 5. Start MCP Server (terminal 1)
cd mcp-server && npm run dev        # http://localhost:3002

# 6. Start Digital Worker (terminal 2)
cd digital-worker && npm run dev    # http://localhost:3978

# 7. Verify health
curl http://localhost:3978/api/health
curl http://localhost:3978/api/platform-status

# 8. Open Mission Control
open http://localhost:3978/mission-control

# 9. (Optional) Start Teams Toolkit for M365 Copilot testing
teamsapp preview --env dev
```

---

## Deployment

### Docker Build

```bash
# Digital Worker
cd digital-worker
docker build -t itsm-digital-worker:latest .
# Multi-stage: node:20-slim builder → node:20-slim runtime
# Copies: dist/, mission-control.html
# Exposes: port 3978

# MCP Server
cd mcp-server
docker build -t itsm-mcp-server:latest .
# Multi-stage: node:22-slim builder → node:22-slim runtime
# Runs: npm run build:widgets, then tsx runtime
# Exposes: port 3002
```

### ACR Push

```bash
# Tag and push
SHA=$(git rev-parse --short HEAD)
az acr login --name <acr-name>

docker tag itsm-digital-worker:latest <acr-login-server>/itsm-worker:${SHA}
docker push <acr-login-server>/itsm-worker:${SHA}

docker tag itsm-mcp-server:latest <acr-login-server>/itsm-mcp-server:${SHA}
docker push <acr-login-server>/itsm-mcp-server:${SHA}
```

### Container Apps Deployment

```bash
# Update digital worker
az containerapp update \
  --name itsm-digital-worker \
  --resource-group <resource-group> \
  --image <acr-login-server>/itsm-worker:${SHA}

# Update MCP server
az containerapp update \
  --name itsm-mcp-server \
  --resource-group <resource-group> \
  --image <acr-login-server>/itsm-mcp-server:${SHA}

# Health checks
curl https://<your-container-app>.azurecontainerapps.io/api/health
```

### Bicep IaC Deployment

```bash
# Deploy all 29 Azure resources from scratch
az deployment group create \
  --resource-group <resource-group> \
  --template-file infra/main.bicep \
  --parameters infra/main.parameters.json \
  --parameters environmentName=dev \
               snowInstanceUrl=https://<instance>.service-now.com \
               agentAppId=<entra-app-id>
```

---

## CI/CD

### CI (`.github/workflows/ci.yml`)

Runs on every push and PR to `main`:

| Job | Runtime | Steps |
|-----|---------|-------|
| `digital-worker` | Node 20 | `npm ci` → typecheck → test → Docker build (validate) |
| `mcp-server` | Node 22 | `npm install` → typecheck → test → Docker build (validate) |
| `validate-app-package` | Node (any) | Teams manifest schema validation (required fields + DA presence) |

Concurrency: `ci-${{ github.ref }}` with cancel-in-progress.

### CD (`.github/workflows/deploy.yml`)

Runs after CI passes on `main`, or via manual `workflow_dispatch`:

| Job | Steps |
|-----|-------|
| `build-push` | Azure Login (OIDC) → ACR Login → Docker build & push (SHA-tagged) |
| `deploy` | `az containerapp update` for both services → health checks (curl with retry) |
| `update-teams-app` | Install Teams Toolkit CLI → `teamsapp deploy --env dev` (dev only) |

### Foundry Evaluations (`.github/workflows/foundry-evals.yml`)

Runs on PRs to `main` when `digital-worker/src/`, `mcp-server/src/`, or `cowork-skills/` change:

| Job | Steps |
|-----|-------|
| `evaluate` | Install → unit tests with coverage → golden dataset evaluation (20 scenarios) → upload artifacts |
| `security-scan` | Prompt injection scan against golden dataset (Foundry Red Team Agent) |

### GitHub Secrets Required

| Secret/Variable | Type | Description |
|-----------------|------|-------------|
| `AZURE_CLIENT_ID` | Secret | OIDC service principal client ID |
| `AZURE_TENANT_ID` | Secret | Entra tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Secret | Azure subscription ID |
| `FOUNDRY_ENDPOINT` | Secret | AI Foundry endpoint (optional, for evals) |
| `FOUNDRY_API_KEY` | Secret | AI Foundry API key (optional) |
| `ACR_NAME` | Variable | Container Registry name (digital worker) |
| `ACR_LOGIN_SERVER` | Variable | ACR login server URL |
| `MCP_ACR_NAME` | Variable | Container Registry name (MCP server) |
| `MCP_ACR_LOGIN_SERVER` | Variable | MCP ACR login server URL |
| `AZURE_RESOURCE_GROUP` | Variable | Digital worker resource group |
| `MCP_RESOURCE_GROUP` | Variable | MCP server resource group |
| `DW_CONTAINER_APP_NAME` | Variable | Digital worker Container App name |
| `MCP_CONTAINER_APP_NAME` | Variable | MCP server Container App name |

---

## Testing

### Configuration

Both projects use **vitest** v4.1:

- **Digital Worker** (`vitest.config.ts`): v8 coverage provider, thresholds: statements 50%, branches 40%, functions 40%, lines 50%. Excludes `index.ts` and `tools/` from coverage.
- **MCP Server** (`vitest.config.ts`): Standard config, tests in `src/__tests__/`.

### Test Suites

| Suite | File | Tests | Coverage |
|-------|------|-------|----------|
| Worker Registry | `worker-registry.test.ts` | Intent classification, keyword scoring, fallback routing | Core |
| Worker Delegation | `worker-delegation.test.ts` | ITIL chain-of-command, cross-tier delegation | Core |
| Escalation Chain | `escalation-chain.test.ts` | 3-level escalation, timeout handling | Core |
| HITL | `hitl.test.ts` | Tool call classification, confirmation gates | Security |
| Approval Queue | `approval-queue.test.ts` | Adaptive Card flow, timeout, cancellation | Security |
| Audit Trail | `audit-trail.test.ts` | Logging, parameter redaction, bounded collections | Security |
| Reasoning Trace | `reasoning-trace.test.ts` | Trace persistence, query filtering, statistics | Observability |
| OpenAI Config | `openai-config.test.ts` | Model selection, API version handling | Config |
| SnowClient | `snow-client.test.ts` | ServiceNow API client, pagination, error handling | Integration |
| SnowQuery | `snow-query.test.ts` | Query builder, injection prevention | Security |
| Purview DLP | `purview-dlp.test.ts` | Record classification, PII redaction | Security |

### Golden Dataset

20 evaluation scenarios in `digital-worker/eval/` covering:
- Incident triage and escalation
- Change risk assessment and CAB prep
- SLA breach prediction
- Cross-practice correlation
- Multi-worker delegation chains

### Running Tests

```bash
# All digital-worker tests
cd digital-worker && npm test

# All MCP server tests
cd mcp-server && npm test

# Watch mode
cd digital-worker && npm run test:watch

# With coverage
cd digital-worker && npx vitest run --coverage
```

---

## API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/api/health` | Health check with feature flags | Public |
| `GET` | `/api/platform-status` | Comprehensive service status (all integrations) | Public |
| `POST` | `/api/messages` | Teams bot channel (CloudAdapter, Agent 365 SDK) | JWT |
| `POST` | `/api/chat` | Direct API chat (testing/integration) | JWT |
| `POST` | `/api/agent-messages` | Agent-to-Agent (A2A) messages | JWT |
| `POST` | `/api/scheduled` | Scheduled routine trigger (Durable Functions) | `SCHEDULED_SECRET` (HMAC) |
| `GET` | `/api/approvals` | Approval queue summary | Public |
| `POST` | `/api/approvals/callback` | Approval response callback | Public |
| `GET` | `/api/routines` | Scheduled routines status | Public |
| `GET` | `/api/audit` | Audit trail summary | Public |
| `GET` | `/api/memory` | Memory store summary | Public |
| `GET` | `/api/reasoning` | Reasoning traces (filter: conversationId, type, since, limit) | Public |
| `GET` | `/api/workers` | Worker registry (all ITIL 4 workers with tool counts) | Public |
| `POST` | `/api/a2a/message` | A2A protocol message handler | Public |
| `GET` | `/api/a2a/discover` | A2A discovery manifest | Public |
| `POST` | `/api/flows/callback` | Power Automate flow callback | Public |
| `POST` | `/api/tuning/extract` | Extract tuning dataset from resolved tickets | Public |
| `GET` | `/api/tuning/status` | Fine-tuning pipeline status | Public |
| `GET` | `/api/voice/avatar-config` | Avatar config (Entra token, ICE servers, character) | Public |
| `GET` | `/api/voice/status` | Voice feature gate status | Public (raw HTTP) |
| `GET` | `/voice` | Voice client HTML page | Public |
| `GET` | `/mission-control` | Mission Control dashboard | Public |
| `WS` | `/voice-ws` | WebSocket proxy for Voice Live audio streaming | WebSocket |

---

## Infrastructure as Code

### Bicep Modules

| Module | File | Resources |
|--------|------|-----------|
| **Root** | `main.bicep` | ACR, Key Vault, Function App, ACR Pull roles, outputs |
| **Monitoring** | `modules/monitoring.bicep` | Log Analytics Workspace, Application Insights, 5 KQL alert rules |
| **Cognitive Services** | `modules/cognitive-services.bicep` | Azure OpenAI, Content Safety, Speech Service |
| **Data Services** | `modules/data-services.bicep` | Cosmos DB, Redis Cache, Service Bus, AI Search, Storage Account |
| **Container Apps** | `modules/container-apps.bicep` | Container Apps Environment, digital-worker app, mcp-server app |
| **Identity** | `modules/identity.bicep` | 3 User-Assigned Managed Identities, RBAC role assignments |
| **AI Foundry** | `modules/ai-foundry.bicep` | AI Hub, AI Project, OpenAI Connection |

### Deploying from Scratch

```bash
# 1. Create resource group
az group create --name rg-itsm-operations --location eastus

# 2. Deploy infrastructure
az deployment group create \
  --resource-group rg-itsm-operations \
  --template-file infra/main.bicep \
  --parameters infra/main.parameters.json \
  --parameters environmentName=prod \
               snowInstanceUrl=https://your-instance.service-now.com

# 3. Build and push containers
az acr login --name $(az deployment group show -g rg-itsm-operations -n main --query properties.outputs.acrLoginServer.value -o tsv)
docker build -t $(az deployment group show -g rg-itsm-operations -n main --query properties.outputs.acrLoginServer.value -o tsv)/itsm-worker:v1 digital-worker/
docker push $(az deployment group show -g rg-itsm-operations -n main --query properties.outputs.acrLoginServer.value -o tsv)/itsm-worker:v1

# 4. Verify deployment
curl $(az deployment group show -g rg-itsm-operations -n main --query properties.outputs.digitalWorkerUrl.value -o tsv)/api/health
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Run tests (`cd digital-worker && npm test && cd ../mcp-server && npm test`)
4. Run typecheck (`npm run typecheck` in both projects)
5. Run lint (`npm run lint` in both projects)
6. Commit with conventional commits (`feat:`, `fix:`, `docs:`)
7. Open a Pull Request — Foundry Evaluations will run automatically

---

## License

MIT
