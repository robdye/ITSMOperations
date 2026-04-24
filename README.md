# ITSM Operations — ITIL 4 Multi-Agent Digital Worker

An autonomous IT Operations platform built on **Microsoft 365 Agents SDK** and **OpenAI Agents SDK**, structured as a hierarchical multi-agent system aligned to **ITIL 4** practices. Deployed as a Microsoft Teams Copilot agent with full ServiceNow integration.

## Architecture

```
┌─────────────────────────────────────────────────┐
│           ITOps Command Center                  │
│       (Orchestrator / Parent Agent)             │
├─────────┬─────────┬─────────┬───────────────────┤
│  Tier 1 │  Tier 1 │  Tier 1 │  Tier 1           │
│Incident │ Change  │ Problem │ Asset/CMDB        │
│ Manager │ Manager │ Manager │ Manager           │
├─────────┼─────────┼─────────┼───────────────────┤
│  Tier 1 │  Tier 1 │  Tier 1 │                   │
│   SLA   │Knowledge│ Vendor  │                   │
│ Manager │ Manager │ Manager │                   │
├─────────┼─────────┼─────────┼───────────────────┤
│  Tier 2 │  Tier 2 │  Tier 2 │                   │
│ Service │Monitoring│Release │                   │
│  Desk   │ Manager │ Manager │                   │
├─────────┼─────────┼─────────┼───────────────────┤
│  Tier 3 │  Tier 3 │  Tier 3 │                   │
│Capacity │Continuity│Security│                   │
│ Manager │ Manager │ Manager │                   │
└─────────┴─────────┴─────────┴───────────────────┘
```

**13 specialist workers**, each with scoped tools and ITIL 4-aligned instructions, managed by a Command Center orchestrator.

## Key Capabilities

| Capability | Description |
|---|---|
| **Worker Delegation** | ITIL chain-of-command routing (e.g., Monitoring → Incident → Problem → Change → Release) |
| **Escalation Chain** | 3-level escalation: Worker retry → Command Center → Human |
| **Scheduled Routines** | 11 autonomous cron jobs (SLA predictions, stale ticket detection, shift handover) |
| **Approval Queue** | Adaptive Card approval/rejection for write/notify operations |
| **Audit Trail** | Azure Table Storage logging with sensitive parameter redaction |
| **HITL Controls** | Tool calls classified as read/write/notify with confirmation gates |
| **ServiceNow CRUD** | Full create/read/update for incidents, changes, problems, assets, knowledge, vendors, contracts |
| **M365 Integration** | Email, calendar, Teams, SharePoint, OneDrive via WorkIQ |

## Project Structure

```
ITSMOperations/
├── appPackage/              # Teams manifest, declarative agent, instructions
├── cowork-skills/           # 13 worker skill directories (SKILL.md + references)
├── digital-worker/          # Main agent (Express server, port 3978)
│   └── src/
│       ├── agent.ts         # Teams message handler + worker routing
│       ├── agent-harness.ts # Worker factory (creates scoped Agent instances)
│       ├── worker-definitions.ts   # 14 ITIL 4 worker definitions
│       ├── worker-registry.ts      # Intent classifier (keyword scoring)
│       ├── worker-delegation.ts    # ITIL chain-of-command delegation
│       ├── escalation-chain.ts     # 3-level escalation engine
│       ├── approval-queue.ts       # Adaptive Card approval flow
│       ├── scheduled-routines.ts   # 11 cron-based autonomous routines
│       ├── audit-trail.ts          # Azure Table Storage audit logging
│       ├── memory-store.ts         # Tiered memory persistence
│       ├── hitl.ts                 # Human-in-the-loop classification
│       ├── tools/                  # Domain-specific tool sets
│       └── __tests__/              # 60 unit tests
├── mcp-server/              # ServiceNow MCP server (Express, port 3002)
│   └── src/
│       ├── snow-client.ts   # ServiceNow REST API client
│       ├── mcp-server.ts    # MCP tool registrations
│       └── __tests__/       # 12 unit tests
├── .github/workflows/       # CI/CD pipelines
│   ├── ci.yml               # Lint + typecheck + test + Docker build
│   └── deploy.yml           # ACR push + Container Apps deploy
└── env/                     # Environment configuration
```

## Prerequisites

- **Node.js** 20+ (digital-worker) / 22+ (mcp-server)
- **ServiceNow** instance with REST API access
- **Azure** subscription (Container Apps, ACR, optionally Table Storage)
- **Microsoft 365** tenant with Teams Toolkit
- **OpenAI API** key

## Quick Start

```bash
# Clone
git clone <repo-url> && cd ITSMOperations

# Install dependencies
cd digital-worker && npm install
cd ../mcp-server && npm install

# Configure environment
cp env/.env.dev env/.env.dev.user
# Edit env/.env.dev.user with your actual values

# Run tests
cd digital-worker && npm test    # 60 tests
cd ../mcp-server && npm test     # 12 tests

# Start locally
cd digital-worker && npm run dev
cd ../mcp-server && npm run dev
```

## Environment Variables

| Variable | Service | Description |
|----------|---------|-------------|
| `SNOW_INSTANCE` | MCP Server | ServiceNow instance URL |
| `SNOW_USER` | MCP Server | ServiceNow API username |
| `SNOW_PASSWORD` | MCP Server | ServiceNow API password |
| `OPENAI_API_KEY` | Digital Worker | OpenAI API key |
| `CHANGE_MCP_ENDPOINT` | Digital Worker | MCP server URL |
| `AZURE_STORAGE_CONNECTION_STRING` | Digital Worker | For audit trail (optional, falls back to in-memory) |
| `GRAPH_APP_ID` | Digital Worker | Azure AD app for Graph API (email/Teams) |
| `GRAPH_APP_SECRET` | Digital Worker | Azure AD app secret |
| `SCHEDULED_SECRET` | Digital Worker | Auth secret for `/api/scheduled` endpoint |
| `TEAMS_APP_ID` | Teams Toolkit | Teams app registration ID |
| `TEAMS_APP_TENANT_ID` | Teams Toolkit | Azure AD tenant ID |

## CI/CD

### CI (`.github/workflows/ci.yml`)
Runs on every push and PR to `main`:
- **Digital Worker**: Node 20 → lint → typecheck → test → Docker build
- **MCP Server**: Node 22 → lint → typecheck → test → Docker build
- **App Package**: Teams manifest schema validation

### CD (`.github/workflows/deploy.yml`)
Runs on push to `main` after CI passes:
1. Build & push Docker images to Azure Container Registry (tagged by commit SHA)
2. `az containerapp update --image` for both services
3. Post-deploy health checks
4. Teams app package update (dev environment)

### GitHub Secrets Required
- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (OIDC auth)
- `ACR_NAME`, `ACR_LOGIN_SERVER` (repository variables)
- `AZURE_RESOURCE_GROUP`, `DW_CONTAINER_APP_NAME`, `MCP_CONTAINER_APP_NAME` (repository variables)

## ITIL 4 Worker Mapping

| Worker | ITIL 4 Practice | Tier |
|--------|----------------|------|
| Incident Manager | Incident Management | 1 |
| Change Manager | Change Enablement | 1 |
| Problem Manager | Problem Management | 1 |
| Asset/CMDB Manager | IT Asset / Configuration Management | 1 |
| SLA Manager | Service Level Management | 1 |
| Knowledge Manager | Knowledge Management | 1 |
| Vendor Manager | Supplier Management | 1 |
| Service Desk Manager | Service Desk | 2 |
| Monitoring Manager | Monitoring & Event Management | 2 |
| Release Manager | Release Management | 2 |
| Capacity Manager | Capacity & Performance Management | 3 |
| Continuity Manager | Service Continuity Management | 3 |
| Security Manager | Information Security Management | 3 |

## Security

- **Input sanitization**: ServiceNow query injection prevention (`sanitizeSnowValue`), OData filter injection prevention
- **HITL classification**: All tool calls classified as read/write/notify with confirmation gates for mutations
- **Audit redaction**: Recursive sanitization of sensitive parameters (passwords, tokens, API keys) before logging
- **Timing-safe auth**: `crypto.timingSafeEqual` for scheduled endpoint authentication
- **Bounded collections**: All in-memory maps/arrays have size caps with FIFO eviction

## License

MIT
