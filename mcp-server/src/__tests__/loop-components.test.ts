import { describe, it, expect } from 'vitest';
import { buildCabPackLoop, type CabPackLoopChange } from '../loop-components/cab-pack.js';
import { buildOutcomeStoryLoop } from '../loop-components/outcome-story.js';
import { buildShiftHandoverLoop } from '../loop-components/shift-handover.js';
import type { LoopBlock } from '../loop-components/types.js';

const sampleChange = (overrides: Partial<CabPackLoopChange> = {}): CabPackLoopChange => ({
  number: 'CHG0001234',
  shortDescription: 'Patch SQL servers',
  type: 'Normal',
  ci: 'sql-prod-01',
  window: 'Sat 10:00',
  recommendation: 'approve',
  reason: 'Low risk and within standard window',
  riskScore: 12,
  upstream: 'Service users',
  downstream: 'sql-prod-01',
  url: 'https://example.service-now.com/change_request.do?sys_id=abc',
  nist: ['CM-3'],
  ...overrides,
});

describe('buildCabPackLoop', () => {
  it('emits a Microsoft.Loop.Component page payload with title, attendees and source', () => {
    const payload = buildCabPackLoop({
      cabDate: '2025-01-30T10:00:00Z',
      attendees: ['Change Manager', 'Security'],
      changes: [sampleChange()],
      referenceId: 'cab-2025-01-30',
    });
    expect(payload.type).toBe('Microsoft.Loop.Component');
    expect(payload.version).toBe('1.0');
    expect(payload.componentType).toBe('page');
    expect(payload.title).toMatch(/(CAB|Change Advisory Board) pack/i);
    expect(payload.permissions).toEqual({ edit: true, share: true });
    expect(payload.source.system).toBe('servicenow');
    expect(payload.source.referenceId).toBe('cab-2025-01-30');
    expect(payload.source.generatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('includes a recommendation summary callout reflecting approve/defer/reject counts', () => {
    const payload = buildCabPackLoop({
      cabDate: '2025-01-30T10:00:00Z',
      attendees: ['Change Manager'],
      changes: [
        sampleChange({ number: 'CHG1', recommendation: 'approve' }),
        sampleChange({ number: 'CHG2', recommendation: 'defer' }),
        sampleChange({ number: 'CHG3', recommendation: 'reject' }),
      ],
      referenceId: 'cab',
    });
    const callouts = payload.blocks.filter((b): b is Extract<LoopBlock, { type: 'callout' }> => b.type === 'callout');
    expect(callouts.length).toBeGreaterThan(0);
    const summary = callouts[0].text;
    expect(summary).toMatch(/3 total/i);
    expect(summary).toMatch(/1.*approve/i);
    expect(summary).toMatch(/1.*defer/i);
    expect(summary).toMatch(/1.*reject/i);
  });

  it('emits a per-change heading + table + recommendation callout group', () => {
    const payload = buildCabPackLoop({
      cabDate: '2025-01-30T10:00:00Z',
      attendees: ['Change Manager'],
      changes: [sampleChange({ number: 'CHG0009999' })],
      referenceId: 'cab',
    });
    const headings = payload.blocks.filter((b): b is Extract<LoopBlock, { type: 'heading' }> => b.type === 'heading');
    expect(headings.some((h) => h.text.includes('CHG0009999'))).toBe(true);
    expect(payload.blocks.some((b) => b.type === 'table')).toBe(true);
  });

  it('includes a "Vote and finalise" task block for the Change Manager', () => {
    const payload = buildCabPackLoop({
      cabDate: '2025-01-30T10:00:00Z',
      attendees: ['Change Manager'],
      changes: [sampleChange()],
      referenceId: 'cab',
    });
    const tasks = payload.blocks.filter((b): b is Extract<LoopBlock, { type: 'task' }> => b.type === 'task');
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.some((t) => /vote|finalise/i.test(t.title))).toBe(true);
    expect(tasks.some((t) => /Change Manager/i.test(t.assignee || ''))).toBe(true);
  });
});

describe('buildOutcomeStoryLoop', () => {
  it('emits a newsCard component with hero callout reflecting resolution time', () => {
    const payload = buildOutcomeStoryLoop({
      number: 'INC0010042',
      headline: 'Payments API timing out',
      priority: 'P1',
      state: 'Resolved',
      affectedCi: 'payments-api',
      assignedTo: 'Sam Patel',
      openedAt: '2025-01-29T08:00:00Z',
      resolvedAt: '2025-01-29T08:30:00Z',
      resolutionMinutes: 30,
      resolutionCaption: 'Resolved in under an hour.',
      story: ['At 08:00 the team was paged.'],
      timeline: [{ time: '08:00', text: 'Paged', severity: 'critical' }],
      url: 'https://example.service-now.com/incident.do?sys_id=abc',
    });
    expect(payload.componentType).toBe('newsCard');
    expect(payload.title).toContain('INC0010042');
    const callouts = payload.blocks.filter((b): b is Extract<LoopBlock, { type: 'callout' }> => b.type === 'callout');
    // hero callout should contain the resolution time and use success variant
    expect(callouts.some((c) => c.variant === 'success' && /30 min/i.test(c.text))).toBe(true);
  });

  it('uses warning variant when the incident is still in progress', () => {
    const payload = buildOutcomeStoryLoop({
      number: 'INC0010099',
      headline: 'Database lag',
      priority: 'P2',
      state: 'In Progress',
      openedAt: '2025-01-29T08:00:00Z',
      resolutionMinutes: null,
      story: [],
      timeline: [],
    });
    const callouts = payload.blocks.filter((b): b is Extract<LoopBlock, { type: 'callout' }> => b.type === 'callout');
    expect(callouts.some((c) => c.variant === 'warning')).toBe(true);
  });

  it('renders a numbered timeline list', () => {
    const payload = buildOutcomeStoryLoop({
      number: 'INC1',
      headline: 'x',
      priority: 'P3',
      state: 'Resolved',
      openedAt: '2025-01-29T08:00:00Z',
      resolutionMinutes: 5,
      story: [],
      timeline: [
        { time: '08:00', text: 'Opened', severity: 'critical' },
        { time: '08:05', text: 'Resolved', severity: 'success' },
      ],
    });
    const lists = payload.blocks.filter((b): b is Extract<LoopBlock, { type: 'numberedList' }> => b.type === 'numberedList');
    expect(lists.length).toBeGreaterThan(0);
    expect(lists[0].items.length).toBe(2);
    expect(lists[0].items[0]).toMatch(/Opened/);
  });
});

describe('buildShiftHandoverLoop', () => {
  it('emits a taskList component covering the look-back window', () => {
    const payload = buildShiftHandoverLoop({
      rangeEnd: '2025-01-30T07:00:00Z',
      rangeHours: 12,
      referenceId: 'handover-2025-01-30',
      incidents: [
        { number: 'INC1', shortDescription: 'API down', priority: 'P1', state: 'In Progress' },
      ],
      changes: [
        { number: 'CHG1', shortDescription: 'Patch', window: 'Sat 10:00' },
      ],
      slaRisks: [
        { ticketNumber: 'INC1', slaName: 'P1 resolution', hoursToBreach: 0.5 },
      ],
      actions: [
        { title: 'Drive INC1 to resolution', owner: 'Ops' },
        { title: 'Confirm CAB position on CHG1', owner: 'Change' },
      ],
    });
    expect(payload.componentType).toBe('taskList');
    expect(payload.title).toMatch(/handover/i);
    // rollover callout in the page header.
    const callouts = payload.blocks.filter((b): b is Extract<LoopBlock, { type: 'callout' }> => b.type === 'callout');
    expect(callouts.length).toBeGreaterThan(0);
    // tasks for "Top actions for today".
    const tasks = payload.blocks.filter((b): b is Extract<LoopBlock, { type: 'task' }> => b.type === 'task');
    expect(tasks.length).toBe(2);
    expect(tasks[0].title).toMatch(/INC1/);
    expect(tasks[0].assignee).toBe('Ops');
  });

  it('renders three tables (incidents, changes, SLA risks) when all are present', () => {
    const payload = buildShiftHandoverLoop({
      rangeEnd: '2025-01-30T07:00:00Z',
      rangeHours: 12,
      referenceId: 'h',
      incidents: [{ number: 'INC1', shortDescription: 'x', priority: 'P1', state: 'New' }],
      changes: [{ number: 'CHG1', shortDescription: 'y', window: 'TBC' }],
      slaRisks: [{ ticketNumber: 'INC1', slaName: 'P1', hoursToBreach: 1 }],
      actions: [],
    });
    const tables = payload.blocks.filter((b): b is Extract<LoopBlock, { type: 'table' }> => b.type === 'table');
    expect(tables.length).toBe(3);
  });

  it('omits empty sections gracefully (no incidents → no incidents table)', () => {
    const payload = buildShiftHandoverLoop({
      rangeEnd: '2025-01-30T07:00:00Z',
      rangeHours: 12,
      referenceId: 'h',
      incidents: [],
      changes: [],
      slaRisks: [],
      actions: [],
    });
    expect(payload.blocks.filter((b) => b.type === 'table').length).toBe(0);
  });
});

describe('Loop component contract — applies to every generator', () => {
  it.each([
    [
      'cab-pack',
      () => buildCabPackLoop({ cabDate: '2025-01-30T10:00:00Z', attendees: [], changes: [], referenceId: 'r' }),
    ],
    [
      'outcome-story',
      () => buildOutcomeStoryLoop({
        number: 'INC1', headline: 'x', priority: 'P1', state: 'Resolved',
        openedAt: '2025-01-29T08:00:00Z', resolutionMinutes: 5, story: [], timeline: [],
      }),
    ],
    [
      'shift-handover',
      () => buildShiftHandoverLoop({
        rangeEnd: '2025-01-30T07:00:00Z', rangeHours: 12, referenceId: 'r',
        incidents: [], changes: [], slaRisks: [], actions: [],
      }),
    ],
  ])('%s payload conforms to the Loop component shape', (_label, build) => {
    const payload = build();
    expect(payload.type).toBe('Microsoft.Loop.Component');
    expect(payload.version).toBe('1.0');
    expect(['page', 'taskList', 'newsCard']).toContain(payload.componentType);
    expect(payload.permissions).toEqual({ edit: true, share: true });
    expect(payload.source.system).toBe('servicenow');
    expect(typeof payload.source.referenceId).toBe('string');
    expect(typeof payload.source.generatedAt).toBe('string');
    expect(Array.isArray(payload.blocks)).toBe(true);
    expect(typeof payload.title).toBe('string');
    expect(payload.title.length).toBeGreaterThan(0);
  });
});
