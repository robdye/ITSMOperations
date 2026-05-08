// ──────────────────────────────────────────────────────────────
// Phase 2.1 — Foundry Red-Team Agent infrastructure
// ──────────────────────────────────────────────────────────────
//
// What this deploys:
//   1. A storage table named `AlexTrustScore` on the existing platform
//      storage account so the digital-worker red-team-agent.ts can write
//      daily 0–100 scores. PartitionKey=tenantId, RowKey=YYYY-MM-DD.
//   2. RBAC: grants the digital-worker user-assigned managed identity the
//      `Storage Table Data Contributor` role on the storage account so it
//      can read/write rolling scores at runtime (no shared keys).
//   3. A Foundry endpoint feature flag passed back as an output that the
//      digital-worker reads as `FOUNDRY_REDTEAM_ENABLED`. The actual probe
//      bank is hard-coded in `red-team-agent.ts` (probe payloads must be
//      reviewable in source control), but the Foundry connection is
//      acquired via the existing AI Foundry module — this module only
//      adds the wiring to enable it.
//
// What this does NOT deploy:
//   The probes themselves (they are TypeScript code, not Foundry assets),
//   and any Foundry "red team agent" service-side resource — those are
//   handled by the existing `ai-foundry.bicep` module's project surface.
//
// Tenant gate:
//   Whether probes actually run is gated client-side on
//   `tenantProfile.allowRedTeam=true`. This module enables the surface;
//   the per-tenant opt-in still controls execution.

targetScope = 'resourceGroup'

@description('Environment name suffix.')
param environmentName string

@description('Existing storage account name (created by data-services module).')
param storageAccountName string

@description('Principal id of the digital-worker user-assigned managed identity.')
param digitalWorkerPrincipalId string

@description('Whether to enable the red-team probe surface. Default false; set to true once the operator is ready to opt the tenant in.')
param enabled bool = false

// ── Storage account & table for AlexTrustScore ──
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource tableSvc 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' existing = {
  parent: storage
  name: 'default'
}

resource trustScoreTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableSvc
  name: 'AlexTrustScore'
}

// ── RBAC: Storage Table Data Contributor ──
// The digital-worker MI uses this to read/write the rolling rollup. No keys.
var storageTableDataContributor = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'

resource trustScoreRbac 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, 'redteam-trustscore', digitalWorkerPrincipalId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageTableDataContributor)
    principalId: digitalWorkerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ── Outputs ──
output trustScoreTableName string = trustScoreTable.name
output redTeamEnabled bool = enabled
output rollupStorageAccount string = storage.name
output environmentLabel string = environmentName
