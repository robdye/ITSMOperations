// ITSM Operations — Cognition Tags (Phase E)
//
// Lightweight TTL-backed tag store layered on top of the cognition graph.
// Phase E spec: when an Azure-status degradation signal fires, we tag the
// graph with `upstream-degraded:<region>` for 30 minutes so that workers
// triaging the next incidents can cite the upstream condition rather than
// chasing a downstream symptom.
//
// Tags are intentionally separate from the graph builder — `buildCognitionGraph()`
// remains a pure projection and reads tags out of this store.

export interface CognitionTag {
  /** Tag namespace, e.g. `upstream-degraded`. */
  namespace: string;
  /** Tag key (free-form, often a region or asset id). */
  key: string;
  /** ISO timestamp when the tag was applied. */
  appliedAt: string;
  /** Optional payload (region details, source signal id, etc.). */
  detail?: Record<string, unknown>;
  /** Soft expiry (ms epoch). The store sweeps lazily on read. */
  expiresAt: number;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 min — matches Phase E spec.

const tags = new Map<string, CognitionTag>();

function compositeKey(namespace: string, key: string): string {
  return `${namespace}::${key}`;
}

function sweep(): void {
  const now = Date.now();
  for (const [k, v] of tags.entries()) {
    if (v.expiresAt < now) tags.delete(k);
  }
}

/**
 * Apply a tag with optional TTL. Re-applying overwrites and refreshes the
 * expiry — this is the "renew the upstream-degraded tag while the incident
 * is still active" behaviour spec'd in Phase E.
 */
export function applyTag(args: {
  namespace: string;
  key: string;
  detail?: Record<string, unknown>;
  ttlMs?: number;
}): CognitionTag {
  const ttl = args.ttlMs ?? DEFAULT_TTL_MS;
  const tag: CognitionTag = {
    namespace: args.namespace,
    key: args.key,
    detail: args.detail,
    appliedAt: new Date().toISOString(),
    expiresAt: Date.now() + ttl,
  };
  tags.set(compositeKey(args.namespace, args.key), tag);
  return tag;
}

export function clearTag(namespace: string, key: string): boolean {
  return tags.delete(compositeKey(namespace, key));
}

export function listTags(namespace?: string): CognitionTag[] {
  sweep();
  const out: CognitionTag[] = [];
  for (const v of tags.values()) {
    if (!namespace || v.namespace === namespace) out.push(v);
  }
  return out;
}

export function isTagged(namespace: string, key: string): boolean {
  sweep();
  return tags.has(compositeKey(namespace, key));
}

export function _resetCognitionTags(): void {
  tags.clear();
}
