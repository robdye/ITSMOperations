# Production readiness audit

This page captures the audits the gap-closure pass ran against the
production code path. Run as part of Phase 5 of the build prompt.

## Health endpoint

`GET /api/health` on the digital-worker returns 200 with the following
payload (snapshot from local run; production carries non-`dev` SHA):

```json
{
  "status": "healthy",
  "agent": "ITSM Operations Digital Worker",
  "timestamp": "2025-...Z",
  "uptimeMs": 1234,
  "build": {
    "sha": "<full GitHub SHA from CI>",
    "shaShort": "<first 7 chars>",
    "builtAt": "2025-...Z"
  },
  "voiceEnabled": true,
  "features": {
    "architecture": "multi-agent",
    "workers": 13,
    "tiers": ["core", "extended", "strategic"],
    "shiftHandover": true,
    "incidentMonitoring": true,
    "slaPrediction": true,
    "changeCorrelation": true,
    "voice": true,
    "hitlControls": true
  }
}
```

The build SHA is set at container build time via the `GIT_COMMIT_SHA`
and `BUILD_TIMESTAMP` Docker build args. CI's
`.github/workflows/deploy.yml` passes them in:

```yaml
docker build \
  --build-arg GIT_COMMIT_SHA=${{ env.DEPLOY_SHA }} \
  --build-arg BUILD_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  -t <tag> digital-worker/
```

For local dev runs `sha` falls back to `"dev"`.

## Secret resolver audit

`digital-worker/src/secret-resolver.ts` resolves Key Vault secrets at
container startup and writes them into `process.env`. Direct
`process.env.<X>_KEY` / `_SECRET` reads downstream are reading the
resolved value, not bypassing the resolver.

### Currently resolved by `SECRET_MAP`

| Key Vault secret | Env var(s) populated |
| --- | --- |
| `agent-blueprint-client-secret` | `connections__service_connection__settings__clientSecret`, `agent365Observability__clientSecret` |
| `snow-password` | `SNOW_PASSWORD` |
| `snow-client-secret` | `SNOW_CLIENT_SECRET` |
| `graph-app-secret` | `GRAPH_APP_SECRET` |

### Resolved on-demand via `getSecret()`

Any call site can request a Key Vault value at runtime. The fallback
returns `process.env[name]` if Key Vault isn't wired up (local dev).

### Secrets sourced through runtime secret references

Some services read secrets from environment variables after Container Apps
resolves a protected secret reference. Secret values are not committed as
configuration. Rotation requires a new revision or replica restart.

| Env var | Used by |
| --- | --- |
| `COSMOS_KEY` | `cosmos-store.ts`, `case-manager.ts` |
| `AUDIT_STORAGE_KEY` | `audit-trail.ts`, `anticipatory-store.ts`, `memory-store.ts` |
| `APIM_SUBSCRIPTION_KEY` | `apim-gateway.ts` |
| `CONTENT_SAFETY_KEY` | `content-safety.ts` |
| `FOUNDRY_API_KEY` | `foundry-agents.ts` |
| `AZURE_OPENAI_API_KEY` | `openai-config.ts` |
| `OPENAI_API_KEY` | `openai-config.ts` |
| `SCHEDULED_SECRET` | `index.ts` (scheduler webhook auth) |

The deployment workflow stores Graph and callback credentials as Container
App secrets and exposes only `secretref:` environment entries.

## Bicep module audit

`infra/main.bicep` registers all 9 modules:

| Module | File | Purpose |
| --- | --- | --- |
| `monitoring` | `modules/monitoring.bicep` | Application Insights, Log Analytics, KQL alerts |
| `cognitiveServices` | `modules/cognitive-services.bicep` | Azure OpenAI + Content Safety |
| `dataServices` | `modules/data-services.bicep` | Cosmos, Storage, Key Vault |
| `containerApps` | `modules/container-apps.bicep` | digital-worker + mcp-server Container Apps |
| `mcpEnrichment` | `modules/mcp-enrichment.bicep` | enrichment Container App + ACR pull RBAC |
| `aiFoundry` | `modules/ai-foundry.bicep` | Foundry hub + project for red-team evals |
| `identity` | `modules/identity.bicep` | User-assigned managed identity for digital-worker |
| `foundryRedTeam` | `modules/foundry-redteam.bicep` | AlexTrustScore Storage Table + Storage Table Data Contributor RBAC |
| (inline) ACR pull role | — | mcp-enrichment ACR pull role |

Both Phase 1 / 2 modules called out by the build prompt
(`foundry-redteam.bicep` for the red-team agent, `mcp-enrichment.bicep`
for the enrichment server) are present and wired into the
subscription-scope deployment.

## What runs on every PR

The CI workflow (`.github/workflows/ci.yml`) runs:

1. Installs each component's dependencies
2. Typechecks and tests all three services
3. Builds all three production container images
4. Validates the Teams manifest
5. Tests exact-commit deployment, production Teams targeting, live-source gates, and rollback controls

The deploy workflow (`.github/workflows/deploy.yml`) runs after CI
passes on `master` and:

1. Builds 3 Docker images with `GIT_COMMIT_SHA` + `BUILD_TIMESTAMP`
   build args
2. Pushes to ACR with `:<sha7>` tag
3. Updates 3 Container Apps to the new image tag
4. Verifies Functions registration
5. Requires the expected build SHA, live ServiceNow reads, healthy MCP services, no fallback source, and a rendered Mission Control page

A failed release gate restores all three previous Container App images.

## Known gaps not closed in this pass

- **Secret rotation without restart** — see secret-resolver gap above.
- **`/api/health` does not include dependency states** — a deeper
  variant lives at `/api/platform-status`. Consider folding the
  dependency probe results into `/api/health` for liveness probes.
- **`mcp-server.ts` and `mcp-server-enrichment/server.ts` are
  large** — they dominate per-package coverage numbers.
  See [docs/coverage.md](coverage.md) for the split-up roadmap.
