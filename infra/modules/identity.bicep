// ──────────────────────────────────────────────────────────────
// Identity Module – User-Assigned Managed Identities + RBAC Assignments
// ──────────────────────────────────────────────────────────────

@description('Environment name used in resource naming')
param environmentName string

@description('Azure region')
param location string

@description('Tags applied to every resource')
param tags object

@description('Principal ID of the Digital Worker Container App system MI')
param digitalWorkerPrincipalId string

@description('Key Vault resource ID for role scoping')
param keyVaultId string

@description('Azure OpenAI resource ID for role scoping')
param openaiId string

@description('Content Safety resource ID for role scoping')
param contentSafetyId string

@description('Speech resource ID for role scoping')
param speechId string

@description('Cosmos DB account resource ID for role scoping')
param cosmosAccountId string

@description('Service Bus namespace resource ID for role scoping')
param serviceBusId string

// ── Well-known Azure RBAC role definition IDs ───────────────
var roles = {
  keyVaultSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  cognitiveServicesUser: 'a97b65f3-24c7-4388-baec-2e87135dc908'
  cosmosDbDataContributor: '00000000-0000-0000-0000-000000000002'
  cosmosDbDataReader: '00000000-0000-0000-0000-000000000001'
  serviceBusDataOwner: '090c5cfd-751d-490a-894a-3ce6f1109419'
  monitoringMetricsPublisher: '3913510d-42f4-4e42-8a64-420c390055eb'
}

// ── User-Assigned Managed Identities ────────────────────────

// Incident Manager – handles incident lifecycle operations
resource incidentManagerIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'itsm-ops-${environmentName}-mi-incident'
  location: location
  tags: tags
}

// Change Manager – handles change request workflows
resource changeManagerIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'itsm-ops-${environmentName}-mi-change'
  location: location
  tags: tags
}

// Security Manager – handles security incident triage
resource securityManagerIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'itsm-ops-${environmentName}-mi-security'
  location: location
  tags: tags
}

// ── RBAC Assignments for Digital Worker System MI ────────────

// Key Vault Secrets User – read secrets from Key Vault
resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVaultId, digitalWorkerPrincipalId, roles.keyVaultSecretsUser)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsUser)
    principalId: digitalWorkerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Cognitive Services User on Azure OpenAI
resource openaiCogUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(openaiId, digitalWorkerPrincipalId, roles.cognitiveServicesUser)
  scope: openaiAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.cognitiveServicesUser)
    principalId: digitalWorkerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Cognitive Services User on Content Safety
resource safetyCogUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(contentSafetyId, digitalWorkerPrincipalId, roles.cognitiveServicesUser)
  scope: contentSafetyAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.cognitiveServicesUser)
    principalId: digitalWorkerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Cognitive Services User on Speech Services
resource speechCogUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(speechId, digitalWorkerPrincipalId, roles.cognitiveServicesUser)
  scope: speechAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.cognitiveServicesUser)
    principalId: digitalWorkerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Cosmos DB Built-in Data Contributor
resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: guid(cosmosAccountId, digitalWorkerPrincipalId, roles.cosmosDbDataContributor)
  parent: cosmosAccount
  properties: {
    roleDefinitionId: '${cosmosAccountId}/sqlRoleDefinitions/${roles.cosmosDbDataContributor}'
    principalId: digitalWorkerPrincipalId
    scope: cosmosAccountId
  }
}

// Cosmos DB Built-in Data Reader
resource cosmosDataReader 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  name: guid(cosmosAccountId, digitalWorkerPrincipalId, roles.cosmosDbDataReader)
  parent: cosmosAccount
  properties: {
    roleDefinitionId: '${cosmosAccountId}/sqlRoleDefinitions/${roles.cosmosDbDataReader}'
    principalId: digitalWorkerPrincipalId
    scope: cosmosAccountId
  }
}

// Azure Service Bus Data Owner
resource sbDataOwner 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(serviceBusId, digitalWorkerPrincipalId, roles.serviceBusDataOwner)
  scope: serviceBusNamespace
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.serviceBusDataOwner)
    principalId: digitalWorkerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Monitoring Metrics Publisher (on resource group scope)
resource monitoringPublisher 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, digitalWorkerPrincipalId, roles.monitoringMetricsPublisher)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.monitoringMetricsPublisher)
    principalId: digitalWorkerPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ── Existing resource references for scoping ────────────────
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: 'itsm-ops-${environmentName}-kv'
}

resource openaiAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: 'itsm-ops-${environmentName}-openai'
}

resource contentSafetyAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: 'itsm-ops-${environmentName}-safety'
}

resource speechAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: 'itsm-ops-${environmentName}-speech'
}

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: 'itsm-ops-${environmentName}-cosmos'
}

resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' existing = {
  name: 'itsm-ops-${environmentName}-sb'
}

// ── Outputs ─────────────────────────────────────────────────
output incidentManagerPrincipalId string = incidentManagerIdentity.properties.principalId
output incidentManagerClientId string = incidentManagerIdentity.properties.clientId
output incidentManagerResourceId string = incidentManagerIdentity.id
output changeManagerPrincipalId string = changeManagerIdentity.properties.principalId
output changeManagerClientId string = changeManagerIdentity.properties.clientId
output changeManagerResourceId string = changeManagerIdentity.id
output securityManagerPrincipalId string = securityManagerIdentity.properties.principalId
output securityManagerClientId string = securityManagerIdentity.properties.clientId
output securityManagerResourceId string = securityManagerIdentity.id
