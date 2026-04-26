# 🏢 ITSM Operations — ITIL 4 Multi-Agent Digital Worker

> **Alex IT Ops** — an autonomous digital employee that manages IT Service Management operations across 18 specialist workers, 29 Azure services, and full ServiceNow integration. Not a chatbot — a digital colleague that triages incidents at 3 AM, predicts SLA breaches before they happen, and prepares your CAB agenda while you sleep.

![CI](https://img.shields.io/github/actions/workflow/status/ABS-Corp/ITSMOperations/ci.yml?label=CI&logo=github)
![Tests](https://img.shields.io/badge/tests-94%2B%20passing-brightgreen)
![Deploy](https://img.shields.io/github/actions/workflow/status/ABS-Corp/ITSMOperations/deploy.yml?label=Deploy&logo=microsoft-azure)
![Node](https://img.shields.io/badge/node-20%20%7C%2022-339933?logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Executive Summary

ITSM Operations is a **production-grade digital worker** — not a chatbot, not a copilot extension, but a fully autonomous AI employee that operates within your IT Service Management organization. It follows ITIL 4 practices, enforces NIST 800-53 security controls, and integrates directly with ServiceNow, Microsoft 365, and Azure.

| Metric | Count |
|--------|-------|
| **Specialist Workers** | 18 (13 ITIL + 5 AI Governance) |
| **DA Skills** | 22 Copilot Cowork Skills |
| **DA Plugins** | 8 domain API plugins |
| **DA Capabilities** | 11 (WebSearch, Memory, GraphConnectors, etc.) |
| **Knowledge Sources** | 4 (Graph Connector, SharePoint, AI Search, Microsoft Learn) |
| **Widgets** | 18 (12 Skybridge read-only + 6 interactive) |
| **Adaptive Cards** | 4 (change-form, cab-voting, incident-escalation, approval) |
| **Scheduled Routines** | 18 autonomous jobs |
| **Azure Resources** | 29 services (IaC via Bicep) |
| **Managed Identities** | 3 Entra (incident-manager, change-manager, security-manager) |
| **Unit Tests** | 94+ (digital-worker) + 33+ (mcp-server) |
| **Durable Function Orchestrators** | 3 (major-incident-bridge, change-rollback, cab-voting-cycle) |
| **Timer Triggers** | 11 (Azure Durable Functions) |
| **Service Bus Topics** | 5 (incident, change, problem, SLA, notification) |
| **Localization** | en-US, fr-FR, es-ES, ja-JP |

**Core Frameworks**: Microsoft Agents SDK (`@microsoft/agents-hosting` v1.2), OpenAI Agents SDK (`@openai/agents` v0.1), Model Context Protocol (`@modelcontextprotocol/sdk` v1.12), ITIL 4, NIST 800-53.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                            M365 Copilot / Teams / Voice                               │
│                     (Declarative Agent: 22 skills, 8 plugins, 11 capabilities)        │
└─────────────────────────────────────┬─────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────▼─────────────────────┐
                    │       ITOps Command Center            │
                    │   (Orchestrator / Parent Agent)       │
                    │   agent.ts → agent-harness.ts         │
                    │   worker-registry + escalation-chain  │
                    └─────┬───────────┬───────────┬─────────┘
                          │           │           │
         ┌────────────────▼──┐  ┌─────▼─────┐  ┌─▼──────────────────┐
         │     Tier 1: Core  │  │  Tier 2:   │  │    Tier 3:         │
         │  ┌──────────────┐ │  │  Extended  │  │    Strategic       │
         │  │ Incident Mgr │ │  │┌──────────┐│  │ ┌───────────────┐  │
         │  │ Change Mgr   │ │  ││Service   ││  │ │ Capacity Mgr  │  │
         │  │ Problem Mgr  │ │  ││Desk Mgr  ││  │ │ Continuity Mgr│  │
         │  │ Asset/CMDB   │ │  ││Monitoring││  │ │ Security Mgr  │  │
         │  │ SLA Mgr      │ │  ││Mgr       ││  │ └───────────────┘  │
         │  │ Knowledge Mgr│ │  ││Release   ││  │                    │
         │  │ Vendor Mgr   │ │  ││Mgr       ││  │  AI Governance     │
         │  └──────────────┘ │  │└──────────┘│  │ ┌───────────────┐  │
         └───────────────────┘  └────────────┘  │ │ Agent Change  │  │
                                                │ │ Agent Compli. │  │
                                                │ │ Agent Invent. │  │
                                                │ │ Agent Ownersh.│  │
                                                │ │ Shadow Discov.│  │
                                                │ └───────────────┘  │
                                                └────────────────────┘
                          │                           │
         ┌────────────────▼───────────────────────────▼─────────────────┐
         │                    MCP Server (port 3002)                    │
         │  snow-client.ts → ServiceNow REST API (CRUD)                │
         │  eol-client.ts → endoflife.date API                         │
         │  azure-monitor.ts → Azure Monitor Metrics                   │
         │  search-client.ts → Azure AI Search (hybrid + vector)       │
         │  purview-dlp.ts → Purview DLP classification + PII redact   │
         │  snow-auth.ts → OAuth OBO for ServiceNow                    │
         │  18 Skybridge widgets (Fluent v9, dark mode, accessible)    │
         └──────────────────────────┬──────────────────────────────────┘
                                    │
         ┌──────────────────────────▼──────────────────────────────────┐
         │                    Azure Services Layer                     │
         │                                                             │
         │  Cosmos DB          Redis Cache        Service Bus          │
         │  (state, traces)    (session cache)    (5 pub/sub topics)   │
         │                                                             │
         │  AI Search          OpenAI (GPT-4o)    Content Safety       │
         │  (vector + hybrid)  (reasoning: o4-mini)(prompt shields)    │
         │                                                             │
         │  Key Vault          Speech Avatar      App Insights         │
         │  (secrets)          (Lisa/Ava voice)   (OTel + KQL alerts)  │
         │                                                             │
         │  Container Apps     ACR                Function App         │
         │  (2 containers)     (image registry)   (Durable Functions)  │
         │                                                             │
         │  AI Foundry         APIM Gateway       Log Analytics        │
         │  (hub + project)    (rate limiting)     (workspace)          │
         └─────────────────────────────────────────────────────────────┘
                                    │
         ┌──────────────────────────▼──────────────────────────────────┐
         │                    M365 Integration Layer                   │
         │                                                             │
         │  Graph Mail (send/read)     Teams Approvals (Universal Act) │
         │  Planner (task tracking)    SharePoint (doc library)        │
         │  Graph Connectors (KB)      Power Automate (4 flows)        │
         │  Teams Channels (bridges)   Copilot Connectors (SN, ADO)   │
         └─────────────────────────────────────────────────────────────┘
```

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
│   │   │   ├── mcp-client.ts                # MCP client for ServiceNow MCP Server
│   │   │   ├── memory-store.ts              # Tiered memory persistence (Redis → Cosmos → in-memory)
│   │   │   ├── conversation-memory.ts       # Conversation-scoped memory management
│   │   │   ├── reasoning-rca.ts             # Automated root cause analysis engine
│   │   │   ├── adaptive-cards.ts            # Adaptive Card 1.6 templates (4 card types)
│   │   │   ├── doc-generator.ts             # Document generation (PIR reports, CAB packs)
│   │   │   └── email-service.ts             # Email composition and delivery
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
│   │   └── [Tests]
│   │       ├── __tests__/approval-queue.test.ts
│   │       ├── __tests__/audit-trail.test.ts
│   │       ├── __tests__/escalation-chain.test.ts
│   │       ├── __tests__/hitl.test.ts
│   │       ├── __tests__/openai-config.test.ts
│   │       ├── __tests__/reasoning-trace.test.ts
│   │       ├── __tests__/worker-delegation.test.ts
│   │       └── __tests__/worker-registry.test.ts
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

## Key Capabilities

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
cd digital-worker && npm test       # 94+ tests
cd ../mcp-server && npm test        # 33+ tests

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
