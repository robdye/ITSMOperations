// CAB pack Loop component — Phase C.1
//
// Renders the upcoming Change Advisory Board pack as a co-editable Loop
// component the manager can share into Teams or Outlook. Live-updating:
// the `source.referenceId` lets receiving Loop runtimes re-fetch on share.
//
// Hard-rule compliance:
//   - DA-only (registered as `present-cab-pack-as-loop`).
//   - MCP-sourced — input data MUST come from the same `mcp-server` ServiceNow
//     pipeline that backs `show-cab-pack`. No `/api/*` runtime calls.
//   - No reference to "Alex" / "signal-router" / "autonomy" / "foresight" —
//     guarded by `mcp-server/src/__tests__/guard-no-alex.test.ts`.

import {
  emptyLoopPayload,
  type LoopBlock,
  type LoopComponentPayload,
} from './types.js';
import { miniBlastRadiusSvg } from '../_icons.js';

// ── Input shape ────────────────────────────────────────────────────────────
//
// Matches the subset of the `show-cab-pack` widget input the Loop component
// needs to render. Kept locally so the Loop generator does not import from
// `mcp-server.ts` (and therefore does not pull the entire MCP server tree
// into its tests).

export interface CabPackLoopChange {
  number: string;
  shortDescription: string;
  type: string;
  ci: string;
  window: string;
  requestedBy?: string;
  assignmentGroup?: string;
  recommendation: 'approve' | 'defer' | 'reject';
  reason: string;
  riskScore: number;
  upstream?: string;
  downstream?: string;
  url?: string;
  /** NIST 800-53 control citations (`CM-3`, `CM-4`, ...). */
  nist?: string[];
}

export interface CabPackLoopInput {
  cabDate: string;
  attendees: string[];
  changes: CabPackLoopChange[];
  /** Stable reference id the Loop runtime keys re-fetches on (e.g. the CAB
   *  meeting id or `cab-${date}`). */
  referenceId: string;
}

// ── Generator ──────────────────────────────────────────────────────────────

/**
 * Build the CAB pack Loop component payload. Pure function; no I/O.
 *
 * Layout (page component, top-down):
 *   1. Title heading — meeting date.
 *   2. Subtitle — attendees as a one-liner.
 *   3. Recommendation summary callout (count by approve/defer/reject).
 *   4. Per-change block group:
 *      - Heading (the change number + short description)
 *      - Mini blast-radius image (CI dependency triangle).
 *      - Detail table (Window, Requestor, Assignment group, Risk, NIST).
 *      - Recommendation callout (variant chosen by recommendation).
 *      - Optional ServiceNow link.
 *   5. Footer task block — "Vote and finalise" task assigned to the chair.
 */
export function buildCabPackLoop(input: CabPackLoopInput): LoopComponentPayload {
  const generatedAt = new Date().toISOString();

  const payload = emptyLoopPayload('page', 'Change Advisory Board pack', {
    system: 'servicenow',
    referenceId: input.referenceId,
    generatedAt,
  });
  payload.subtitle = `Meeting: ${formatCabDate(input.cabDate)}`;

  const blocks: LoopBlock[] = [];

  blocks.push({
    type: 'heading',
    level: 1,
    text: `CAB pack — ${formatCabDate(input.cabDate)}`,
  });

  if (input.attendees.length > 0) {
    blocks.push({
      type: 'paragraph',
      text: `Attendees: ${input.attendees.join(', ')}.`,
    });
  }

  const summary = summariseRecommendations(input.changes);
  blocks.push({
    type: 'callout',
    variant: summary.variant,
    text: summary.text,
  });

  blocks.push({ type: 'separator' });

  if (input.changes.length === 0) {
    blocks.push({
      type: 'paragraph',
      text: 'No changes are queued for this CAB meeting.',
    });
  } else {
    for (const change of input.changes) {
      blocks.push(...renderChangeBlocks(change));
      blocks.push({ type: 'separator' });
    }
  }

  blocks.push({
    type: 'task',
    title: 'Vote and finalise the pack',
    completed: false,
    assignee: 'Change Manager',
    dueDate: input.cabDate,
  });
  blocks.push({
    type: 'task',
    title: 'Send agenda + this Loop component to attendees',
    completed: false,
    assignee: 'Change Manager',
  });

  payload.blocks = blocks;
  return payload;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCabDate(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function summariseRecommendations(
  changes: CabPackLoopChange[],
): { variant: 'success' | 'warning' | 'critical' | 'info'; text: string } {
  if (changes.length === 0) {
    return { variant: 'info', text: 'No changes queued.' };
  }
  let approve = 0;
  let defer = 0;
  let reject = 0;
  for (const c of changes) {
    if (c.recommendation === 'approve') approve += 1;
    else if (c.recommendation === 'defer') defer += 1;
    else reject += 1;
  }
  const text = `${approve} approve, ${defer} defer, ${reject} reject (${changes.length} total).`;
  if (reject > 0) return { variant: 'critical', text };
  if (defer > 0) return { variant: 'warning', text };
  return { variant: 'success', text };
}

function renderChangeBlocks(change: CabPackLoopChange): LoopBlock[] {
  const out: LoopBlock[] = [];

  out.push({
    type: 'heading',
    level: 2,
    text: `${change.number} — ${change.shortDescription}`,
  });

  // CI dependency triangle (data URI so the component is self-contained when
  // shared into Outlook / Teams / Loop app).
  const severity = mapRiskSeverity(change.riskScore);
  out.push({
    type: 'image',
    src: miniBlastRadiusSvg({
      centerLabel: change.ci,
      upstream: change.upstream,
      downstream: change.downstream,
      severity,
    }),
    alt: `Blast radius for ${change.ci}`,
  });

  // Detail table.
  const rows: string[][] = [
    ['Type', change.type],
    ['CI', change.ci],
    ['Window', change.window],
    ['Requested by', change.requestedBy ?? '—'],
    ['Assignment group', change.assignmentGroup ?? '—'],
    ['Risk score', String(change.riskScore)],
    ['NIST 800-53', (change.nist ?? []).join(', ') || '—'],
  ];
  out.push({
    type: 'table',
    headers: ['Field', 'Value'],
    rows,
  });

  // Recommendation callout.
  out.push({
    type: 'callout',
    variant: recommendationVariant(change.recommendation),
    text: `Recommendation: ${change.recommendation.toUpperCase()} — ${change.reason}`,
  });

  if (change.url) {
    out.push({
      type: 'link',
      url: change.url,
      text: `Open ${change.number} in ServiceNow`,
    });
  }

  return out;
}

function mapRiskSeverity(score: number): 'low' | 'moderate' | 'high' | 'critical' {
  if (score >= 20) return 'critical';
  if (score >= 13) return 'high';
  if (score >= 6) return 'moderate';
  return 'low';
}

function recommendationVariant(
  rec: CabPackLoopChange['recommendation'],
): 'success' | 'warning' | 'critical' {
  if (rec === 'reject') return 'critical';
  if (rec === 'defer') return 'warning';
  return 'success';
}
