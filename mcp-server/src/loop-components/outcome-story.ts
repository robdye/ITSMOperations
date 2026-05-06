// Outcome story Loop component — Phase C.1
//
// Renders the resolution story for a ServiceNow incident as a co-editable
// Loop news-card. Forwarding the Loop component into Teams/Outlook keeps
// the link to the source incident — receivers see edits in real-time.
//
// Hard-rule compliance:
//   - DA-only (registered as `present-outcome-story-as-loop`).
//   - MCP-sourced (input flows through `mcp-server`'s ServiceNow client).
//   - No "Alex" / "signal-router" / "autonomy" / "foresight" tokens.

import {
  emptyLoopPayload,
  type LoopBlock,
  type LoopComponentPayload,
} from './types.js';

export interface OutcomeStoryLoopTimelineEntry {
  time: string;
  text: string;
  severity: 'critical' | 'warning' | 'success' | 'info';
}

export interface OutcomeStoryLoopQuote {
  text: string;
  by: string;
  role?: string;
}

export interface OutcomeStoryLoopInput {
  number: string;
  headline: string;
  priority: string;
  state: string;
  affectedCi?: string;
  assignedTo?: string;
  openedAt: string;
  resolvedAt?: string;
  /** Time-to-resolution in minutes, when known. */
  resolutionMinutes: number | null;
  resolutionCaption?: string;
  story: string[];
  timeline: OutcomeStoryLoopTimelineEntry[];
  quote?: OutcomeStoryLoopQuote;
  url?: string;
}

/**
 * Build the outcome-story Loop component payload. Pure function; no I/O.
 *
 * Layout (newsCard component, top-down):
 *   1. Hero heading — incident number + headline.
 *   2. Subtitle — priority, state, affected CI as a one-liner.
 *   3. Hero callout — resolution time + caption.
 *   4. Story paragraphs.
 *   5. Quote callout (if available).
 *   6. Timeline as a numbered list.
 *   7. Optional ServiceNow link.
 */
export function buildOutcomeStoryLoop(
  input: OutcomeStoryLoopInput,
): LoopComponentPayload {
  const generatedAt = new Date().toISOString();

  const payload = emptyLoopPayload('newsCard', `${input.number} — ${input.headline}`, {
    system: 'servicenow',
    referenceId: input.number,
    generatedAt,
  });
  payload.subtitle = buildSubtitle(input);

  const blocks: LoopBlock[] = [];

  blocks.push({
    type: 'heading',
    level: 1,
    text: `${input.number} — ${input.headline}`,
  });

  blocks.push({
    type: 'paragraph',
    text: payload.subtitle,
  });

  // Hero callout — resolution time / caption.
  blocks.push({
    type: 'callout',
    variant: heroVariant(input),
    text: buildHeroText(input),
  });

  blocks.push({ type: 'separator' });

  // Story paragraphs.
  if (input.story.length > 0) {
    blocks.push({ type: 'heading', level: 2, text: 'What happened' });
    for (const para of input.story) {
      blocks.push({ type: 'paragraph', text: para });
    }
  }

  // Quote.
  if (input.quote && input.quote.text.trim().length > 0) {
    const attribution = input.quote.role
      ? `${input.quote.by} · ${input.quote.role}`
      : input.quote.by;
    blocks.push({
      type: 'callout',
      variant: 'info',
      text: `“${input.quote.text}” — ${attribution}`,
    });
  }

  // Timeline.
  if (input.timeline.length > 0) {
    blocks.push({ type: 'heading', level: 2, text: 'Timeline' });
    blocks.push({
      type: 'numberedList',
      items: input.timeline.map((entry) => `${entry.time} — ${entry.text}`),
    });
  }

  // Link.
  if (input.url) {
    blocks.push({ type: 'separator' });
    blocks.push({
      type: 'link',
      url: input.url,
      text: `Open ${input.number} in ServiceNow`,
    });
  }

  payload.blocks = blocks;
  return payload;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildSubtitle(input: OutcomeStoryLoopInput): string {
  const parts: string[] = [];
  parts.push(input.priority);
  parts.push(input.state);
  if (input.affectedCi) parts.push(input.affectedCi);
  if (input.assignedTo) parts.push(`assigned ${input.assignedTo}`);
  return parts.join(' · ');
}

function heroVariant(
  input: OutcomeStoryLoopInput,
): 'success' | 'warning' | 'info' | 'critical' {
  const state = (input.state || '').toLowerCase();
  if (state.includes('resolved') || state.includes('closed')) return 'success';
  if (state.includes('progress') || state.includes('hold')) return 'warning';
  return 'info';
}

function buildHeroText(input: OutcomeStoryLoopInput): string {
  if (input.resolutionMinutes != null) {
    const mins = input.resolutionMinutes;
    const caption = input.resolutionCaption || `Resolved in ${mins} minutes.`;
    return `Time to resolution: ${formatMinutes(mins)} — ${caption}`;
  }
  return input.resolutionCaption || 'Resolution under way.';
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
