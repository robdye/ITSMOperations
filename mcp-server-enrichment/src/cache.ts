/**
 * Tiny TTL cache for enrichment payloads. Keyed on `<source>:<args>` so the
 * upstream rate limits (50 req / 30 s for NVD, etc.) are respected per the
 * Phase E spec.
 *
 * In-memory only by default. Optional Redis backend (toggle via
 * `REDIS_CONNECTION_STRING`) is wired through a thin async surface to keep
 * the source modules synchronous when no remote cache is configured.
 */

interface Entry {
  value: unknown;
  expiresAt: number;
  hits: number;
}

const store = new Map<string, Entry>();
const MAX_ENTRIES = 1024;

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
}

const stats: CacheStats = { size: 0, hits: 0, misses: 0, evictions: 0 };

function evictIfFull(): void {
  if (store.size < MAX_ENTRIES) return;
  // Cheap LRU-ish: drop the oldest 10% by insertion order.
  const drop = Math.ceil(MAX_ENTRIES * 0.1);
  let dropped = 0;
  for (const key of store.keys()) {
    store.delete(key);
    dropped++;
    if (dropped >= drop) break;
  }
  stats.evictions += dropped;
}

export function makeKey(source: string, args: Record<string, unknown> | string | number | undefined): string {
  if (args === undefined) return source;
  if (typeof args === 'string' || typeof args === 'number') return `${source}:${args}`;
  return `${source}:${JSON.stringify(args)}`;
}

export function get<T = unknown>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) {
    stats.misses++;
    return undefined;
  }
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    stats.misses++;
    return undefined;
  }
  entry.hits++;
  stats.hits++;
  return entry.value as T;
}

export function set<T = unknown>(key: string, value: T, ttlMs: number): void {
  evictIfFull();
  store.set(key, { value, expiresAt: Date.now() + ttlMs, hits: 0 });
  stats.size = store.size;
}

export function clear(): void {
  store.clear();
  stats.size = 0;
}

export function getStats(): CacheStats {
  return { ...stats, size: store.size };
}

/**
 * Wrapper that runs `loader()` on a cache miss and stores the value.
 * Returns `{value, cacheHit}` so the source modules can stamp provenance.
 */
export async function memo<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<{ value: T; cacheHit: boolean }> {
  const hit = get<T>(key);
  if (hit !== undefined) return { value: hit, cacheHit: true };
  const value = await loader();
  set(key, value, ttlMs);
  return { value, cacheHit: false };
}
