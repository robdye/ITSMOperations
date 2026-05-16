// ITSM Operations — Email rendering helpers
//
// Two problems this module solves:
//   1. LLM-generated content arrives as Markdown (`## headers`, `**bold**`,
//      `- bullets`). Wrapping it in `<pre>` shows the asterisks literally.
//   2. Even when rendered, raw HTML inside an `<html>` doc fails most Outlook
//      clients (CSS stripped, fonts substituted, dark mode inverts colors).
//
// `renderMarkdown(md)` is a small, zero-dependency Markdown → HTML converter
// covering the subset Alex produces (headings, bold, italic, lists, code,
// paragraphs, links). It is intentionally conservative — anything it can't
// parse is rendered as a paragraph.
//
// `renderBriefingEmail({...})` wraps the converted body in an Outlook-tested
// table-based shell with inline CSS, web-safe fonts (Segoe UI / Arial), a
// branded header, and a quiet audit footer. ~600px max width works on
// Outlook 2016+, Outlook for Mac, Outlook for Web, Apple Mail, Gmail.
//
// References for the table layout (Outlook compatibility):
//   - https://www.litmus.com/blog/the-ultimate-guide-to-bulletproof-buttons-in-email-design
//   - https://www.campaignmonitor.com/css/
//   - https://design.email/ — current best-practice templates (2024-25).
//
// No marked/markdown-it dependency: keeps the worker container small and
// avoids a CVE-prone transitive dependency for ~80 LOC of formatting.

// ── Escaping ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Inline markdown ────────────────────────────────────────────────────────

/**
 * Convert inline Markdown to HTML:
 *   `code`  →  <code>code</code>
 *   **bold** / __bold__ → <strong>bold</strong>
 *   *em* / _em_ → <em>em</em>
 *   [text](url) → <a href="url">text</a>
 *
 * Operates on already-HTML-escaped text so the order is safe.
 */
function renderInline(text: string): string {
  let t = escapeHtml(text);
  // Inline code
  t = t.replace(/`([^`\n]+)`/g, '<code style="background:#f3f2f1;padding:1px 4px;border-radius:3px;font-family:Consolas,Menlo,monospace;font-size:13px;">$1</code>');
  // Bold (** or __) — non-greedy
  t = t.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
  // Italic (* or _) — non-greedy, avoid bold remnants
  t = t.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, '$1<em>$2</em>');
  // Links [text](url)
  t = t.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" style="color:#0078d4;text-decoration:underline;">$1</a>');
  return t;
}

// ── Block markdown ─────────────────────────────────────────────────────────

/**
 * Render a Markdown document to HTML using inline CSS suitable for email.
 *
 * Supported blocks: ATX headings (#, ##, ###, ####), bullet lists (-, *),
 * ordered lists (1.), blockquotes (>), fenced code (```), horizontal rules
 * (---), paragraphs. Tables and HTML are pass-through (sanitised via escape).
 */
export function renderMarkdown(md: string): string {
  if (!md || !md.trim()) return '';

  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]): void => {
    if (buf.length === 0) return;
    const text = buf.join(' ').trim();
    if (text) out.push(`<p style="margin:0 0 12px;line-height:1.55;color:#201f1e;">${renderInline(text)}</p>`);
    buf.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      out.push(
        `<pre style="background:#f3f2f1;border-left:3px solid #8a8886;padding:10px 12px;margin:0 0 12px;border-radius:3px;font-family:Consolas,Menlo,monospace;font-size:13px;line-height:1.45;white-space:pre-wrap;color:#201f1e;">${escapeHtml(codeLines.join('\n'))}</pre>`,
      );
      continue;
    }

    // Horizontal rule
    if (/^\s*---+\s*$/.test(line) || /^\s*\*\*\*+\s*$/.test(line)) {
      out.push('<hr style="border:0;border-top:1px solid #e1dfdd;margin:16px 0;" />');
      i++;
      continue;
    }

    // Heading
    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = renderInline(h[2].trim());
      const styles: Record<number, string> = {
        1: 'font-size:22px;font-weight:600;color:#0078d4;margin:18px 0 10px;line-height:1.3;',
        2: 'font-size:18px;font-weight:600;color:#106ebe;margin:16px 0 8px;line-height:1.3;border-bottom:1px solid #e1dfdd;padding-bottom:4px;',
        3: 'font-size:15px;font-weight:600;color:#201f1e;margin:14px 0 6px;line-height:1.3;',
        4: 'font-size:13px;font-weight:600;color:#605e5c;margin:12px 0 4px;line-height:1.3;text-transform:uppercase;letter-spacing:0.4px;',
      };
      out.push(`<h${level} style="${styles[level]}">${text}</h${level}>`);
      i++;
      continue;
    }

    // Unordered list (group consecutive lines)
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      out.push('<ul style="margin:0 0 12px;padding-left:22px;color:#201f1e;line-height:1.55;">');
      for (const it of items) out.push(`<li style="margin:2px 0;">${renderInline(it)}</li>`);
      out.push('</ul>');
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push('<ol style="margin:0 0 12px;padding-left:24px;color:#201f1e;line-height:1.55;">');
      for (const it of items) out.push(`<li style="margin:2px 0;">${renderInline(it)}</li>`);
      out.push('</ol>');
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const qLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        qLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(
        `<blockquote style="margin:0 0 12px;padding:8px 14px;border-left:3px solid #0078d4;background:#f3f9fd;color:#201f1e;line-height:1.55;">${renderInline(qLines.join(' '))}</blockquote>`,
      );
      continue;
    }

    // Blank line → flush
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph (multi-line)
    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,4}\s|[-*+]\s|\d+\.\s|>\s|---|```)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    flushParagraph(buf);
  }

  return out.join('\n');
}

// ── Email shell ────────────────────────────────────────────────────────────

export interface BriefingEmailOptions {
  /** Big band title shown at the top, e.g. "Shift Handover Briefing". */
  title: string;
  /** Smaller subtitle under the title, e.g. "13:00 → 21:00 EST". */
  subtitle?: string;
  /** Markdown body — converted to clean HTML. */
  markdown: string;
  /** Optional KPI tiles to show under the header (max 4). */
  kpis?: Array<{ label: string; value: string | number }>;
  /** Accent color band. Defaults to ITSM blue. */
  accent?: string;
  /** Optional emoji rendered before the title. */
  emoji?: string;
  /** Footer note — usually an audit / run id. */
  footerNote?: string;
  /**
   * Call-to-action buttons rendered below the markdown body as a proper
   * Outlook-safe bulletproof button row. Use this for approve/deny links —
   * NEVER embed raw `<a>` tags inside the markdown, those will be HTML-escaped
   * by renderMarkdown and show up as literal `<a href=…>` text in the email.
   */
  ctaButtons?: Array<{ label: string; url: string; accent?: string }>;
}

/**
 * Wrap a Markdown body in a professional, Outlook-compatible HTML email
 * shell with brand band, KPI tiles, and audit footer.
 *
 * Layout uses tables (not flex/grid) so it renders identically in Outlook
 * 2016, Outlook for Mac, Outlook for Web, Apple Mail, Gmail, and Teams.
 */
export function renderBriefingEmail(opts: BriefingEmailOptions): string {
  const accent = opts.accent || '#0078d4';
  const body = renderMarkdown(opts.markdown);
  const emoji = opts.emoji ? `${opts.emoji} ` : '';
  const subtitle = opts.subtitle
    ? `<div style="font-size:13px;opacity:0.92;margin-top:4px;">${escapeHtml(opts.subtitle)}</div>`
    : '';

  const kpiCells = (opts.kpis || []).slice(0, 4).map(k => `
    <td valign="top" style="padding:0 6px;width:25%;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf9f8;border:1px solid #edebe9;border-radius:6px;">
        <tr><td align="center" style="padding:12px 8px;">
          <div style="font-size:22px;font-weight:700;color:${accent};line-height:1.1;">${escapeHtml(String(k.value))}</div>
          <div style="font-size:11px;color:#605e5c;margin-top:4px;text-transform:uppercase;letter-spacing:0.4px;">${escapeHtml(k.label)}</div>
        </td></tr>
      </table>
    </td>`).join('');

  const kpiRow = opts.kpis && opts.kpis.length > 0 ? `
    <tr>
      <td style="padding:0 24px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>${kpiCells}</tr>
        </table>
      </td>
    </tr>` : '';

  const footerNote = opts.footerNote
    ? `<div style="margin-top:6px;color:#a19f9d;">${escapeHtml(opts.footerNote)}</div>`
    : '';

  // ── CTA buttons (Outlook-safe table-based button row) ─────────────────────
  // Rendered AFTER the markdown body so the HTML is never escaped by
  // renderMarkdown. Each button is wrapped in a single-cell table for
  // pixel-perfect Outlook rendering (Word engine refuses to honour padding
  // on inline-block <a> on its own).
  const ctaButtons = (opts.ctaButtons || []).slice(0, 4);
  const ctaCells = ctaButtons.map((b) => {
    const bg = b.accent || accent;
    return `
              <td style="padding:0 6px 0 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" bgcolor="${bg}" style="border-radius:4px;">
                      <a href="${escapeHtml(b.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 22px;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:4px;background:${bg};">${escapeHtml(b.label)}</a>
                    </td>
                  </tr>
                </table>
              </td>`;
  }).join('');
  const ctaRow = ctaButtons.length > 0 ? `
          <tr>
            <td style="padding:4px 24px 18px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>${ctaCells}</tr>
              </table>
            </td>
          </tr>` : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f2f1;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#201f1e;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f2f1;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);overflow:hidden;">
          <tr>
            <td style="background:${accent};color:#ffffff;padding:18px 24px;">
              <div style="font-size:20px;font-weight:600;line-height:1.2;">${emoji}${escapeHtml(opts.title)}</div>
              ${subtitle}
            </td>
          </tr>
          ${kpiRow}
          <tr>
            <td style="padding:8px 24px 4px;">
              ${body}
            </td>
          </tr>
          ${ctaRow}
          <tr>
            <td style="padding:14px 24px 20px;border-top:1px solid #edebe9;font-size:11px;color:#8a8886;line-height:1.5;">
              <div>Generated by Alex — ITSM Operations Digital Worker · ${escapeHtml(new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }))} ET</div>
              ${footerNote}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
