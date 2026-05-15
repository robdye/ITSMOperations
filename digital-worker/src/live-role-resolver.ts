// ITSM Operations — Live Role Resolver (Pattern 3)
//
// Resolve an actor's *current* roles at decision time. In-process TTL cache
// (default 300s) with separate negative cache (30s for not-found). No new
// infrastructure — best-effort Microsoft Graph `memberOf` for interactive
// actors with a whitelist filter, env-driven role JSON for A2A callers, and
// routine/signal-derived roles for the autonomous path.
//
// Inputs come from three places:
//   - interactive: TurnContext.activity.from.aadObjectId
//   - A2A:         TurnContext.turnState["callerAgentId"] + env A2A_AGENT_ROLES_JSON
//   - autonomous:  routine.runAsRoles[] or signal.payload.actorRoles[]

export type RoleSource = 'graph' | 'a2a-env' | 'autonomous-config' | 'fallback' | 'cache';

export interface LiveRoles {
  actor: string;
  roles: string[];
  source: RoleSource;
  fetchedAt: number;
  ttlMs: number;
}

interface CacheEntry {
  value: LiveRoles;
  expiresAt: number;
}

interface NegativeEntry {
  expiresAt: number;
}

const POSITIVE_TTL_MS = Number(process.env.LIVE_ROLE_CACHE_TTL_MS || 300_000);
const NEGATIVE_TTL_MS = Number(process.env.LIVE_ROLE_NEG_CACHE_TTL_MS || 30_000);

const cache = new Map<string, CacheEntry>();
const negCache = new Map<string, NegativeEntry>();

/** Default fallback roles used when no source matched. */
const FALLBACK_ROLES = ['system'];

function getEnvList(name: string): string[] {
  const v = process.env[name];
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Map a Graph group displayName to one of our coarse roles. Whitelist-driven:
 * groups not in the map are ignored. The map can be extended via env
 * `LIVE_ROLE_GROUP_MAP_JSON` (a JSON object: `{"groupName":"role"}`).
 */
function loadGroupMap(): Record<string, string> {
  const baseline: Record<string, string> = {
    'Operations Managers': 'operations-manager',
    'ITSM Change Managers': 'change-manager',
    'ITSM Problem Managers': 'problem-manager',
    'ITSM Incident Responders': 'incident-responder',
    'SRE Leads': 'sre-lead',
    'Security Officers': 'security-officer',
  };
  const overrideRaw = process.env.LIVE_ROLE_GROUP_MAP_JSON;
  if (!overrideRaw) return baseline;
  try {
    const parsed = JSON.parse(overrideRaw) as Record<string, string>;
    return { ...baseline, ...parsed };
  } catch {
    return baseline;
  }
}

function loadA2AAgentRoles(): Record<string, string[]> {
  const raw = process.env.A2A_AGENT_ROLES_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string[] | string>;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(parsed)) {
      out[k] = Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim());
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Resolve roles for an interactive operator via Microsoft Graph. Returns
 * `null` on any failure so the caller can fall back. Best-effort, never
 * throws to the caller.
 */
async function resolveInteractiveFromGraph(aadObjectId: string): Promise<string[] | null> {
  const token = process.env.GRAPH_TOKEN || '';
  if (!token) return null;
  try {
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(aadObjectId)}/memberOf?$select=displayName&$top=100`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { value?: Array<{ displayName?: string }> };
    const groupNames = (json.value || []).map((g) => g.displayName).filter(Boolean) as string[];
    const map = loadGroupMap();
    const roles = new Set<string>();
    for (const name of groupNames) {
      if (map[name]) roles.add(map[name]);
    }
    return Array.from(roles);
  } catch {
    return null;
  }
}

export interface ResolveRolesInputs {
  /** Required — unique key identifying the actor. */
  actor: string;
  /** When true, treat actor as interactive operator (Graph lookup). */
  interactive?: boolean;
  /** When set, treat actor as an A2A caller and look up via env. */
  a2aAgentId?: string;
  /** When set, use these roles directly (routine/signal config). */
  autonomousRoles?: string[];
  /** Skip cache (for testing / forced refresh). */
  noCache?: boolean;
}

/**
 * Resolve live roles for the given actor. Order:
 *   1) cache hit
 *   2) explicit autonomousRoles[] (highest precedence — routine/signal config)
 *   3) a2aAgentId via env
 *   4) interactive via Graph
 *   5) fallback ['system']
 */
export async function resolveRoles(input: ResolveRolesInputs): Promise<LiveRoles> {
  const key = `actor:${input.actor}`;
  const now = Date.now();
  if (!input.noCache) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) {
      return { ...hit.value, source: 'cache' };
    }
    const neg = negCache.get(key);
    if (neg && neg.expiresAt > now) {
      return {
        actor: input.actor,
        roles: FALLBACK_ROLES,
        source: 'fallback',
        fetchedAt: now,
        ttlMs: NEGATIVE_TTL_MS,
      };
    }
  }

  // 2) Explicit autonomous role list (routine/signal config).
  if (input.autonomousRoles && input.autonomousRoles.length > 0) {
    const value: LiveRoles = {
      actor: input.actor,
      roles: dedupe(input.autonomousRoles),
      source: 'autonomous-config',
      fetchedAt: now,
      ttlMs: POSITIVE_TTL_MS,
    };
    cache.set(key, { value, expiresAt: now + POSITIVE_TTL_MS });
    return value;
  }

  // 3) A2A — look up via env map.
  if (input.a2aAgentId) {
    const a2aMap = loadA2AAgentRoles();
    const roles = a2aMap[input.a2aAgentId];
    if (roles && roles.length > 0) {
      const value: LiveRoles = {
        actor: input.actor,
        roles: dedupe(roles),
        source: 'a2a-env',
        fetchedAt: now,
        ttlMs: POSITIVE_TTL_MS,
      };
      cache.set(key, { value, expiresAt: now + POSITIVE_TTL_MS });
      return value;
    }
  }

  // 4) Interactive via Graph.
  if (input.interactive) {
    const roles = await resolveInteractiveFromGraph(input.actor);
    if (roles && roles.length > 0) {
      const value: LiveRoles = {
        actor: input.actor,
        roles: dedupe(roles),
        source: 'graph',
        fetchedAt: now,
        ttlMs: POSITIVE_TTL_MS,
      };
      cache.set(key, { value, expiresAt: now + POSITIVE_TTL_MS });
      return value;
    }
    // Fall through to fallback + negative cache.
    negCache.set(key, { expiresAt: now + NEGATIVE_TTL_MS });
  }

  // 5) Fallback — defaults from env, then ['system'].
  const envDefault = getEnvList('LIVE_ROLE_DEFAULT');
  const fallback = envDefault.length > 0 ? envDefault : FALLBACK_ROLES;
  return {
    actor: input.actor,
    roles: dedupe(fallback),
    source: 'fallback',
    fetchedAt: now,
    ttlMs: NEGATIVE_TTL_MS,
  };
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/** Test helper / kill-switch invalidator. */
export function _resetLiveRoleCache(): void {
  cache.clear();
  negCache.clear();
}

/** Read-only snapshot for debugging endpoints. */
export function getLiveRoleCacheSnapshot(): Array<{ actor: string; roles: string[]; source: RoleSource; ageMs: number }> {
  const now = Date.now();
  const out: Array<{ actor: string; roles: string[]; source: RoleSource; ageMs: number }> = [];
  for (const [, entry] of cache.entries()) {
    out.push({
      actor: entry.value.actor,
      roles: entry.value.roles,
      source: entry.value.source,
      ageMs: now - entry.value.fetchedAt,
    });
  }
  return out;
}
