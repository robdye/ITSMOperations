// Routine output delivery — renders LLM markdown into a richly-formatted
// HTML email body, a Teams-friendly HTML message, an Adaptive Card summary,
// and (only when the output actually contains a markdown table) a real CSV
// attachment. Replaces the prior approach which generated fake Word/Excel/PPT
// files regardless of whether the output was actually tabular.

export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

export interface RoutineSummary {
  routineId: string;
  description: string;
  worker: string;
  generatedAt: string;
  output: string;
}

// ─────────────────────────── Markdown → HTML ───────────────────────────
//
// A small regex-based renderer covering the subset of GFM that LLMs emit
// for ITSM briefings: headings (#..####), bullet/numbered lists, tables,
// inline `code`, **bold**, *italic*, fenced code blocks and paragraphs.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(line: string): string {
  let out = escapeHtml(line);
  // links: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // bold / italic / code (order matters)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  return out;
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

/**
 * Render a markdown string to HTML. Supports the bits LLMs actually produce
 * for our routines — no extension needed (no katex, no syntax highlighting).
 */
export function renderMarkdownToHtml(markdown: string): string {
  if (!markdown || !markdown.trim()) return '';
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];

  let i = 0;
  let inUl = false;
  let inOl = false;
  let inPara: string[] = [];
  let inCode: string[] | null = null;

  const closeLists = (): void => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };
  const flushPara = (): void => {
    if (inPara.length > 0) {
      out.push(`<p>${inPara.map(renderInline).join('<br/>')}</p>`);
      inPara = [];
    }
  };

  while (i < lines.length) {
    const raw = lines[i];

    // Fenced code block
    if (/^```/.test(raw)) {
      flushPara();
      closeLists();
      if (inCode === null) {
        inCode = [];
      } else {
        out.push(`<pre><code>${escapeHtml(inCode.join('\n'))}</code></pre>`);
        inCode = null;
      }
      i++;
      continue;
    }
    if (inCode !== null) {
      inCode.push(raw);
      i++;
      continue;
    }

    // Table — header row, separator, then body rows
    if (raw.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara();
      closeLists();
      const headers = splitTableRow(raw);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      out.push(renderTableHtml({ headers, rows }));
      continue;
    }

    // Headings
    const heading = /^(#{1,6})\s+(.+)$/.exec(raw);
    if (heading) {
      flushPara();
      closeLists();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // Bullet list
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(raw);
    if (bullet) {
      flushPara();
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${renderInline(bullet[1])}</li>`);
      i++;
      continue;
    }

    // Numbered list
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(raw);
    if (numbered) {
      flushPara();
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${renderInline(numbered[1])}</li>`);
      i++;
      continue;
    }

    // Blank line — end paragraph / list
    if (!raw.trim()) {
      flushPara();
      closeLists();
      i++;
      continue;
    }

    // Plain paragraph line
    closeLists();
    inPara.push(raw);
    i++;
  }

  flushPara();
  closeLists();
  return out.join('\n');
}

function renderTableHtml(t: ParsedTable): string {
  const th = t.headers.map((h) => `<th>${renderInline(h)}</th>`).join('');
  const trs = t.rows
    .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="data-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

// ─────────────────────────── Table extraction ──────────────────────────

/**
 * Extract the first markdown table found in the output. Returns null if no
 * table was emitted by the LLM. Used to decide whether attaching a real
 * CSV adds value — for purely narrative outputs we attach nothing.
 */
export function extractFirstTable(markdown: string): ParsedTable | null {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].includes('|') && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(lines[i]);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') {
        rows.push(splitTableRow(lines[j]));
        j++;
      }
      if (headers.length > 0 && rows.length > 0) {
        return { headers, rows };
      }
    }
  }
  return null;
}

/** Convert a parsed table to RFC-4180 CSV (real Excel-importable). */
export function tableToCsv(table: ParsedTable): string {
  const escape = (s: string): string => {
    const needs = /[",\n\r]/.test(s);
    const v = s.replace(/"/g, '""');
    return needs ? `"${v}"` : v;
  };
  const lines: string[] = [];
  lines.push(table.headers.map(escape).join(','));
  for (const row of table.rows) {
    // Pad/truncate to header length so columns align.
    const padded = [...row];
    while (padded.length < table.headers.length) padded.push('');
    lines.push(padded.slice(0, table.headers.length).map(escape).join(','));
  }
  return lines.join('\n');
}

// ───────────────────────── Branded renderings ──────────────────────────

const EMAIL_CSS = `
  body { margin: 0; padding: 0; background-color: #f4f6fb; font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif; color: #20232a; }
  .container { max-width: 720px; margin: 24px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 24px rgba(35, 58, 110, 0.08); }
  .header { background: linear-gradient(135deg, #4f46e5 0%, #6366f1 50%, #8b5cf6 100%); color: #fff; padding: 28px 32px; }
  .header .eyebrow { text-transform: uppercase; letter-spacing: 1.5px; font-size: 11px; opacity: 0.85; font-weight: 600; }
  .header h1 { margin: 6px 0 0; font-size: 22px; font-weight: 600; line-height: 1.3; }
  .header .meta { margin-top: 14px; font-size: 13px; opacity: 0.92; }
  .body { padding: 28px 32px; line-height: 1.55; font-size: 15px; }
  .body h1, .body h2, .body h3, .body h4 { color: #2d2f3a; margin: 20px 0 10px; }
  .body h1 { font-size: 20px; }
  .body h2 { font-size: 17px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
  .body h3 { font-size: 15px; }
  .body p { margin: 8px 0; }
  .body ul, .body ol { margin: 8px 0; padding-left: 22px; }
  .body li { margin: 4px 0; }
  .body code { background: #eef0f5; padding: 1px 6px; border-radius: 4px; font-size: 13px; }
  .body pre { background: #1f2230; color: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
  .body table.data-table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
  .body table.data-table th { background: #f1f3f9; text-align: left; padding: 8px 10px; border-bottom: 2px solid #d8dbe6; }
  .body table.data-table td { padding: 8px 10px; border-bottom: 1px solid #ecedf2; vertical-align: top; }
  .body table.data-table tr:nth-child(even) td { background: #fafbfd; }
  .footer { padding: 18px 32px 24px; font-size: 12px; color: #6b7280; border-top: 1px solid #eceef3; }
  .footer .pill { display: inline-block; background: #eef2ff; color: #4338ca; padding: 2px 10px; border-radius: 999px; font-weight: 500; }
`.replace(/\s+/g, ' ').trim();

/**
 * Build a polished HTML email body. The body of the LLM output is rendered
 * as Markdown → HTML (so headings/lists/tables come through as real HTML)
 * inside a branded shell.
 */
export function buildEmailHtml(summary: RoutineSummary): string {
  const renderedBody = renderMarkdownToHtml(summary.output);
  const dt = new Date(summary.generatedAt).toUTCString();
  return `<!doctype html>
<html><head><meta charset="utf-8"/><style>${EMAIL_CSS}</style></head><body>
  <div class="container">
    <div class="header">
      <div class="eyebrow">ITSM Operations · Scheduled Routine</div>
      <h1>${escapeHtml(summary.description)}</h1>
      <div class="meta">Routine: <code>${escapeHtml(summary.routineId)}</code> · Worker: ${escapeHtml(summary.worker)} · Generated: ${escapeHtml(dt)}</div>
    </div>
    <div class="body">
      ${renderedBody}
    </div>
    <div class="footer">
      <span class="pill">Auto-delivered by Alex (digital worker)</span>
    </div>
  </div>
</body></html>`;
}

/**
 * Build a Teams channel HTML message. Teams supports a constrained subset
 * of HTML (no <style>, limited formatting) so we inline minimal styles and
 * lean on tables/lists/headings only.
 */
export function buildTeamsHtml(summary: RoutineSummary): string {
  const renderedBody = renderMarkdownToHtml(summary.output);
  return `<div>
  <h2 style="margin:0 0 4px;">${escapeHtml(summary.description)}</h2>
  <div style="font-size:12px;color:#6b7280;">${escapeHtml(summary.routineId)} · ${escapeHtml(summary.worker)} · ${escapeHtml(new Date(summary.generatedAt).toUTCString())}</div>
  <hr/>
  ${renderedBody}
</div>`;
}

// ───────────────────────── Adaptive Card builder ───────────────────────

interface AdaptiveCardLite {
  type: 'AdaptiveCard';
  $schema: string;
  version: string;
  body: unknown[];
  actions?: unknown[];
}

/**
 * Build a compact Adaptive Card summary suitable for Teams or chat embeds.
 * Renders a heading, a short summary block, the first table (if present)
 * as a fact list, and a deep-link action.
 */
export function buildRoutineSummaryCard(summary: RoutineSummary): AdaptiveCardLite {
  const body: unknown[] = [
    { type: 'TextBlock', text: `📡 ${summary.description}`, weight: 'Bolder', size: 'Medium', wrap: true },
    {
      type: 'FactSet',
      facts: [
        { title: 'Routine', value: summary.routineId },
        { title: 'Worker', value: summary.worker },
        { title: 'Generated', value: new Date(summary.generatedAt).toUTCString() },
      ],
    },
    { type: 'TextBlock', text: summarize(summary.output, 600), wrap: true, spacing: 'Medium' },
  ];

  const table = extractFirstTable(summary.output);
  if (table && table.rows.length > 0) {
    body.push({ type: 'TextBlock', text: '**Top entries**', weight: 'Bolder', spacing: 'Medium', wrap: true });
    const max = Math.min(5, table.rows.length);
    for (let i = 0; i < max; i++) {
      const facts = table.headers.map((h, idx) => ({ title: h || `col${idx + 1}`, value: table.rows[i][idx] || '—' }));
      body.push({ type: 'FactSet', facts });
    }
    if (table.rows.length > max) {
      body.push({ type: 'TextBlock', text: `…and ${table.rows.length - max} more`, isSubtle: true, wrap: true });
    }
  }

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.5',
    body,
    actions: [
      { type: 'Action.OpenUrl', title: 'Open Mission Control', url: process.env.MISSION_CONTROL_URL || 'https://itsm-operations-worker.jollysand-88b78b02.eastus.azurecontainerapps.io/mission-control' },
    ],
  };
}

function summarize(text: string, max = 280): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}
