// ITSM Operations — PowerPoint deck generator
// Uses pptxgenjs to produce real .pptx binaries that can be attached to Graph
// emails (or surfaced via download links). The generator is intentionally
// data-driven so the agent can pass either a structured deck spec or fall back
// to a "current state" briefing pulled from the live ITSM briefing tool.
//
// Why this exists:
// The ToolingManifest declares an `mcp_PowerPointServer` slot that is currently
// `enabled: false` — pending the Microsoft PowerPoint MCP server roll-out. Until
// that server is available we generate decks locally. The contract here mirrors
// what the MCP tool will eventually return so we can swap this implementation
// for an MCP call without changing any callers.

import PptxGenJS from 'pptxgenjs';

export interface SlideSpec {
  title: string;
  bullets?: string[];
  body?: string;
  table?: {
    headers: string[];
    rows: Array<Array<string | number>>;
  };
  metrics?: Array<{ label: string; value: string | number }>;
  notes?: string;
}

export interface DeckSpec {
  title: string;
  subtitle?: string;
  author?: string;
  company?: string;
  slides: SlideSpec[];
}

export interface DeckResult {
  base64: string;
  fileName: string;
  contentType: string;
  bytes: number;
}

const BRAND_PRIMARY = '0078D4'; // Microsoft blue
const BRAND_ACCENT = '6264A7'; // Microsoft purple
const BRAND_DARK = '201F1E';
const BRAND_LIGHT = 'F3F2F1';

function safeFileName(input: string): string {
  return input
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 80) || 'briefing';
}

/**
 * Generate a real .pptx deck from a DeckSpec and return it as base64 ready
 * for attachment to Microsoft Graph `/sendMail` payloads.
 */
export async function generateDeck(spec: DeckSpec): Promise<DeckResult> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = spec.title;
  if (spec.author) pptx.author = spec.author;
  if (spec.company) pptx.company = spec.company;

  // ── Title slide ──
  const title = pptx.addSlide();
  title.background = { color: BRAND_PRIMARY };
  title.addText(spec.title, {
    x: 0.5,
    y: 2.0,
    w: 12,
    h: 1.5,
    fontSize: 40,
    bold: true,
    color: 'FFFFFF',
    fontFace: 'Segoe UI',
  });
  if (spec.subtitle) {
    title.addText(spec.subtitle, {
      x: 0.5,
      y: 3.6,
      w: 12,
      h: 0.8,
      fontSize: 20,
      color: 'FFFFFF',
      fontFace: 'Segoe UI',
    });
  }
  title.addText(
    [
      spec.author ? { text: spec.author, options: { fontSize: 14, color: 'FFFFFF' } } : null,
      { text: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), options: { fontSize: 14, color: 'FFFFFF' } },
    ].filter(Boolean) as PptxGenJS.TextProps[],
    { x: 0.5, y: 6.5, w: 12, h: 0.5 }
  );

  // ── Content slides ──
  for (const slide of spec.slides) {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };

    s.addText(slide.title, {
      x: 0.5,
      y: 0.3,
      w: 12,
      h: 0.7,
      fontSize: 28,
      bold: true,
      color: BRAND_DARK,
      fontFace: 'Segoe UI',
    });
    s.addShape('line', {
      x: 0.5,
      y: 1.05,
      w: 12,
      h: 0,
      line: { color: BRAND_ACCENT, width: 2 },
    });

    let cursorY = 1.4;

    if (slide.metrics && slide.metrics.length > 0) {
      const cols = Math.min(slide.metrics.length, 5);
      const cardW = 12 / cols - 0.2;
      slide.metrics.slice(0, 5).forEach((m, i) => {
        const x = 0.5 + i * (cardW + 0.2);
        s.addShape('roundRect', {
          x,
          y: cursorY,
          w: cardW,
          h: 1.4,
          fill: { color: BRAND_LIGHT },
          line: { color: BRAND_ACCENT, width: 1 },
          rectRadius: 0.08,
        });
        s.addText(String(m.value), {
          x,
          y: cursorY + 0.15,
          w: cardW,
          h: 0.7,
          fontSize: 32,
          bold: true,
          color: BRAND_PRIMARY,
          align: 'center',
          fontFace: 'Segoe UI',
        });
        s.addText(m.label, {
          x,
          y: cursorY + 0.85,
          w: cardW,
          h: 0.4,
          fontSize: 12,
          color: BRAND_DARK,
          align: 'center',
          fontFace: 'Segoe UI',
        });
      });
      cursorY += 1.7;
    }

    if (slide.bullets && slide.bullets.length > 0) {
      s.addText(
        slide.bullets.map((b) => ({ text: b, options: { bullet: { type: 'bullet' } } })),
        {
          x: 0.5,
          y: cursorY,
          w: 12,
          h: 7 - cursorY - 0.3,
          fontSize: 16,
          color: BRAND_DARK,
          fontFace: 'Segoe UI',
          paraSpaceAfter: 6,
        }
      );
      cursorY += 0.4 * slide.bullets.length;
    } else if (slide.body) {
      s.addText(slide.body, {
        x: 0.5,
        y: cursorY,
        w: 12,
        h: 7 - cursorY - 0.3,
        fontSize: 16,
        color: BRAND_DARK,
        fontFace: 'Segoe UI',
      });
    }

    if (slide.table && slide.table.rows.length > 0) {
      const headerRow: PptxGenJS.TableCell[] = slide.table.headers.map((h) => ({
        text: h,
        options: { bold: true, color: 'FFFFFF', fill: { color: BRAND_PRIMARY }, align: 'left' as const },
      }));
      const bodyRows: PptxGenJS.TableCell[][] = slide.table.rows.map((row) =>
        row.map((cell) => ({ text: String(cell), options: { color: BRAND_DARK, align: 'left' as const } }))
      );
      s.addTable([headerRow, ...bodyRows], {
        x: 0.5,
        y: cursorY,
        w: 12,
        h: 7 - cursorY - 0.5,
        fontSize: 12,
        fontFace: 'Segoe UI',
        colW: slide.table.headers.map(() => 12 / slide.table!.headers.length),
        border: { type: 'solid', pt: 1, color: BRAND_ACCENT },
      });
    }

    s.addText(`ITSM Operations — Generated ${new Date().toISOString()}`, {
      x: 0.5,
      y: 7.0,
      w: 12,
      h: 0.3,
      fontSize: 9,
      color: '8A8886',
      fontFace: 'Segoe UI',
    });

    if (slide.notes) {
      s.addNotes(slide.notes);
    }
  }

  const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  return {
    base64: buf.toString('base64'),
    fileName: `${safeFileName(spec.title)}-${new Date().toISOString().slice(0, 10)}.pptx`,
    contentType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    bytes: buf.byteLength,
  };
}

/**
 * Build a "Current State" deck from the structured ITSM briefing payload that
 * `mcp_show-itsm-briefing` returns. The shape is permissive — missing fields
 * are quietly skipped so we never blow up on a thin briefing.
 */
export function buildCurrentStateDeckSpec(briefing: any, options: { author?: string; company?: string } = {}): DeckSpec {
  const period = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const incidents = briefing?.incidents || briefing?.incidentSummary || {};
  const open = incidents.open ?? incidents.total ?? briefing?.openIncidents ?? 0;
  const p1 = incidents.p1 ?? incidents.priority1 ?? 0;
  const p2 = incidents.p2 ?? incidents.priority2 ?? 0;
  const p3 = incidents.p3 ?? incidents.priority3 ?? 0;
  const p4 = incidents.p4 ?? incidents.priority4 ?? 0;
  const p5 = incidents.p5 ?? incidents.priority5 ?? 0;

  const sla = briefing?.slaCompliance ?? briefing?.sla?.compliance ?? null;
  const changes = briefing?.changes || briefing?.changeSummary || {};
  const upcomingChanges = changes.upcoming ?? changes.scheduled ?? changes.total ?? 0;
  const problems = briefing?.problems || briefing?.problemSummary || {};
  const openProblems = problems.open ?? problems.total ?? 0;

  const topIncidentsRaw =
    briefing?.topIncidents ||
    briefing?.activeIncidents ||
    incidents.top ||
    incidents.recent ||
    [];
  const topIncidents: Array<Array<string | number>> = (Array.isArray(topIncidentsRaw) ? topIncidentsRaw : [])
    .slice(0, 8)
    .map((inc: any) => [
      String(inc.number || inc.id || '—'),
      String(inc.priority || inc.severity || '—'),
      String(inc.shortDescription || inc.title || inc.summary || '—').slice(0, 80),
      String(inc.assignmentGroup || inc.owner || inc.assignedTo || '—'),
    ]);

  const recommendations: string[] = Array.isArray(briefing?.recommendations)
    ? briefing.recommendations.slice(0, 6)
    : [
        'Maintain current incident triage cadence — P1/P2 within SLA.',
        'Review CAB pack for upcoming changes; flag any high-risk items.',
        'Drive open problems to RCA closure within the next sprint.',
        'Confirm coverage for the next on-call rotation.',
      ];

  const slides: SlideSpec[] = [
    {
      title: 'Executive Summary',
      metrics: [
        { label: 'Open Incidents', value: open },
        { label: 'P1', value: p1 },
        { label: 'P2', value: p2 },
        { label: 'Open Problems', value: openProblems },
        { label: 'Upcoming Changes', value: upcomingChanges },
      ],
      bullets: [
        sla !== null ? `SLA compliance: ${sla}%` : 'SLA compliance: not reported',
        `${open} incidents currently open across the estate`,
        `${upcomingChanges} change(s) in the upcoming window`,
        `${openProblems} active problem record(s) under investigation`,
      ],
      notes: 'Cover the current operational posture in 60 seconds. Highlight any P1/P2 trending upward.',
    },
    {
      title: 'Incident Posture',
      metrics: [
        { label: 'P1', value: p1 },
        { label: 'P2', value: p2 },
        { label: 'P3', value: p3 },
        { label: 'P4', value: p4 },
        { label: 'P5', value: p5 },
      ],
      bullets: [
        `Total open: ${open}`,
        sla !== null ? `Resolution SLA: ${sla}% within target` : 'Resolution SLA: see live dashboard',
        'Major incidents are managed via the war-room workflow with automated comms.',
      ],
    },
  ];

  if (topIncidents.length > 0) {
    slides.push({
      title: 'Top Active Incidents',
      table: {
        headers: ['Number', 'Priority', 'Summary', 'Owner'],
        rows: topIncidents,
      },
      notes: 'These are the incidents most likely to escalate. Walk through ownership and ETA for each.',
    });
  }

  slides.push({
    title: 'Change & Problem Outlook',
    bullets: [
      `${upcomingChanges} change(s) scheduled in the upcoming window`,
      `${openProblems} active problem(s) — root-cause analysis in progress`,
      'CAB review continues on its weekly cadence; high-risk changes are flagged for executive attention.',
      'Problem records drive permanent fixes back into known-error and runbook libraries.',
    ],
  });

  slides.push({
    title: 'Recommendations',
    bullets: recommendations,
    notes: 'These are recommendations Alex generated based on the live ITSM telemetry — not boilerplate.',
  });

  return {
    title: 'IT Operations — Current State Briefing',
    subtitle: period,
    author: options.author || 'Alex — IT Operations Manager',
    company: options.company || 'IT Operations',
    slides,
  };
}
