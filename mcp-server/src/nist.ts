// ITSM Operations — NIST risk & framework helpers
//
// Single source of truth for risk scoring and framework alignment used by
// both Alex (voice) and the Declarative Agent (chat). Aligns to:
//
//   • NIST SP 800-30 r1 — Guide for Conducting Risk Assessments
//     5×5 likelihood × impact matrix → severity bands.
//
//   • FIPS 199 — Standards for Security Categorization of Federal
//     Information and Information Systems. Categorize a system by the
//     potential impact (Low / Moderate / High) on Confidentiality,
//     Integrity, and Availability. The system's overall categorization
//     is the HIGH WATER MARK across C/I/A.
//
//   • NIST CSF 2.0 (Feb 2024) — six core Functions:
//     Govern, Identify, Protect, Detect, Respond, Recover.
//
//   • NIST SP 800-37 r2 (RMF) — seven steps:
//     Prepare, Categorize, Select, Implement, Assess, Authorize, Monitor.
//
// Everything below is deliberately framework-only. No live data, no env,
// no I/O — safe to import from any package.

// ── NIST SP 800-30: 5×5 risk matrix ────────────────────────────────────

export type NistLevel = 'Very Low' | 'Low' | 'Moderate' | 'High' | 'Very High';

export const NIST_LEVELS: NistLevel[] = ['Very Low', 'Low', 'Moderate', 'High', 'Very High'];

/** SP 800-30 Appendix I — qualitative-to-quantitative mapping. */
export const NIST_LEVEL_VALUE: Record<NistLevel, number> = {
  'Very Low': 1,
  Low: 2,
  Moderate: 3,
  High: 4,
  'Very High': 5,
};

/** Display colours mirroring the SP 800-30 stoplight palette. */
export const NIST_LEVEL_COLOR: Record<NistLevel, string> = {
  'Very Low': '#2e7d32', // green
  Low: '#7cb342',         // light green
  Moderate: '#f9a825',    // amber
  High: '#ef6c00',        // orange
  'Very High': '#c62828', // red
};

/**
 * SP 800-30 Table I-2: combined likelihood × impact matrix.
 * Rows = likelihood (VL → VH), columns = impact (VL → VH). Returns the
 * resulting overall risk level.
 */
const NIST_MATRIX: NistLevel[][] = [
  // Impact:    VL          L           M             H           VH
  /* VL  */ ['Very Low', 'Very Low', 'Very Low',   'Low',       'Low'],
  /* L   */ ['Very Low', 'Low',      'Low',        'Low',       'Moderate'],
  /* M   */ ['Very Low', 'Low',      'Moderate',   'Moderate',  'High'],
  /* H   */ ['Low',      'Moderate', 'Moderate',   'High',      'Very High'],
  /* VH  */ ['Low',      'Moderate', 'High',       'Very High', 'Very High'],
];

export interface NistRiskAssessment {
  /** Overall risk level per SP 800-30 (Very Low → Very High). */
  level: NistLevel;
  /** Numeric risk value 1..5 mirroring the level for sorting / filtering. */
  value: number;
  /** Likelihood input. */
  likelihood: NistLevel;
  /** Impact input. */
  impact: NistLevel;
  /** Matrix product: likelihood × impact (1..25) — useful for legacy displays. */
  rawScore: number;
  /** Stoplight colour. */
  color: string;
  /** ITIL change pathway implied by the risk level. */
  changePathway: string;
  /** Approval authority appropriate for this risk level. */
  approvalAuthority: string;
  /** SP 800-53 controls most relevant for governance of this risk. */
  controls: string[];
  /** NIST CSF 2.0 functions this risk most strongly engages. */
  csfFunctions: NistCsfFunction[];
  /** Rendered short label, e.g. "Moderate (3·H × 4·H = High)". */
  label: string;
}

/** Compute an SP 800-30 risk level from likelihood + impact qualitatives. */
export function assessRisk(likelihood: NistLevel, impact: NistLevel): NistRiskAssessment {
  const li = NIST_LEVEL_VALUE[likelihood] - 1;
  const ii = NIST_LEVEL_VALUE[impact] - 1;
  const level = NIST_MATRIX[li][ii];
  const rawScore = NIST_LEVEL_VALUE[likelihood] * NIST_LEVEL_VALUE[impact];

  const controls = baseControlsFor(level);
  const csfFunctions = csfFunctionsFor(level, impact);

  return {
    level,
    value: NIST_LEVEL_VALUE[level],
    likelihood,
    impact,
    rawScore,
    color: NIST_LEVEL_COLOR[level],
    changePathway: changePathwayFor(level),
    approvalAuthority: approvalAuthorityFor(level),
    controls,
    csfFunctions,
    label: `${level} (likelihood ${likelihood} × impact ${impact})`,
  };
}

function changePathwayFor(level: NistLevel): string {
  switch (level) {
    case 'Very Low':
      return 'Standard Change — pre-authorized, follow approved model';
    case 'Low':
      return 'Standard Change — auto-approve if pre-authorized, else lightweight Normal';
    case 'Moderate':
      return 'Normal Change — Change Manager approval; CAB review optional';
    case 'High':
      return 'Normal Change — mandatory CAB review with security impact analysis';
    case 'Very High':
      return 'Emergency / escalated Normal — CISO + CTO sign-off; ECAB if time-critical';
  }
}

function approvalAuthorityFor(level: NistLevel): string {
  switch (level) {
    case 'Very Low':
      return 'Service owner (pre-authorized model)';
    case 'Low':
      return 'Change Manager';
    case 'Moderate':
      return 'Change Manager + technical peer review';
    case 'High':
      return 'CAB + Security Architect';
    case 'Very High':
      return 'ECAB + CISO + CTO';
  }
}

/**
 * SP 800-53 r5 control families most directly engaged. Always returns the
 * core CM-3/CM-4 baseline; layers on CM-5/RA-3/SI-2 for higher-risk changes.
 */
function baseControlsFor(level: NistLevel): string[] {
  const base = [
    'CM-3 (Configuration Change Control)',
    'CM-4 (Impact Analyses)',
  ];
  if (level === 'Very Low') return base;
  if (level === 'Low') return [...base, 'CM-2 (Baseline Configuration)'];
  if (level === 'Moderate')
    return [...base, 'CM-2 (Baseline Configuration)', 'RA-3 (Risk Assessment)'];
  if (level === 'High')
    return [
      ...base,
      'CM-5 (Access Restrictions for Change)',
      'RA-3 (Risk Assessment)',
      'SI-2 (Flaw Remediation)',
    ];
  // Very High
  return [
    ...base,
    'CM-5 (Access Restrictions for Change)',
    'RA-3 (Risk Assessment)',
    'SI-2 (Flaw Remediation)',
    'IR-4 (Incident Handling)',
    'CP-2 (Contingency Plan)',
  ];
}

// ── NIST CSF 2.0 — Functions & Categories ───────────────────────────────

export type NistCsfFunction = 'GV' | 'ID' | 'PR' | 'DE' | 'RS' | 'RC';

export const NIST_CSF_FUNCTIONS: Record<NistCsfFunction, { name: string; intent: string }> = {
  GV: { name: 'Govern',   intent: 'Establish and monitor cybersecurity risk management strategy and oversight.' },
  ID: { name: 'Identify', intent: "Develop organizational understanding to manage cybersecurity risk to assets, data, capabilities." },
  PR: { name: 'Protect',  intent: 'Develop and implement safeguards to ensure delivery of critical services.' },
  DE: { name: 'Detect',   intent: 'Identify the occurrence of cybersecurity events.' },
  RS: { name: 'Respond',  intent: 'Take action regarding a detected cybersecurity event.' },
  RC: { name: 'Recover',  intent: 'Maintain plans for resilience and restore capabilities impaired due to a cybersecurity event.' },
};

/**
 * Most-likely CSF functions engaged by a change at this risk level. Higher
 * risk implies engagement across more functions (Govern + Identify always
 * apply; Protect/Detect/Respond/Recover layer in as severity rises).
 */
function csfFunctionsFor(level: NistLevel, impact: NistLevel): NistCsfFunction[] {
  const fns: NistCsfFunction[] = ['GV', 'ID'];                       // always
  if (NIST_LEVEL_VALUE[impact] >= 2) fns.push('PR');                  // Low+ impact engages Protect
  if (NIST_LEVEL_VALUE[level] >= 3) fns.push('DE');                   // Moderate+ adds Detect
  if (NIST_LEVEL_VALUE[level] >= 4) fns.push('RS', 'RC');             // High+ adds Respond + Recover
  return fns;
}

// ── NIST SP 800-37 — Risk Management Framework steps ───────────────────

export type NistRmfStep =
  | 'Prepare'
  | 'Categorize'
  | 'Select'
  | 'Implement'
  | 'Assess'
  | 'Authorize'
  | 'Monitor';

export const NIST_RMF_STEPS: NistRmfStep[] = [
  'Prepare',
  'Categorize',
  'Select',
  'Implement',
  'Assess',
  'Authorize',
  'Monitor',
];

/**
 * Map a ServiceNow change-state into the closest RMF step. Useful for
 * narrating "where this change is" in NIST-aligned governance terms.
 */
export function rmfStepForChangeState(state: string | undefined | null): NistRmfStep {
  const s = String(state || '').toLowerCase();
  if (!s || s.includes('new')) return 'Prepare';
  if (s.includes('assess')) return 'Categorize';
  if (s.includes('plan') || s.includes('design')) return 'Select';
  if (s.includes('implement') || s.includes('progress') || s.includes('build')) return 'Implement';
  if (s.includes('review') || s.includes('test')) return 'Assess';
  if (s.includes('approval') || s.includes('authorize') || s.includes('cab')) return 'Authorize';
  if (s.includes('closed') || s.includes('complete') || s.includes('monitor')) return 'Monitor';
  return 'Prepare';
}

// ── FIPS 199 categorization ─────────────────────────────────────────────

export type Fips199Impact = 'Low' | 'Moderate' | 'High';

export interface Fips199Categorization {
  confidentiality: Fips199Impact;
  integrity: Fips199Impact;
  availability: Fips199Impact;
  /** High-water mark across C/I/A — the system categorization. */
  overall: Fips199Impact;
  /** Plain-text rationale for the high-water mark. */
  rationale: string;
}

const FIPS_RANK: Record<Fips199Impact, number> = { Low: 1, Moderate: 2, High: 3 };

export function fips199Categorize(
  c: Fips199Impact,
  i: Fips199Impact,
  a: Fips199Impact,
): Fips199Categorization {
  const ranks = [FIPS_RANK[c], FIPS_RANK[i], FIPS_RANK[a]];
  const max = Math.max(...ranks);
  const overall = (Object.entries(FIPS_RANK).find(([, r]) => r === max)?.[0] ??
    'Moderate') as Fips199Impact;
  const driver = max === FIPS_RANK[c] ? 'confidentiality'
    : max === FIPS_RANK[i] ? 'integrity'
    : 'availability';
  return {
    confidentiality: c,
    integrity: i,
    availability: a,
    overall,
    rationale: `High-water mark is ${overall} (driven by ${driver} = ${overall}).`,
  };
}

// ── ServiceNow → NIST mappers ───────────────────────────────────────────

/**
 * Map SNOW change `risk` ("Low" | "Moderate" | "High" | "Very High")
 * into a NIST 800-30 likelihood. SNOW already speaks the same vocabulary,
 * so this is a near-pass-through with sane defaults.
 */
export function snowChangeRiskToLikelihood(risk: string | undefined | null): NistLevel {
  const r = String(risk || '').toLowerCase();
  if (r.includes('very high')) return 'Very High';
  if (r.includes('high')) return 'High';
  if (r.includes('moderate') || r.includes('medium')) return 'Moderate';
  if (r.includes('low')) return 'Low';
  return 'Low';
}

/**
 * Map SNOW change `impact` ("1 - High" | "2 - Medium" | "3 - Low") into
 * a NIST 800-30 impact level.
 */
export function snowChangeImpactToImpact(impact: string | undefined | null): NistLevel {
  const i = String(impact || '').toLowerCase();
  if (i.includes('1') || i.includes('high')) return 'High';
  if (i.includes('2') || i.includes('medium') || i.includes('moderate')) return 'Moderate';
  if (i.includes('3') || i.includes('low')) return 'Low';
  return 'Moderate';
}

/**
 * Map SNOW incident `priority` ("1 - Critical" .. "5 - Planning") into
 * a NIST 800-30 impact level for incident response narrative.
 */
export function snowIncidentPriorityToImpact(priority: string | undefined | null): NistLevel {
  const p = String(priority || '').toLowerCase();
  if (p.includes('1') || p.includes('critical')) return 'Very High';
  if (p.includes('2') || p.includes('high')) return 'High';
  if (p.includes('3') || p.includes('moderate') || p.includes('medium')) return 'Moderate';
  if (p.includes('4') || p.includes('low')) return 'Low';
  if (p.includes('5') || p.includes('planning')) return 'Very Low';
  return 'Moderate';
}

/** One-shot helper — given a SNOW change record, return a NIST assessment. */
export function assessSnowChange(change: {
  risk?: string | { display_value?: string };
  impact?: string | { display_value?: string };
  priority?: string | { display_value?: string };
}): NistRiskAssessment {
  const riskStr = typeof change.risk === 'object' ? change.risk?.display_value : change.risk;
  const impactStr = typeof change.impact === 'object' ? change.impact?.display_value : change.impact;
  return assessRisk(snowChangeRiskToLikelihood(riskStr), snowChangeImpactToImpact(impactStr));
}

/** One-shot helper — given a SNOW incident, return a NIST assessment. */
export function assessSnowIncident(incident: {
  priority?: string | { display_value?: string };
  impact?: string | { display_value?: string };
  urgency?: string | { display_value?: string };
}): NistRiskAssessment {
  const pStr = typeof incident.priority === 'object' ? incident.priority?.display_value : incident.priority;
  const uStr = typeof incident.urgency === 'object' ? incident.urgency?.display_value : incident.urgency;
  // For incidents, priority drives impact; urgency drives likelihood of further harm.
  const impact = snowIncidentPriorityToImpact(pStr);
  const likelihood = snowChangeRiskToLikelihood(uStr); // SNOW urgency uses the same words
  return assessRisk(likelihood, impact);
}

// ── Pretty printers ─────────────────────────────────────────────────────

/** Compact one-liner summary suitable for chat / voice / table cells. */
export function summarize(a: NistRiskAssessment): string {
  return (
    `NIST 800-30 risk: ${a.level} ` +
    `(L=${a.likelihood}, I=${a.impact}). ` +
    `Pathway: ${a.changePathway}. ` +
    `CSF: ${a.csfFunctions.join('+')}. ` +
    `Controls: ${a.controls.join('; ')}.`
  );
}

/** Multi-line block for RFC documents and decks. */
export function renderRiskBlock(a: NistRiskAssessment): string {
  return [
    `**Risk level:** ${a.level} (NIST SP 800-30)`,
    `**Likelihood:** ${a.likelihood} · **Impact:** ${a.impact}`,
    `**Change pathway:** ${a.changePathway}`,
    `**Approval authority:** ${a.approvalAuthority}`,
    `**NIST CSF 2.0 functions engaged:** ${a.csfFunctions
      .map((f) => `${f} (${NIST_CSF_FUNCTIONS[f].name})`)
      .join(', ')}`,
    `**SP 800-53 controls:** ${a.controls.join('; ')}`,
  ].join('\n');
}
