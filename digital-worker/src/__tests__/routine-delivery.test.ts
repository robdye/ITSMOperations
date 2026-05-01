import { describe, it, expect } from 'vitest';
import {
  renderMarkdownToHtml,
  extractFirstTable,
  tableToCsv,
  buildEmailHtml,
  buildTeamsHtml,
  buildRoutineSummaryCard,
} from '../routine-delivery';

const sampleSummary = {
  routineId: 'vendor-contract-expiry',
  description: 'Weekly contract expiry check (30/60/90 day windows)',
  worker: 'vendor-manager',
  generatedAt: '2025-11-20T08:00:00.000Z',
  output: '',
};

describe('renderMarkdownToHtml', () => {
  it('renders headings, bold and lists', () => {
    const html = renderMarkdownToHtml('# Title\n\n**Bold** text\n\n- item one\n- item two');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>item one</li>');
    expect(html).toContain('<li>item two</li>');
  });

  it('renders numbered lists', () => {
    const html = renderMarkdownToHtml('1. first\n2. second');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>first</li>');
    expect(html).toContain('<li>second</li>');
  });

  it('renders markdown tables to <table>', () => {
    const md = [
      '| Vendor | Days |',
      '| --- | --- |',
      '| Acme | 12 |',
      '| Globex | 45 |',
    ].join('\n');
    const html = renderMarkdownToHtml(md);
    expect(html).toContain('<table');
    expect(html).toContain('<th>Vendor</th>');
    expect(html).toContain('<td>Acme</td>');
    expect(html).toContain('<td>45</td>');
  });

  it('escapes raw html input', () => {
    const html = renderMarkdownToHtml('Hello <script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('extractFirstTable / tableToCsv', () => {
  it('returns null when no table is present', () => {
    expect(extractFirstTable('Just narrative prose with no tables.')).toBeNull();
  });

  it('extracts a table and converts to CSV', () => {
    const md = [
      'Some lead-in text.',
      '',
      '| Asset | Status |',
      '| --- | --- |',
      '| Server-1 | RED |',
      '| Server-2 | YELLOW |',
    ].join('\n');
    const t = extractFirstTable(md);
    expect(t).not.toBeNull();
    expect(t!.headers).toEqual(['Asset', 'Status']);
    expect(t!.rows.length).toBe(2);
    const csv = tableToCsv(t!);
    expect(csv.split('\n')[0]).toBe('Asset,Status');
    expect(csv).toContain('Server-1,RED');
  });

  it('CSV-quotes values containing commas or quotes', () => {
    const csv = tableToCsv({
      headers: ['Name', 'Note'],
      rows: [['Acme, Inc.', 'Says "hi"']],
    });
    expect(csv).toContain('"Acme, Inc.","Says ""hi"""');
  });
});

describe('buildEmailHtml', () => {
  it('produces a complete HTML email with branded shell', () => {
    const html = buildEmailHtml({ ...sampleSummary, output: '## Highlights\n\n- One\n- Two' });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Weekly contract expiry check');
    expect(html).toContain('vendor-contract-expiry');
    expect(html).toContain('<h2>Highlights</h2>');
    expect(html).toContain('<li>One</li>');
  });
});

describe('buildTeamsHtml', () => {
  it('produces a compact HTML message with metadata + body', () => {
    const html = buildTeamsHtml({ ...sampleSummary, output: '# Summary\n\nNothing to flag this week.' });
    expect(html).toContain('Weekly contract expiry check');
    expect(html).toContain('vendor-manager');
    expect(html).toContain('<h1>Summary</h1>');
  });
});

describe('buildRoutineSummaryCard', () => {
  it('returns an Adaptive Card with the routine metadata', () => {
    const card = buildRoutineSummaryCard({ ...sampleSummary, output: 'Brief output text.' });
    expect(card.type).toBe('AdaptiveCard');
    expect(Array.isArray(card.body)).toBe(true);
    const firstBlock = card.body[0] as { text: string };
    expect(firstBlock.text).toContain('Weekly contract expiry check');
  });

  it('includes top entries when output contains a table', () => {
    const tableMd = [
      'Lead-in.',
      '',
      '| ID | Owner |',
      '| --- | --- |',
      '| C1 | Alice |',
      '| C2 | Bob |',
    ].join('\n');
    const card = buildRoutineSummaryCard({ ...sampleSummary, output: tableMd });
    const json = JSON.stringify(card);
    expect(json).toContain('Top entries');
    expect(json).toContain('Alice');
    expect(json).toContain('Bob');
  });
});
