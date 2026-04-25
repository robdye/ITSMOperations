/**
 * ServiceNow Authentication — OAuth 2.0 + Basic Auth fallback
 * 
 * Supports:
 * - OAuth 2.0 On-Behalf-Of / OBO (per-user, via Azure AD token exchange)
 * - OAuth 2.0 Client Credentials (service-to-service)
 * - Basic Auth fallback (legacy, for dev instances)
 */

import { createHash } from 'crypto';

const SNOW_INSTANCE = process.env.SNOW_INSTANCE || '';
const SNOW_CLIENT_ID = process.env.SNOW_CLIENT_ID || '';
const SNOW_CLIENT_SECRET = process.env.SNOW_CLIENT_SECRET || '';
const SNOW_USER = process.env.SNOW_USER || '';
const SNOW_PASSWORD = process.env.SNOW_PASSWORD || '';
const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || '';
const SNOW_OBO_SCOPE = process.env.SNOW_OBO_SCOPE || '';

// Client-credentials token cache
let oauthToken: { access_token: string; expires_at: number } | null = null;

// OBO token cache keyed by hash of the incoming user token
const oboTokenCache = new Map<string, { access_token: string; expires_at: number }>();

export type AuthMode = 'obo' | 'oauth' | 'basic';

/**
 * Hash a user token to use as a stable, safe cache key.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Detect which auth mode is available.
 * If OBO prerequisites are configured, returns 'obo' (actual use depends on a
 * user token being supplied at call time).
 */
export function getAuthMode(): AuthMode {
  if (SNOW_CLIENT_ID && SNOW_CLIENT_SECRET && AZURE_TENANT_ID && SNOW_OBO_SCOPE && SNOW_INSTANCE) {
    return 'obo';
  }
  if (SNOW_CLIENT_ID && SNOW_CLIENT_SECRET && SNOW_INSTANCE) {
    return 'oauth';
  }
  return 'basic';
}

/**
 * Exchange a user's Entra ID token for a ServiceNow access token via the
 * Azure AD On-Behalf-Of (OBO) flow.
 *
 * @see https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow
 */
async function getOboToken(userToken: string): Promise<string> {
  const cacheKey = hashToken(userToken);
  const cached = oboTokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expires_at - 60_000) {
    return cached.access_token;
  }

  const tokenUrl = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id: SNOW_CLIENT_ID,
    client_secret: SNOW_CLIENT_SECRET,
    assertion: userToken,
    scope: SNOW_OBO_SCOPE,
    requested_token_use: 'on_behalf_of',
  });

  console.log(`[SnowAuth] Requesting OBO token from Azure AD (tenant: ${AZURE_TENANT_ID})`);

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[SnowAuth] OBO token request failed (${res.status}): ${text}`);
    throw new Error(`OBO token request failed: ${res.status}`);
  }

  const data = await res.json() as any;
  const entry = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in || 1800) * 1000,
  };
  oboTokenCache.set(cacheKey, entry);

  console.log(`[SnowAuth] OBO token acquired (expires in ${data.expires_in}s)`);
  return entry.access_token;
}

/**
 * Get an OAuth access token via Client Credentials grant.
 * Caches tokens and refreshes 60 seconds before expiry.
 */
async function getOAuthToken(): Promise<string> {
  // Return cached token if still valid
  if (oauthToken && Date.now() < oauthToken.expires_at - 60_000) {
    return oauthToken.access_token;
  }

  const tokenUrl = `${SNOW_INSTANCE}/oauth_token.do`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: SNOW_CLIENT_ID,
    client_secret: SNOW_CLIENT_SECRET,
  });

  console.log(`[SnowAuth] Requesting OAuth token from ${SNOW_INSTANCE}`);
  
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[SnowAuth] OAuth token request failed (${res.status}): ${text}`);
    throw new Error(`OAuth token request failed: ${res.status}`);
  }

  const data = await res.json() as any;
  oauthToken = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in || 1800) * 1000,
  };

  console.log(`[SnowAuth] OAuth token acquired (expires in ${data.expires_in}s)`);
  return oauthToken.access_token;
}

/**
 * Get authorization headers for ServiceNow API calls.
 *
 * When a `userToken` (Entra ID JWT) is provided and OBO is configured, the
 * token is exchanged via the Azure AD OBO flow so that the ServiceNow call
 * runs as the signed-in user.  Otherwise falls back to client-credentials
 * OAuth or Basic Auth.
 */
export async function getAuthHeaders(userToken?: string): Promise<Record<string, string>> {
  const mode = getAuthMode();

  // OBO flow — requires a user token at call time
  if (mode === 'obo' && userToken) {
    try {
      const token = await getOboToken(userToken);
      return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
    } catch (err) {
      console.warn('[SnowAuth] OBO failed, falling back to client-credentials:', (err as Error).message);
      // Fall through to client-credentials
    }
  }

  // Client-credentials OAuth
  if (mode === 'obo' || mode === 'oauth') {
    try {
      const token = await getOAuthToken();
      return {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
    } catch (err) {
      console.warn('[SnowAuth] OAuth failed, falling back to Basic Auth:', (err as Error).message);
      // Fall through to basic auth
    }
  }

  // Basic Auth fallback
  if (SNOW_USER && SNOW_PASSWORD) {
    const encoded = Buffer.from(`${SNOW_USER}:${SNOW_PASSWORD}`).toString('base64');
    return {
      Authorization: `Basic ${encoded}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  throw new Error('No ServiceNow authentication configured (neither OAuth nor Basic Auth)');
}

/**
 * Get auth status for health checks.
 */
export function getAuthStatus(): {
  mode: AuthMode;
  tokenCached: boolean;
  oboCacheSize: number;
  instance: string;
} {
  return {
    mode: getAuthMode(),
    tokenCached: oauthToken !== null && Date.now() < oauthToken.expires_at,
    oboCacheSize: oboTokenCache.size,
    instance: SNOW_INSTANCE ? new URL(SNOW_INSTANCE).hostname : 'not-configured',
  };
}

/**
 * Clear the cached OAuth token (e.g., on auth failure).
 * Also purges the OBO token cache.
 */
export function clearTokenCache(): void {
  oauthToken = null;
  oboTokenCache.clear();
}
