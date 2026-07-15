// ──────────────────────────────────────────────────────────────
// Phase E — MCP Server (Enrichment) Container App
//
// Mirrors the existing mcp-server module but on port 3010, with extra
// env vars for the enrichment-specific OBO trade-up to Microsoft Graph
// (used by the m365 service-health source) and for the optional NIST NVD
// API key used by the live enrichment source.
// ──────────────────────────────────────────────────────────────

@description('Environment name used in resource naming')
param environmentName string

@description('Azure region')
param location string

@description('Tags applied to every resource')
param tags object

@description('Container Apps environment id')
param containerAppsEnvId string

@description('Container Apps environment default domain (used to advertise FQDN to digital-worker)')
param containerAppsEnvDomain string

@description('ACR login server (e.g. myacr.azurecr.io)')
param acrLoginServer string

@description('Application Insights connection string')
param appInsightsConnectionString string

@description('Key Vault name (secrets resolved at runtime via MI)')
param keyVaultName string

@description('Content Safety endpoint (outbound payload screening)')
param contentSafetyEndpoint string

@description('Audit trail Storage Table connection string secret name in KV (optional)')
param auditTrailSecretName string = 'AUDIT-TRAIL-CONNECTION-STRING'

@description('Optional NIST NVD API key secret name in KV (raises rate limit to 50/30s)')
param nvdApiKeySecretName string = 'NVD-API-KEY'

@description('Optional Microsoft Graph OBO client id for the m365-service-health source')
param graphOboClientId string = ''

@description('Graph OBO client secret name in KV (only used when graphOboClientId is set)')
param graphOboClientSecretName string = 'ENRICHMENT-GRAPH-OBO-SECRET'

@description('Number of min replicas (set to 1 for demo, scale rules drive up to maxReplicas)')
param minReplicas int = 1

@description('Maximum replicas')
param maxReplicas int = 3

// ── Container App ───────────────────────────────────────────
resource mcpEnrichment 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'itsm-ops-${environmentName}-enrichment'
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: containerAppsEnvId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3010
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: acrLoginServer
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'mcp-enrichment'
          image: '${acrLoginServer}/itsm-mcp-enrichment:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'PORT', value: '3010' }
            { name: 'NODE_ENV', value: 'production' }
            { name: 'KEY_VAULT_NAME', value: keyVaultName }
            { name: 'CONTENT_SAFETY_ENDPOINT', value: contentSafetyEndpoint }
            { name: 'AUDIT_TRAIL_SECRET_NAME', value: auditTrailSecretName }
            { name: 'NVD_API_KEY_SECRET_NAME', value: nvdApiKeySecretName }
            { name: 'ENRICHMENT_CLIENT_ID', value: graphOboClientId }
            { name: 'ENRICHMENT_CLIENT_SECRET_NAME', value: graphOboClientSecretName }
            { name: 'GRAPH_OBO_SCOPE', value: 'https://graph.microsoft.com/.default' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3010
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 3010
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '40'
              }
            }
          }
        ]
      }
    }
  }
}

// ── Outputs ─────────────────────────────────────────────────
output mcpEnrichmentFqdn string = mcpEnrichment.properties.configuration.ingress.fqdn
output mcpEnrichmentPrincipalId string = mcpEnrichment.identity.principalId
output mcpEnrichmentEndpoint string = 'https://itsm-ops-${environmentName}-enrichment.${containerAppsEnvDomain}'
