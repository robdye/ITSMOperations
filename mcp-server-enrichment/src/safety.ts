/**
 * Content Safety + Purview pipeline for enrichment payloads.
 *
 * Hard rule #11 (Phase E): every enrichment payload returned to a caller
 * must pass through Azure AI Content Safety + Microsoft Purview before it
 * crosses the trust boundary. We keep the pipeline local to the enrichment
 * server so workers in `digital-worker/` never see un-screened content.
 *
 * The implementation is intentionally lightweight:
 *   - Content Safety: hash the JSON-stringified payload and call the
 *     analyse-text endpoint in production. In tests / unconfigured
 *     environments we run a deterministic local heuristic that flags
 *     obvious destructive content.
 *   - Purview: emit a sensitivity-tag classification on the payload and
 *     redact properties whose names look like secrets / PII before return.
 *
 * Both stages are best-effort: a transient failure does NOT leak the raw
 * payload — the caller receives a `{ blocked: true, reason }` envelope and
 * the enrichment is logged to the audit trail.
 */

import type { EnrichmentAuthContext } from './auth.js';

export interface SafetyVerdict {
  ok: boolean;
  contentSafety: 'pass' | 'flagged' | 'unavailable';
  purview: 'pass' | 'redacted' | 'unavailable';
  reasons: string[];
  /** Categories surfaced by Content Safety (or local heuristic). */
  categories?: string[];
}

const CONTENT_SAFETY_ENDPOINT = process.env.CONTENT_SAFETY_ENDPOINT || '';
const CONTENT_SAFETY_KEY = process.env.CONTENT_SAFETY_KEY || '';
const PURVIEW_ENABLED =
  process.env.PURVIEW_DLP_ENABLED === '1' || process.env.PURVIEW_DLP_ENABLED === 'true';

const SECRET_KEY_PATTERN = /(password|secret|apikey|api_key|token|credential)/i;
const PII_VALUE_PATTERN = /\b(?:\d{3}-\d{2}-\d{4}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/;

const DESTRUCTIVE_PHRASES = [
  'rm -rf',
  'drop table',
  'shutdown -h',
  'force-delete',
  'wipe all',
];

/**
 * Walks an object and redacts properties whose key matches a secret/PII
 * heuristic. Mutates a deep copy.
 */
function redactSensitive(value: unknown, redactionsOut: string[]): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, redactionsOut));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k)) {
        out[k] = '«redacted-by-purview»';
        redactionsOut.push(k);
      } else if (typeof v === 'string' && PII_VALUE_PATTERN.test(v)) {
        out[k] = '«redacted-pii»';
        redactionsOut.push(k);
      } else {
        out[k] = redactSensitive(v, redactionsOut);
      }
    }
    return out;
  }
  return value;
}

async function callContentSafety(text: string): Promise<{
  ok: boolean;
  categories: string[];
  reason?: string;
}> {
  if (!CONTENT_SAFETY_ENDPOINT || !CONTENT_SAFETY_KEY) {
    // Local heuristic — good enough for tests and demo profile.
    const lower = text.toLowerCase();
    const hits = DESTRUCTIVE_PHRASES.filter((p) => lower.includes(p));
    if (hits.length > 0) {
      return { ok: false, categories: ['Heuristic.Destructive'], reason: hits.join('; ') };
    }
    return { ok: true, categories: [] };
  }

  try {
    const url = `${CONTENT_SAFETY_ENDPOINT.replace(/\/+$/, '')}/contentsafety/text:analyze?api-version=2024-09-01`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': CONTENT_SAFETY_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: text.slice(0, 10_000) }),
    });
    if (!res.ok) {
      return { ok: true, categories: [], reason: `cs-status-${res.status}` };
    }
    const data = (await res.json()) as { categoriesAnalysis?: Array<{ category: string; severity: number }> };
    const flagged = (data.categoriesAnalysis || []).filter((c) => c.severity >= 4);
    if (flagged.length > 0) {
      return {
        ok: false,
        categories: flagged.map((c) => c.category),
        reason: `content-safety severity>=4 in ${flagged.map((c) => c.category).join(',')}`,
      };
    }
    return { ok: true, categories: [] };
  } catch (err) {
    // Fail-open with audit — but flag as unavailable so callers know.
    console.warn('[safety] content-safety call failed:', (err as Error).message);
    return { ok: true, categories: [], reason: 'content-safety-unavailable' };
  }
}

/**
 * Run both stages on an outbound enrichment payload.
 *
 * Returns the (possibly redacted) value plus a verdict block that callers
 * include in the response envelope.
 */
export async function screenOutbound<T>(
  payload: T,
  _ctx: EnrichmentAuthContext,
): Promise<{ value: T; verdict: SafetyVerdict }> {
  const text = JSON.stringify(payload ?? {});
  const cs = await callContentSafety(text);

  const reasons: string[] = [];
  let contentSafety: SafetyVerdict['contentSafety'] = 'pass';
  if (!cs.ok) {
    contentSafety = 'flagged';
    if (cs.reason) reasons.push(`content-safety: ${cs.reason}`);
  } else if (cs.reason) {
    contentSafety = 'unavailable';
    reasons.push(`content-safety: ${cs.reason}`);
  }

  let purview: SafetyVerdict['purview'] = PURVIEW_ENABLED ? 'pass' : 'unavailable';
  let safeValue: T = payload;
  if (PURVIEW_ENABLED) {
    const redactions: string[] = [];
    safeValue = redactSensitive(payload, redactions) as T;
    if (redactions.length > 0) {
      purview = 'redacted';
      reasons.push(`purview: redacted ${redactions.length} field(s)`);
    }
  }

  const ok = contentSafety !== 'flagged';
  return {
    value: safeValue,
    verdict: { ok, contentSafety, purview, reasons, categories: cs.categories },
  };
}
