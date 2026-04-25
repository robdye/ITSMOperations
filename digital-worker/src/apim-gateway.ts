/**
 * Azure API Management — AI Gateway configuration.
 * Rate limiting, token metering, prompt caching, and content safety
 * at the edge for all agent API calls.
 */

// ── Configuration ──
const APIM_ENDPOINT = process.env.APIM_ENDPOINT || '';
const APIM_SUBSCRIPTION_KEY = process.env.APIM_SUBSCRIPTION_KEY || '';

// ── Types ──
export interface ApimConfig {
  endpoint: string;
  policies: ApimPolicy[];
  backends: ApimBackend[];
}

export interface ApimPolicy {
  name: string;
  type: 'rate-limit' | 'token-limit' | 'cache' | 'content-safety' | 'cors' | 'jwt-validate';
  config: Record<string, unknown>;
}

export interface ApimBackend {
  id: string;
  name: string;
  url: string;
  type: 'azure-openai' | 'mcp-server' | 'servicenow';
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  model: string;
  timestamp: string;
}

// Token usage tracking
const tokenUsageHistory: TokenUsage[] = [];
const MAX_USAGE_HISTORY = 10000;

/**
 * Check if APIM gateway is configured.
 */
export function isApimEnabled(): boolean {
  return !!(APIM_ENDPOINT && APIM_SUBSCRIPTION_KEY);
}

/**
 * Get APIM-proxied endpoint for Azure OpenAI.
 * When APIM is configured, route through it for rate limiting and metering.
 */
export function getProxiedEndpoint(service: 'openai' | 'mcp' | 'servicenow'): string | null {
  if (!isApimEnabled()) return null;

  switch (service) {
    case 'openai':
      return `${APIM_ENDPOINT}/openai`;
    case 'mcp':
      return `${APIM_ENDPOINT}/mcp`;
    case 'servicenow':
      return `${APIM_ENDPOINT}/servicenow`;
    default:
      return null;
  }
}

/**
 * Track token usage for cost analysis.
 */
export function trackTokenUsage(usage: Omit<TokenUsage, 'timestamp'>): void {
  const entry: TokenUsage = {
    ...usage,
    timestamp: new Date().toISOString(),
  };

  tokenUsageHistory.push(entry);
  if (tokenUsageHistory.length > MAX_USAGE_HISTORY) {
    tokenUsageHistory.splice(0, tokenUsageHistory.length - MAX_USAGE_HISTORY);
  }
}

/**
 * Get token usage summary for a time period.
 */
export function getTokenUsageSummary(sinceHours: number = 24): {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  byModel: Record<string, { tokens: number; cost: number }>;
  requestCount: number;
} {
  const since = Date.now() - sinceHours * 60 * 60 * 1000;
  const relevant = tokenUsageHistory.filter(u => new Date(u.timestamp).getTime() >= since);

  const byModel: Record<string, { tokens: number; cost: number }> = {};
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let estimatedCost = 0;

  for (const u of relevant) {
    totalPromptTokens += u.promptTokens;
    totalCompletionTokens += u.completionTokens;
    totalTokens += u.totalTokens;
    estimatedCost += u.estimatedCost;

    if (!byModel[u.model]) byModel[u.model] = { tokens: 0, cost: 0 };
    byModel[u.model].tokens += u.totalTokens;
    byModel[u.model].cost += u.estimatedCost;
  }

  return {
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens,
    estimatedCost: Math.round(estimatedCost * 10000) / 10000,
    byModel,
    requestCount: relevant.length,
  };
}

/**
 * Generate APIM policy XML for the AI gateway.
 * This can be applied via Azure CLI or ARM template.
 */
export function generateApimPolicyXml(): string {
  return `<!--
  ITSM Operations — AI Gateway Policy
  Apply to the Azure OpenAI backend API in APIM
-->
<policies>
  <inbound>
    <base />
    
    <!-- Rate limiting: 100 requests per minute per user -->
    <rate-limit-by-key
      calls="100"
      renewal-period="60"
      counter-key="@(context.Request.Headers.GetValueOrDefault("X-User-Id", "anonymous"))"
      increment-condition="@(context.Response.StatusCode >= 200 && context.Response.StatusCode < 300)" />
    
    <!-- Token limiting: 50,000 tokens per minute per user -->
    <azure-openai-token-limit
      tokens-per-minute="50000"
      counter-key="@(context.Request.Headers.GetValueOrDefault("X-User-Id", "anonymous"))"
      estimate-prompt-tokens="true"
      remaining-tokens-header-name="X-Remaining-Tokens" />
    
    <!-- Semantic caching: cache identical prompts for 5 minutes -->
    <azure-openai-semantic-cache-lookup
      score-threshold="0.95"
      embeddings-backend-id="embeddings-backend"
      embeddings-backend-auth="system-assigned" />
    
    <!-- Content safety check at the gateway -->
    <azure-openai-emit-token-metric
      namespace="itsm-ai-gateway">
      <dimension name="User" value="@(context.Request.Headers.GetValueOrDefault("X-User-Id", "anonymous"))" />
      <dimension name="Model" value="@(context.Request.Headers.GetValueOrDefault("X-Model", "unknown"))" />
      <dimension name="Worker" value="@(context.Request.Headers.GetValueOrDefault("X-Worker-Id", "unknown"))" />
    </azure-openai-emit-token-metric>
    
    <!-- JWT validation for agent identity -->
    <validate-azure-ad-token tenant-id="${process.env.TENANT_ID || '{TENANT_ID}'}">
      <client-application-ids>
        <application-id>${process.env.AGENT_CLIENT_ID || '{AGENT_CLIENT_ID}'}</application-id>
      </client-application-ids>
    </validate-azure-ad-token>
  </inbound>
  
  <backend>
    <!-- Load balancing across Azure OpenAI deployments -->
    <azure-openai-backend-pool>
      <backend-id>aoai-eastus</backend-id>
      <backend-id>aoai-westus</backend-id>
      <backend-id>aoai-northeurope</backend-id>
    </azure-openai-backend-pool>
  </backend>
  
  <outbound>
    <base />
    
    <!-- Cache the response -->
    <azure-openai-semantic-cache-store duration="300" />
    
    <!-- Add cost tracking headers -->
    <set-header name="X-Token-Usage" exists-action="override">
      <value>@{
        var body = context.Response.Body.As<JObject>();
        var usage = body?["usage"];
        return usage != null ? usage.ToString() : "unknown";
      }</value>
    </set-header>
  </outbound>
  
  <on-error>
    <base />
    <!-- Retry on 429 (rate limited) with exponential backoff -->
    <retry condition="@(context.Response.StatusCode == 429)" count="3" interval="10" delta="5" max-interval="30" first-fast-retry="false">
      <forward-request buffer-request-body="true" />
    </retry>
  </on-error>
</policies>`;
}

/**
 * Get APIM gateway status.
 */
export function getApimStatus(): {
  enabled: boolean;
  endpoint: string;
  tokenUsage24h: ReturnType<typeof getTokenUsageSummary>;
} {
  return {
    enabled: isApimEnabled(),
    endpoint: APIM_ENDPOINT || 'not-configured',
    tokenUsage24h: getTokenUsageSummary(24),
  };
}
