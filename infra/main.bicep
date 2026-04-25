// ──────────────────────────────────────────────────────────────
// ITSM Operations Digital Worker – Main Bicep Orchestration
// Deploys ALL Azure infrastructure for the ITSM Operations platform
// ──────────────────────────────────────────────────────────────

targetScope = 'resourceGroup'

// ── Parameters ──────────────────────────────────────────────

@description('Environment name (used as suffix for all resource names)')
param environmentName string

@description('Azure region for resource deployment')
param location string = resourceGroup().location

@description('ServiceNow instance URL for MCP Server integration')
param snowInstanceUrl string

@description('Agent Blueprint App ID (Microsoft Entra application)')
param agentAppId string = '871592dc-ffa9-42d0-aa31-46a679817d26'

@description('ServiceNow client secret (stored in Key Vault)')
@secure()
param snowClientSecret string = ''

@description('ServiceNow basic auth password (stored in Key Vault)')
@secure()
param snowPassword string = ''

// ── Tags ────────────────────────────────────────────────────
var tags = {
  project: 'itsm-operations'
  environment: environmentName
}

// ── Derived resource names (used for existing refs) ─────────
var logAnalyticsName = 'itsm-ops-${environmentName}-law'
var storageAccountName = 'itsmops${environmentName}st'

// ──────────────────────────────────────────────────────────────
// 1. Container Registry (ACR)
// ──────────────────────────────────────────────────────────────
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: 'itsmops${environmentName}acr'
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

// ──────────────────────────────────────────────────────────────
// 2. Key Vault (secrets store for the platform)
// ──────────────────────────────────────────────────────────────
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'itsm-ops-${environmentName}-kv'
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      name: 'standard'
      family: 'A'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: true
  }
}

// Placeholder secrets (values supplied at deployment time)
resource secretSnowClientSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(snowClientSecret)) {
  parent: keyVault
  name: 'snow-client-secret'
  properties: {
    value: snowClientSecret
  }
}

resource secretSnowPassword 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(snowPassword)) {
  parent: keyVault
  name: 'snow-password'
  properties: {
    value: snowPassword
  }
}

// ──────────────────────────────────────────────────────────────
// 3. Monitoring (Log Analytics + App Insights + KQL Alerts)
// ──────────────────────────────────────────────────────────────
module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring-deployment'
  params: {
    environmentName: environmentName
    location: location
    tags: tags
  }
}

// ──────────────────────────────────────────────────────────────
// 4. Cognitive Services (OpenAI + Content Safety + Speech)
// ──────────────────────────────────────────────────────────────
module cognitiveServices 'modules/cognitive-services.bicep' = {
  name: 'cognitive-services-deployment'
  params: {
    environmentName: environmentName
    location: location
    tags: tags
  }
}

// ──────────────────────────────────────────────────────────────
// 5. Data Services (Cosmos DB + Redis + Service Bus + AI Search + Storage)
// ──────────────────────────────────────────────────────────────
module dataServices 'modules/data-services.bicep' = {
  name: 'data-services-deployment'
  params: {
    environmentName: environmentName
    location: location
    tags: tags
  }
}

// Reference the Log Analytics workspace to retrieve shared key
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsName
  dependsOn: [
    monitoring
  ]
}

// Reference storage account for Function App connection string
resource storageAccountRef 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
  dependsOn: [
    dataServices
  ]
}

// ──────────────────────────────────────────────────────────────
// 6. Container Apps (Environment + Digital Worker + MCP Server)
// ──────────────────────────────────────────────────────────────
module containerApps 'modules/container-apps.bicep' = {
  name: 'container-apps-deployment'
  params: {
    environmentName: environmentName
    location: location
    tags: tags
    logAnalyticsCustomerId: monitoring.outputs.logAnalyticsCustomerId
    logAnalyticsSharedKey: logAnalyticsWorkspace.listKeys().primarySharedKey
    acrLoginServer: acr.properties.loginServer
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    openaiEndpoint: cognitiveServices.outputs.openaiEndpoint
    cosmosEndpoint: dataServices.outputs.cosmosEndpoint
    redisHostName: dataServices.outputs.redisHostName
    serviceBusEndpoint: dataServices.outputs.serviceBusEndpoint
    keyVaultName: keyVault.name
    contentSafetyEndpoint: cognitiveServices.outputs.contentSafetyEndpoint
    speechEndpoint: cognitiveServices.outputs.speechEndpoint
    speechRegion: cognitiveServices.outputs.speechRegion
    snowInstanceUrl: snowInstanceUrl
    aiSearchEndpoint: dataServices.outputs.aiSearchEndpoint
    agentAppId: agentAppId
  }
}

// ──────────────────────────────────────────────────────────────
// 7. Function App (Consumption, Linux, Node 20)
// ──────────────────────────────────────────────────────────────
resource functionAppPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'itsm-ops-${environmentName}-plan'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true // Linux
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: 'itsm-ops-${environmentName}-func'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: functionAppPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Node|20'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccountName};EndpointSuffix=${az.environment().suffixes.storage};AccountKey=${storageAccountRef.listKeys().keys[0].value}'
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~20'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: monitoring.outputs.appInsightsConnectionString
        }
        {
          name: 'COSMOS_ENDPOINT'
          value: dataServices.outputs.cosmosEndpoint
        }
        {
          name: 'SERVICE_BUS_ENDPOINT'
          value: dataServices.outputs.serviceBusEndpoint
        }
      ]
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 8. AI Foundry (Hub + Project + OpenAI Connection)
// ──────────────────────────────────────────────────────────────
module aiFoundry 'modules/ai-foundry.bicep' = {
  name: 'ai-foundry-deployment'
  params: {
    environmentName: environmentName
    location: location
    tags: tags
    storageAccountId: dataServices.outputs.storageAccountId
    keyVaultId: keyVault.id
    appInsightsId: monitoring.outputs.appInsightsId
    openaiResourceId: cognitiveServices.outputs.openaiId
    openaiEndpoint: cognitiveServices.outputs.openaiEndpoint
  }
}

// ──────────────────────────────────────────────────────────────
// 9. Identity (User-Assigned MIs + RBAC Role Assignments)
// ──────────────────────────────────────────────────────────────
module identity 'modules/identity.bicep' = {
  name: 'identity-deployment'
  params: {
    environmentName: environmentName
    location: location
    tags: tags
    digitalWorkerPrincipalId: containerApps.outputs.digitalWorkerPrincipalId
    keyVaultId: keyVault.id
    openaiId: cognitiveServices.outputs.openaiId
    contentSafetyId: cognitiveServices.outputs.contentSafetyId
    speechId: cognitiveServices.outputs.speechId
    cosmosAccountId: dataServices.outputs.cosmosAccountId
    serviceBusId: dataServices.outputs.serviceBusId
  }
}

// ── ACR Pull rolefor Digital Worker & MCP Server system MIs ─
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource acrPullWorker 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, 'digital-worker', acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: containerApps.outputs.digitalWorkerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource acrPullMcp 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, 'mcp-server', acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: containerApps.outputs.mcpServerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ──────────────────────────────────────────────────────────────
// Outputs
// ──────────────────────────────────────────────────────────────

// Container Apps
output digitalWorkerUrl string = 'https://${containerApps.outputs.digitalWorkerFqdn}'
output mcpServerUrl string = 'https://${containerApps.outputs.mcpServerFqdn}'
output containerAppsEnvironment string = containerApps.outputs.containerAppsEnvName

// Container Registry
output acrLoginServer string = acr.properties.loginServer

// Cognitive Services
output openaiEndpoint string = cognitiveServices.outputs.openaiEndpoint
output contentSafetyEndpoint string = cognitiveServices.outputs.contentSafetyEndpoint
output speechEndpoint string = cognitiveServices.outputs.speechEndpoint

// Data Services
output cosmosEndpoint string = dataServices.outputs.cosmosEndpoint
output redisHostName string = dataServices.outputs.redisHostName
output serviceBusEndpoint string = dataServices.outputs.serviceBusEndpoint
output aiSearchEndpoint string = dataServices.outputs.aiSearchEndpoint

// Monitoring
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
output logAnalyticsWorkspaceId string = monitoring.outputs.logAnalyticsWorkspaceId

// Key Vault
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri

// Function App
output functionAppUrl string = 'https://${functionApp.properties.defaultHostName}'

// AI Foundry
output aiHubName string = aiFoundry.outputs.aiHubName
output aiProjectName string = aiFoundry.outputs.aiProjectName

// Managed Identities
output incidentManagerPrincipalId string = identity.outputs.incidentManagerPrincipalId
output changeManagerPrincipalId string = identity.outputs.changeManagerPrincipalId
output securityManagerPrincipalId string = identity.outputs.securityManagerPrincipalId
