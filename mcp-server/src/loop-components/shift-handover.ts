// Shift handover Loop component — Phase C.1
//
// Renders the morning operational handover briefing as a co-editable Loop
// task list. Receivers can tick off items in Teams, Outlook, or the Loop
// app, and edits propagate back to every shared surface.
//
// Hard-rule compliance:
//   - DA-only (registered as `present-shift-handover-as-loop`).
//   - MCP-sourced (input flows through `mcp-server`'s ServiceNow client).
//   - No "Alex" / "signal-router" / "autonomy" / "foresight" tokens.

import {
  emptyLoopPayload,
  type LoopBlock,
  type LoopComponentPayload,
} from './types.js';

export interface ShiftHandoverLoopIncident {
  number: string;
  shortDescription: string;
  priority: string;
  state: string;
  url?: string;
}

export interface ShiftHandoverLoopChange {
  number: string;
  shortDescription: string;
  window: string;
  url?: string;
}

export interface ShiftHandoverLoopSlaRisk {
  ticketNumber: string;
  slaName: string;
  hoursToBreach: number;
  url?: string;
}

export interface ShiftHandoverLoopAction {
  title: string;
  owner?: string;
  /** Optional ServiceNow link if the action ties to a record. */
  url?: string;
}

export interface ShiftHandoverLoopInput {
  /** Inclusive end of the lookback window (typically `now`). */
  rangeEnd: string;
  /** How many hours back the briefing covers (e.g. 12 overnight). */
  rangeHours: number;
  /** Stable key for re-fetch on share — typically `handover-{rangeEnd}`. */
  referenceId: string;
  incidents: ShiftHandoverLoopIncident[];
  changes: ShiftHandoverLoopChange[];
  slaRisks: ShiftHandoverLoopSlaRisk[];
  actions: ShiftHandoverLoopAction[];
}

/**
 * Build the shift-handover Loop component payload. Pure function; no I/O.
 *
 * Layout (taskList component, top-down):
 *   1. Heading — "Shift handover — last N h ending {time}".
 *   2. Top callout — counts (incidents, changes, SLA risks).
 *   3. Section: Open incidents → table.
 *   4. Section: Changes in window → table.
 *   5. Section: SLA risks → table.
 *   6. Section: Top actions for today → tasks (the co-editable surface).
 */
export function buildShiftHandoverLoop(
  input: ShiftHandoverLoopInput,
): LoopComponentPayload {
  const generatedAt = new Date().toISOString();

  const payload = emptyLoopPayload('taskList', 'Shift handover', {
    system: 'servicenow',
    referenceId: input.referenceId,
    generatedAt,
  });
  payload.subtitle = `Last ${input.rangeHours} h ending ${formatRangeEnd(input.rangeEnd)}`;

  const blocks: LoopBlock[] = [];

  blocks.push({
    type: 'heading',
    level: 1,
    text: `Shift handover — last ${input.rangeHours} h`,
  });

  blocks.push({
    type: 'callout',
    variant: rolloverVariant(input),
    text: buildRolloverText(input),
  });

  blocks.push({ type: 'separator' });

  // Incidents.
  blocks.push({ type: 'heading', level: 2, text: 'Open incidents' });
  if (input.incidents.length === 0) {
    blocks.push({ type: 'paragraph', text: 'No open incidents in window.' });
  } else {
    blocks.push({
      type: 'table',
      headers: ['Number', 'Priority', 'State', 'Short description'],
      rows: input.incidents.map((i) => [
        i.number,
        i.priority,
        i.state,
        i.shortDescription,
      ]),
    });
  }

  // Changes.
  blocks.push({ type: 'heading', level: 2, text: 'Changes in window' });
  if (input.changes.length === 0) {
    blocks.push({ type: 'paragraph', text: 'No scheduled changes in window.' });
  } else {
    blocks.push({
      type: 'table',
      headers: ['Number', 'Window', 'Short description'],
      rows: input.changes.map((c) => [c.number, c.window, c.shortDescription]),
    });
  }

  // SLA risks.
  blocks.push({ type: 'heading', level: 2, text: 'SLA risks' });
  if (input.slaRisks.length === 0) {
    blocks.push({ type: 'paragraph', text: 'No SLAs at risk in the next 4 h.' });
  } else {
    blocks.push({
      type: 'table',
      headers: ['Ticket', 'SLA', 'Hours to breach'],
      rows: input.slaRisks.map((s) => [
        s.ticketNumber,
        s.slaName,
        s.hoursToBreach.toFixed(1),
      ]),
    });
  }

  // Actions — the co-editable surface.
  blocks.push({ type: 'separator' });
  blocks.push({ type: 'heading', level: 2, text: 'Top actions for today' });
  if (input.actions.length === 0) {
    blocks.push({ type: 'paragraph', text: 'No queued actions.' });
  } else {
    for (const action of input.actions) {
      blocks.push({
        type: 'task',
        title: action.title,
        completed: false,
        assignee: action.owner,
        url: action.url,
      });
    }
  }

  payload.blocks = blocks;
  return payload;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatRangeEnd(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function rolloverVariant(
  input: ShiftHandoverLoopInput,
): 'critical' | 'warning' | 'info' | 'success' {
  const p1Or2 = input.incidents.filter(
    (i) => i.priority.toUpperCase() === 'P1' || i.priority.toUpperCase() === 'P2',
  ).length;
  if (p1Or2 > 0) return 'critical';
  if (input.slaRisks.length > 0) return 'warning';
  if (input.incidents.length === 0 && input.changes.length === 0) return 'success';
  return 'info';
}

function buildRolloverText(input: ShiftHandoverLoopInput): string {
  const parts: string[] = [];
  parts.push(`${input.incidents.length} open incident${plural(input.incidents.length)}`);
  parts.push(`${input.changes.length} change${plural(input.changes.length)} in window`);
  parts.push(`${input.slaRisks.length} SLA risk${plural(input.slaRisks.length)}`);
  parts.push(`${input.actions.length} action${plural(input.actions.length)} for today`);
  return parts.join(' · ');
}

function plural(n: number): string {
  return n === 1 ? '' : 's';
}
