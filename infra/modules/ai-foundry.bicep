// ──────────────────────────────────────────────────────────────
// AI Foundry Module – Hub + Project + OpenAI Connection
// ──────────────────────────────────────────────────────────────

@description('Environment name used in resource naming')
param environmentName string

@description('Azure region')
param location string

@description('Tags applied to every resource')
param tags object

@description('Storage Account ID for AI Foundry backing storage')
param storageAccountId string

@description('Key Vault ID for AI Foundry secrets')
param keyVaultId string

@description('Application Insights ID for AI Foundry telemetry')
param appInsightsId string

@description('Azure OpenAI resource ID to connect')
param openaiResourceId string

@description('Azure OpenAI endpoint URL')
param openaiEndpoint string

// ── AI Foundry Hub (workspace kind = Hub) ───────────────────
resource aiHub 'Microsoft.MachineLearningServices/workspaces@2024-10-01' = {
  name: 'itsm-ops-${environmentName}-hub'
  location: location
  tags: tags
  kind: 'Hub'
  sku: {
    name: 'Basic'
    tier: 'Basic'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    friendlyName: 'ITSM Operations AI Hub'
    description: 'AI Foundry Hub for ITSM Operations Digital Worker'
    storageAccount: storageAccountId
    keyVault: keyVaultId
    applicationInsights: appInsightsId
    publicNetworkAccess: 'Enabled'
  }
}

// ── AI Foundry Project (workspace kind = Project) ───────────
resource aiProject 'Microsoft.MachineLearningServices/workspaces@2024-10-01' = {
  name: 'itsm-ops-${environmentName}-project'
  location: location
  tags: tags
  kind: 'Project'
  sku: {
    name: 'Basic'
    tier: 'Basic'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    friendlyName: 'ITSM Operations AI Project'
    description: 'AI Foundry Project for agent development and evaluation'
    hubResourceId: aiHub.id
    publicNetworkAccess: 'Enabled'
  }
}

// ── OpenAI Connection (links Azure OpenAI to the Hub) ───────
resource openaiConnection 'Microsoft.MachineLearningServices/workspaces/connections@2024-10-01' = {
  parent: aiHub
  name: 'itsm-openai-connection'
  properties: {
    category: 'AzureOpenAI'
    authType: 'AAD'
    isSharedToAll: true
    target: openaiEndpoint
    metadata: {
      ApiType: 'Azure'
      ResourceId: openaiResourceId
    }
  }
}

// ── Outputs ─────────────────────────────────────────────────
output aiHubId string = aiHub.id
output aiHubName string = aiHub.name
output aiProjectId string = aiProject.id
output aiProjectName string = aiProject.name
