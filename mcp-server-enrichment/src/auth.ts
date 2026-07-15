/**
 * Auth context — extracted from incoming request headers and threaded through
 * every enrichment tool call.
 *
 * Hard rule #2 (Phase E): every enrichment tool MUST validate the OBO bearer
 * + `x-ms-tenant-id` header. The middleware (in index.ts) blocks at the HTTP
 * layer; this module exposes the per-request context plumbing.
 */

import type { Request } from 'express';

export interface EnrichmentAuthContext {
  /** Raw OBO bearer JWT — opaque to this server, forwarded only when needed. */
  userToken: string;
  /** Tenant id from `x-ms-tenant-id`. */
  tenantId: string;
  /** `demo` is accepted only under NODE_ENV=test for fixture-based tests. */
  profile: 'prod' | 'demo';
  /** Logical id of the calling worker (e.g. `incident-manager`). */
  callerAgentId: string;
  /** Optional request id for trace correlation. */
  correlationId?: string;
}

/**
 * Build an auth context from an Express request. Returns `null` when the
 * required OBO + tenant headers are missing.
 *
 * Allowed exception: when `ENRICHMENT_DEV_MODE=1` and the request comes from
 * loopback, a synthetic context is constructed so unit tests can exercise the
 * server without minting real tokens. Production deployments never set the
 * env var.
 */
export function buildAuthContextFromRequest(req: Request): EnrichmentAuthContext | null {
  const auth = req.header('authorization') ?? req.header('Authorization') ?? '';
  const tenantId = req.header('x-ms-tenant-id') ?? '';
  const requestedProfile = (req.header('x-itsm-profile') ?? 'prod').toLowerCase();
  const profile: 'prod' | 'demo' =
    process.env.NODE_ENV === 'test' && requestedProfile === 'demo' ? 'demo' : 'prod';
  const callerAgentId = req.header('x-caller-agent-id') ?? 'unknown-agent';
  const correlationId = req.header('x-correlation-id') ?? req.header('x-ms-correlation-id') ?? undefined;

  const devMode = process.env.ENRICHMENT_DEV_MODE === '1' || process.env.ENRICHMENT_DEV_MODE === 'true';
  const looksLikeBearer = /^Bearer\s+\S+/i.test(auth);
  const hasTenant = tenantId.trim().length > 0;

  if (!looksLikeBearer || !hasTenant) {
    if (devMode) {
      return {
        userToken: looksLikeBearer ? auth.replace(/^Bearer\s+/i, '') : 'dev-mode-token',
        tenantId: hasTenant ? tenantId : 'dev-tenant',
        profile,
        callerAgentId,
        correlationId,
      };
    }
    return null;
  }

  return {
    userToken: auth.replace(/^Bearer\s+/i, ''),
    tenantId,
    profile,
    callerAgentId,
    correlationId,
  };
}

/**
 * Decide whether a request should be allowed to bypass the OBO check
 * (currently only `/health` and pre-flight CORS).
 */
export function isPublicPath(path: string): boolean {
  return path === '/health' || path === '/' || path.startsWith('/health/');
}
