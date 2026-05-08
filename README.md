# Alex IT Ops — ITIL 4 Multi-Agent Digital Worker

> An autonomous AI digital employee for IT Service Management. Not a chatbot — a colleague that triages incidents at 3 AM, predicts SLA breaches before they happen, prepares your CAB agenda while you sleep, and learns from every outcome.

![CI](https://img.shields.io/github/actions/workflow/status/robdye/ITSMOperations/ci.yml?label=CI&logo=github)
![Tests](https://img.shields.io/badge/tests-594%20passing-brightgreen)
![Deploy](https://img.shields.io/github/actions/workflow/status/robdye/ITSMOperations/deploy.yml?label=Deploy&logo=microsoft-azure)
![Node](https://img.shields.io/badge/node-20%20%7C%2022-339933?logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## What it is

**Alex IT Ops** is a production-grade *digital worker* — an autonomous AI employee that operates inside an IT Service Management organisation. It works through Microsoft Teams, M365 Copilot, voice channels, and a browser-based mission control. Where a chatbot answers questions, Alex *takes action*: it opens incident bridges, drafts changes, escalates SLA breaches, sends the morning ops briefing, and runs a continuous control loop that observes signals, forecasts trouble, decides whether to act autonomously or seek human approval, and grades its own outcomes.

The system follows **ITIL 4** practice boundaries, applies **NIST 800-53** control families, enforces a **Human-in-the-Loop** policy on every write operation by default, and is built on the **Microsoft Agent 365 + Microsoft Agents SDK** stack so it integrates natively with Microsoft 365.

### Use cases

- **Tier-1 incident response** — auto-triage, ServiceNow CRUD, P1/P2 bridge spin-up, on-call paging
- **Change enablement** — risk scoring, CAB agenda prep, collision detection, post-implementation review
- **SLA stewardship** — breach forecasting, escalation, auto-paging on the on-call rota
- **Knowledge & CMDB hygiene** — KB gap analysis, EOL/EOS asset scans, CMDB completeness audits
- **Operations briefings** — daily standup brief, weekly recurring-incident pattern analysis
- **AI governance** — agent inventory, compliance dashboard, shadow-agent discovery

---

## Architecture

```text
   USER SURFACES
   ┌────────────────────────────────────────────────────────────────────┐
   │  Teams / M365 Copilot   ·   Voice client   ·   Mission Control     │
   └─────────────────────────────────┬──────────────────────────────────┘
                                     │  HTTPS  ·  WebSocket
                                     ▼
   AZURE SUBSCRIPTION (Bicep-managed)
   ┌────────────────────────────────────────────────────────────────────┐
   │  DIGITAL WORKER   Container App · Express · port 3978 · Node 20    │
   │  ─ Runs the 18 specialist workers + autonomous control loop        │
   │  ─ Managed Identity for every Azure call (no static credentials)   │
   └──┬───────────────┬─────────────────┬────────────────────────┬──────┘
      │ OBO           │ MCP/SSE         │ Managed Identity       │ MI
      ▼               ▼                 ▼                        ▼
   ┌──────────┐   ┌────────────┐   ┌──────────────────┐   ┌──────────────┐
   │ Microsoft│   │ ServiceNow │   │ AI services      │   │ Data plane   │
   │ Agent 365│   │ MCP server │   │ ─ Azure OpenAI   │   │ ─ Cosmos DB  │
   │ (OBO +   │   │ port 3002  │   │ ─ Content Safety │   │ ─ Tables     │
   │  tools)  │   │ Node 22    │   │ ─ Speech         │   │ ─ Redis      │
   └────┬─────┘   └─────┬──────┘   │ ─ AI Foundry     │   │ ─ Service Bus│
        │               │          └──────────────────┘   │ ─ AI Search  │
        ▼               ▼                                 └──────────────┘
   M365 MCP        ServiceNow
   + Graph API     REST API
   (fallback)

   SCHEDULED / ORCHESTRATED
   ┌────────────────────────────────────────────────────────────────────┐
   │  Function App  ·  Durable Functions                                │
   │  11 cron timers  ·  orchestrators  ·  SNOW webhooks                │
   │              ─── HMAC ───▶  Worker /api/scheduled                  │
   └────────────────────────────────────────────────────────────────────┘

   PLATFORM
   ┌────────────────────────────────────────────────────────────────────┐
   │  Key Vault  ·  3 User-Assigned Managed Identities  ·  ACR          │
   │  App Insights  ·  Log Analytics + 5 KQL alert rules                │
   └────────────────────────────────────────────────────────────────────┘
```

**Why this shape**

- Two stateless Container Apps + a Function App. The worker scales horizontally; long-running and time-driven work lives in Durable Functions so the worker can be replaced without losing in-flight state.
- **Managed Identity throughout** — no static credentials in the runtime. The only secret in the worker's env is an HMAC for Durable Functions callbacks.
- **OBO over Microsoft Agent 365** for user-attributed M365 actions (the user's mailbox, their calendar). **App-only Graph** as a fallback for autonomous paths (cron, signal router, mission-control buttons) where no `TurnContext` exists.
- All persistent state lives outside compute — Cosmos, Tables, Redis, Service Bus, AI Search.
- Every box is provisioned by [`infra/main.bicep`](infra/main.bicep). Bring-up is one `az deployment group create`.

For deeper detail see [docs/architecture.md](docs/architecture.md).

---

## Quick start (local dev)

**Prerequisites:** Node 20+ (Node 22+ for `mcp-server`), Docker, Azure CLI, a ServiceNow instance with REST API access.

```bash
# 1. Clone and install
git clone https://github.com/robdye/ITSMOperations.git
cd ITSMOperations

cd digital-worker && npm install && cd ..
cd mcp-server     && npm install && cd ..
cd functions      && npm install && cd ..

# 2. Configure environment
cp env/.env.dev digital-worker/.env       # template lives in env/
cp mcp-server/.env.example mcp-server/.env
# Edit both files with your Azure / ServiceNow values
# (see "Environment variables" below — all secrets default to safe placeholders)

# 3. Verify the build
cd digital-worker && npm test && npx tsc --noEmit && cd ..
cd mcp-server     && npm test && npx tsc --noEmit && cd ..

# 4. Run the two services (separate terminals)
cd mcp-server     && npm run dev      # http://localhost:3002
cd digital-worker && npm run dev      # http://localhost:3978

# 5. Hit it
curl http://localhost:3978/api/health
open http://localhost:3978/mission-control
```

---

## Deploying to Azure

The whole stack is Bicep-managed and CI-driven. Two paths:

### Option A — `azd` / direct Bicep (one-shot bring-up)

```bash
az login
az group create -n rg-itsm-operations -l eastus

az deployment group create \
  -g rg-itsm-operations \
  --template-file infra/main.bicep \
  --parameters infra/main.parameters.json \
  --parameters environmentName=prod \
               snowInstanceUrl=https://<your-instance>.service-now.com \
               agentAppId=<entra-app-id>
```

This creates ~29 resources across two resource groups (digital-worker in `rg-portfolio-agent`, MCP servers in `rg-itsm-operations`). Module breakdown is in [docs/production-readiness.md](docs/production-readiness.md).

### Option B — GitHub Actions (continuous deploy)

Push to `master` → CI runs typecheck + tests on all three packages → deploy.yml builds and pushes Docker images, tagged `<git-sha7>`, then `az containerapp update`s both apps.

GitHub secrets needed: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (for OIDC), plus the variables `ACR_NAME`, `ACR_LOGIN_SERVER`, `MCP_ACR_NAME`, `MCP_ACR_LOGIN_SERVER`, `AZURE_RESOURCE_GROUP`, `MCP_RESOURCE_GROUP`, `DW_CONTAINER_APP_NAME`, `MCP_CONTAINER_APP_NAME`. See [.github/workflows/deploy.yml](.github/workflows/deploy.yml).

After deploy, hit `/api/health` — it returns the running build SHA so you can confirm which commit is live.

---

## Repository layout

```
ITSMOperations/
├── digital-worker/         # Main agent service (Express, port 3978, Node 20)
├── mcp-server/             # ServiceNow MCP server (Express + SSE, port 3002, Node 22)
├── mcp-server-enrichment/  # Free-API enrichment MCP (holidays, weather, etc.)
├── functions/              # Azure Functions — Durable timers + orchestrators
├── cowork-skills/          # 18 ITIL-4 + governance skill packs (one per worker)
├── appPackage/             # Teams / M365 Copilot Declarative Agent manifest
├── infra/                  # Bicep IaC (9 modules, ~29 resources)
├── .github/workflows/      # CI, deploy, Foundry evals
├── docs/                   # Deep-dive documentation (see below)
└── scripts/                # Operational scripts (validation, smoke, M365 sideload)
```

---

## Documentation

The README is the landing page. Deep details live in dedicated documents:

| Document | Covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Logical view, ITIL practice → worker mapping, NIST 800-53 control matrix |
| [docs/voice.md](docs/voice.md) | ACS bridge, Realtime / Voice Live transports, intent classification, KPIs |
| [docs/case-management.md](docs/case-management.md) | Case lifecycle, Cosmos schema, reminders, NIST AU/AC mapping |
| [docs/a2a.md](docs/a2a.md) | Agent-to-agent inbound policy, scopes, audit trail, runbook |
| [docs/enrichment.md](docs/enrichment.md) | Free-API enrichment MCP — holiday, weather, public-status |
| [docs/observability.md](docs/observability.md) | OpenTelemetry spans, KQL alerts, reasoning traces |
| [docs/coverage.md](docs/coverage.md) | Per-module test coverage and thresholds |
| [docs/production-readiness.md](docs/production-readiness.md) | Health envelope, secret-resolver audit, Bicep audit, gaps |
| [docs/README-full.md](docs/README-full.md) | The original long-form README — capability index, every config knob, every API endpoint |

For the demo flow see [DEMO-SCRIPT.md](DEMO-SCRIPT.md).

---

## Tech stack

| Layer | What |
|---|---|
| Practice model | **ITIL 4** — 13 service-management practices |
| Security controls | **NIST 800-53** rev 5 — AC, AU, IA, SC, SI families |
| Agent runtime | **Microsoft Agents SDK** (`@microsoft/agents-hosting`) |
| Agent platform | **Microsoft Agent 365** — OBO + MCP gateway |
| Tool calling | **OpenAI Agents SDK** + **Model Context Protocol** |
| LLM access | **Azure OpenAI** — GPT-4o (reasoning) + o4-mini (routing) via Managed Identity |
| Telemetry | **OpenTelemetry** + GenAI semantic conventions |
| Observability | **App Insights** + **Log Analytics** + 5 KQL alert rules |
| Safety | **Azure AI Content Safety** prompt shields |
| Data governance | **Microsoft Purview** DLP — auto PII redaction |
| UX surfaces | **Adaptive Cards 1.6**, **Skybridge widgets**, **Fluent UI v9** |
| Infrastructure | **Bicep / Azure Verified Modules** |
| CI/CD | **GitHub Actions** — OIDC to Azure |

---

## Testing

```bash
cd digital-worker     && npm test                   # 399 tests
cd mcp-server         && npm test                   # 176 tests
cd mcp-server-enrichment && npm test                # 19 tests

# With coverage
cd digital-worker && npx vitest run --coverage
```

594 tests across 53 files run on every push. Coverage thresholds are enforced per package — see [docs/coverage.md](docs/coverage.md).

---

## Environment variables

The most important ones — the full list (~50 vars across all subsystems) lives in [docs/README-full.md](docs/README-full.md#environment-variables); a starter template is in [env/.env.dev](env/.env.dev):

| Var | Required | Notes |
|---|---|---|
| `AGENT_APP_ID` | yes | Entra app registration for the worker |
| `AZURE_OPENAI_ENDPOINT` | yes | `https://<resource>.openai.azure.com` |
| `AZURE_OPENAI_DEPLOYMENT_GPT4O` | yes | Reasoning model deployment name |
| `SNOW_INSTANCE` | yes | `https://<instance>.service-now.com` |
| `SNOW_CLIENT_ID` / `SNOW_CLIENT_SECRET` | yes | ServiceNow OAuth — managed via Key Vault in prod |
| `KEY_VAULT_NAME` | yes | Worker resolves all secrets from here at startup |
| `COSMOS_ENDPOINT` | yes | Case + memory store |
| `SCHEDULED_SECRET` | yes | HMAC for Durable Functions → worker callbacks |
| `CONTENT_SAFETY_ENDPOINT` | recommended | Prompt-shield endpoint |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | recommended | OTel exporter |

In production these are sourced from Key Vault — never literal values. See [docs/production-readiness.md](docs/production-readiness.md) for the full secret-resolver map.

---

## Contributing

```bash
git checkout -b feat/my-feature

# Verify before pushing
cd digital-worker && npm test && npm run lint && npx tsc --noEmit
cd ../mcp-server && npm test && npx tsc --noEmit
```

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`). Open a PR — CI must be green.

---

## License

MIT — see badge above. (Add a `LICENSE` file at repo root before public release.)
