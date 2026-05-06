/**
 * Common envelope for every enrichment tool result.
 *
 * Hard rule (Phase E): every enrichment payload must include `provenance`
 * so downstream callers (case-manager, reviewer-worker, cognition-graph)
 * can cite the source in worknotes, KB articles, and audit records.
 */

import type { EnrichmentAuthContext } from './auth.js';
import { memo, makeKey } from './cache.js';
import { screenOutbound, type SafetyVerdict } from './safety.js';
import { buildAuditEntry, emitEnrichmentAudit, type EnrichmentRiskLevel } from './audit.js';

export interface Provenance {
  source: string;
  fetchedAt: string;
  fixtureUsed: boolean;
  cacheHit: boolean;
  sourceUrl: string;
  /** Soft TTL the cache was set with (informational, not enforced). */
  ttlMs: number;
  /** Always 'read' for enrichment — these are read-only intelligence calls. */
  riskLevel: EnrichmentRiskLevel;
}

export interface EnrichmentEnvelope<T> {
  data: T;
  provenance: Provenance;
  safety: SafetyVerdict;
}

export interface SourceConfig<TArgs, TData> {
  /** Stable id used for cache key + audit attribution (e.g. `cisa-kev`). */
  source: string;
  /** Soft TTL — used for caching and surfaced via provenance. */
  ttlMs: number;
  /** Canonical upstream URL (informational, included in provenance). */
  sourceUrl: string;
  /** Live fetch path. Should NOT be called in demo profile. */
  fetchLive(args: TArgs, ctx: EnrichmentAuthContext): Promise<TData>;
  /** Demo-mode fixture path. Must be hermetic (no network). */
  fetchFixture(args: TArgs): TData;
  /** Optional summary string for the audit `resultSummary` field. */
  summarize?(args: TArgs, data: TData): string;
}

/**
 * Run a source: cache → fixture-or-live → safety → audit → envelope.
 */
export async function runSource<TArgs extends Record<string, unknown> | undefined, TData>(
  cfg: SourceConfig<TArgs, TData>,
  args: TArgs,
  ctx: EnrichmentAuthContext,
): Promise<EnrichmentEnvelope<TData>> {
  const started = Date.now();
  const key = makeKey(cfg.source, args ?? {});
  const fixtureUsed = ctx.profile === 'demo';

  let cacheHit = false;
  const { value: data } = await memo<TData>(
    key,
    cfg.ttlMs,
    async () => {
      if (fixtureUsed) return cfg.fetchFixture(args);
      return cfg.fetchLive(args, ctx);
    },
  ).then((r) => {
    cacheHit = r.cacheHit;
    return r;
  });

  const { value: safeData, verdict } = await screenOutbound(data, ctx);

  const provenance: Provenance = {
    source: cfg.source,
    fetchedAt: new Date().toISOString(),
    fixtureUsed,
    cacheHit,
    sourceUrl: cfg.sourceUrl,
    ttlMs: cfg.ttlMs,
    riskLevel: 'read',
  };

  const summary = cfg.summarize ? cfg.summarize(args, data) : `${cfg.source} ok`;

  await emitEnrichmentAudit(
    buildAuditEntry({
      source: cfg.source,
      ctx,
      parameters: (args ?? {}) as Record<string, unknown>,
      resultSummary: summary,
      cacheHit,
      fixtureUsed,
      durationMs: Date.now() - started,
      riskLevel: 'read',
      verdict,
    }),
  );

  return { data: safeData, provenance, safety: verdict };
}
