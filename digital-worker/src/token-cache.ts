// ITSM Operations Digital Worker — Observability token cache

const tokenCache = new Map<string, string>();

export function createAgenticTokenCacheKey(agentId: string, tenantId: string): string {
  return `${agentId}:${tenantId}`;
}

export function tokenResolver(agentId: string, tenantId: string): string {
  const key = createAgenticTokenCacheKey(agentId, tenantId);
  return tokenCache.get(key) || '';
}

export function setToken(agentId: string, tenantId: string, token: string): void {
  tokenCache.set(createAgenticTokenCacheKey(agentId, tenantId), token);
}

export default tokenCache;
