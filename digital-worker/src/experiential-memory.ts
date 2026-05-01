// ITSM Operations — Experiential Memory (Phase 9.4)
//
// "Have I seen this incident pattern before?" — Cassidy parity (cosine on
// embeddings) adapted for the ITSM domain. ITSM signals are structured
// (type / severity / asset / tags / payload keys), so we use Jaccard
// similarity over a normalised token set. This is deterministic, fast,
// dependency-free, and a much better fit than embeddings for short
// templated incident messages.
//
// Behaviour:
//   - On each completed workflow outcome, record the originating signal's
//     fingerprint plus the resolved outcome label and time-to-resolve.
//   - On a new signal (pre-action), return the top-k nearest historical
//     fingerprints with their outcomes — this lets the trigger-policy and
//     foresight engine pre-populate confidence based on prior experience.
//
// Persistence: re-uses the AlexOutcomes table partition `experiential` so
// no new infra is needed. In-memory cache mirrors the most recent N rows
// for fast lookups.

import type { Signal } from './signal-router';
import type { OutcomeLabel } from './outcome-verifier';
import {
  ANTICIPATORY_TABLES,
  loadRecent,
  upsertEntry,
} from './anticipatory-store';

const MAX_MEMORY = 500;

export interface IncidentFingerprint {
  /** Hashed signal id (so we can compare without exposing full payloads). */
  signalId: string;
  /** Tokens used for similarity comparison. */
  tokens: string[];
  /** Original signal type (for diagnostic display). */
  signalType: string;
  /** Asset/CI involved. */
  asset?: string;
  /** Severity level. */
  severity?: string;
  /** Outcome label observed when this signal was resolved. */
  outcome: OutcomeLabel;
  /** Wall-clock duration in ms from signal observation to outcome. */
  resolutionMs?: number;
  /** ISO timestamp of when this memory was recorded. */
  recordedAt: string;
}

const memory: IncidentFingerprint[] = [];
let backfilled = false;

export function _resetExperiential(): void {
  memory.length = 0;
  backfilled = false;
}

/** Return the in-memory cache as-is. Diagnostic helper. */
export function getExperientialMemory(limit = 50): IncidentFingerprint[] {
  return memory.slice(-limit).reverse();
}

/** Tokenise a signal into the canonical bag-of-strings used for Jaccard. */
export function tokenize(signal: Signal): string[] {
  const out: string[] = [];
  if (signal.type) out.push(`type:${signal.type}`);
  if (signal.severity) out.push(`sev:${signal.severity}`);
  if (signal.source) out.push(`src:${signal.source}`);
  if (signal.asset) out.push(`asset:${signal.asset}`);
  const payload = (signal.payload ?? {}) as Record<string, unknown>;
  // Use payload keys + scalar values as features. Skip arrays/objects to keep
  // tokenisation deterministic and small.
  for (const [k, v] of Object.entries(payload)) {
    out.push(`pk:${k}`);
    if (v == null) continue;
    if (typeof v === 'string') {
      // Take the first 4 words to avoid leaking long descriptions while still
      // capturing enough vocabulary for matching.
      const words = v.toLowerCase().split(/\s+/).slice(0, 4);
      for (const w of words) {
        if (w.length >= 3) out.push(`w:${w}`);
      }
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out.push(`pv:${k}=${String(v)}`);
    }
  }
  return Array.from(new Set(out));
}

/** Jaccard similarity over two token bags. Returns 0..1. */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersect = 0;
  for (const t of setA) if (setB.has(t)) intersect++;
  const union = setA.size + setB.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

/** Cold-start: load past fingerprints from Table Storage. */
export async function backfillExperientialMemory(limit = MAX_MEMORY): Promise<number> {
  if (backfilled) return memory.length;
  backfilled = true;
  try {
    const stored = await loadRecent<IncidentFingerprint>(ANTICIPATORY_TABLES.outcomes, {
      partitionKey: 'experiential',
      limit,
    });
    const ordered = stored.reverse();
    for (const s of ordered) {
      memory.push(s.payload);
      if (memory.length > MAX_MEMORY) memory.shift();
    }
    if (stored.length > 0) {
      console.log(`[ExperientialMemory] Restored ${stored.length} fingerprints from Table Storage`);
    }
  } catch (err: any) {
    console.warn('[ExperientialMemory] backfill failed:', err?.message);
  }
  return memory.length;
}

/**
 * Record a fingerprint after a workflow outcome is graded. Called from the
 * outcome-verifier when an outcome record is created.
 */
export function recordExperience(
  signal: Signal,
  outcome: OutcomeLabel,
  resolutionMs?: number,
): IncidentFingerprint {
  const fingerprint: IncidentFingerprint = {
    signalId: signal.id,
    tokens: tokenize(signal),
    signalType: signal.type,
    asset: signal.asset,
    severity: signal.severity,
    outcome,
    resolutionMs,
    recordedAt: new Date().toISOString(),
  };
  memory.push(fingerprint);
  if (memory.length > MAX_MEMORY) memory.shift();
  // Persist (fire-and-forget) under the experiential partition.
  void upsertEntry(
    ANTICIPATORY_TABLES.outcomes,
    'experiential',
    `${signal.id}-${Date.now()}`,
    fingerprint,
  ).catch((err) => console.warn('[ExperientialMemory] persist failed:', (err as Error)?.message));
  return fingerprint;
}

export interface PriorMatch {
  fingerprint: IncidentFingerprint;
  similarity: number;
}

export interface PriorPattern {
  /** Top-k matches sorted by similarity desc. */
  matches: PriorMatch[];
  /** Aggregate over the matches: success-rate, avg resolution time, sample size. */
  successRate: number;
  attempts: number;
  avgResolutionMs?: number;
  /**
   * Suggested confidence delta the trigger-policy may apply on top of the
   * baseline. Ranges roughly -0.15..+0.15. Higher when we have evidence of
   * past success on similar incidents; lower when we have evidence of
   * past failures.
   */
  suggestedConfidenceDelta: number;
}

/**
 * Find prior incident patterns similar to this signal, with a suggested
 * confidence adjustment based on their historical success rate.
 *
 * `minSimilarity` defaults to 0.35 — chosen so that the same template/asset
 * with mostly-different payload fields still matches, but unrelated incident
 * types do not.
 */
export function findPriorPattern(
  signal: Signal,
  options: { topK?: number; minSimilarity?: number } = {},
): PriorPattern {
  const topK = options.topK ?? 5;
  const minSimilarity = options.minSimilarity ?? 0.35;
  const tokens = tokenize(signal);
  const scored: PriorMatch[] = [];
  for (const f of memory) {
    const sim = jaccard(tokens, f.tokens);
    if (sim >= minSimilarity) scored.push({ fingerprint: f, similarity: sim });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  const matches = scored.slice(0, topK);
  if (matches.length === 0) {
    return { matches: [], successRate: 0, attempts: 0, suggestedConfidenceDelta: 0 };
  }
  const successes = matches.filter((m) => m.fingerprint.outcome === 'success').length;
  const failures = matches.filter((m) => m.fingerprint.outcome === 'failure').length;
  const attempts = matches.length;
  const successRate = attempts > 0 ? successes / attempts : 0;
  const totalDuration = matches.reduce(
    (acc, m) => acc + (typeof m.fingerprint.resolutionMs === 'number' ? m.fingerprint.resolutionMs : 0),
    0,
  );
  const withDuration = matches.filter((m) => typeof m.fingerprint.resolutionMs === 'number').length;
  const avgResolutionMs = withDuration > 0 ? totalDuration / withDuration : undefined;
  // Confidence delta: +0.10 when uniformly successful, -0.15 on uniform failure,
  // weighted by sample count (capped at 5 samples).
  const weight = Math.min(1, attempts / 5);
  const rawDelta = 0.1 * successRate - 0.15 * (failures / attempts);
  const suggestedConfidenceDelta = Number((rawDelta * weight).toFixed(3));
  return { matches, successRate, attempts, avgResolutionMs, suggestedConfidenceDelta };
}
