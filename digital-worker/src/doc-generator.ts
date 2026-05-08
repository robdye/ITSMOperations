// ITSM Operations — Document Generator
// Generates professional documents for ITSM workflows.
//
// Currently returns structured markdown so no extra npm dependencies are needed.
// The API is designed so real doc generation (docx, exceljs, pptxgenjs) can be
// plugged in later by replacing the body of each method.
//
// All risk language in this module is anchored to:
//   • NIST SP 800-30 r1 — qualitative 5×5 likelihood × impact matrix.
//   • NIST CSF 2.0 — six Functions (Govern / Identify / Protect / Detect / Respond / Recover).
//   • NIST SP 800-37 r2 (RMF) — seven steps (Prepare → Monitor).
//   • FIPS 199 — Low / Moderate / High system categorization.
//
// Callers may pass `nistRisk` directly, or rely on the legacy `riskScore`
// (1..10) field which is auto-translated into the NIST scale below.

import {
  assessRisk,
  type NistLevel,
  type NistRiskAssessment,
  rmfStepForChangeState,
  renderRiskBlock,
  fips199Categorize,
  type Fips199Categorization,
  type Fips199Impact,
  NIST_CSF_FUNCTIONS,
} from './nist.js';

// ── Types ──

export interface DocResult {
  content: string;
  format: 'markdown';
  suggestedFilename: string;
}

export interface ChangeData {
  changeId: string;
  title: string;
  description: string;
  type: string;
  riskScore: number;
  impactedCIs: string[];
  rollbackPlan: string;
  implementationPlan: string;
  scheduledStart: string;
  scheduledEnd: string;
  requestedBy: string;
  cabRecommendation?: string;
  /** Optional pre-computed NIST risk assessment. If absent, derived from riskScore. */
  nistRisk?: NistRiskAssessment;
  /** Optional FIPS 199 categorization for the affected system. */
  fips199?: Fips199Categorization;
  /** Optional ServiceNow change state used to map an RMF step. */
  changeState?: string;
}

export interface IncidentData {
  incidentId: string;
  title: string;
  severity: string;
  timeline: Array<{ time: string; event: string }>;
  rootCause: string;
  resolution: string;
  impactSummary: string;
  lessonsLearned: string[];
  actionItems: Array<{ owner: string; action: string; dueDate: string }>;
  /** Optional pre-computed NIST risk assessment. */
  nistRisk?: NistRiskAssessment;
  /** Optional FIPS 199 categorization. */
  fips199?: Fips199Categorization;
}

export interface ServiceReviewMetrics {
  period: string;
  incidentCount: number;
  mttr: string;
  slaCompliance: number;
  changeSuccessRate: number;
  problemsResolved: number;
  topCategories: Array<{ category: string; count: number }>;
  highlights: string[];
  risks: string[];
}

export interface RiskEntry {
  id: string;
  description: string;
  likelihood: number;
  impact: number;
  score: number;
  mitigation: string;
  owner: string;
  status: string;
}

export interface DRTestData {
  drillId: string;
  date: string;
  scenario: string;
  participantsCount: number;
  rtoTarget: string;
  rtoActual: string;
  rpoTarget: string;
  rpoActual: string;
  findings: Array<{ severity: string; finding: string; recommendation: string }>;
  overallResult: 'pass' | 'partial' | 'fail';
}

export interface KPIData {
  period: string;
  metrics: Array<{
    name: string;
    target: number;
    actual: number;
    unit: string;
    trend: 'up' | 'down' | 'stable';
  }>;
}

// ── Generator ──

/**
 * Map a legacy 1..10 risk score onto a NIST 800-30 likelihood/impact pair.
 * 1-2 → (Low, Low) → Low overall
 * 3-4 → (Low, Moderate) → Low
 * 5-6 → (Moderate, Moderate) → Moderate
 * 7-8 → (Moderate, High) → Moderate
 * 9-10 → (High, High) → High
 */
function legacyRiskToNist(score: number): NistRiskAssessment {
  if (score >= 9) return assessRisk('High', 'High');
  if (score >= 7) return assessRisk('Moderate', 'High');
  if (score >= 5) return assessRisk('Moderate', 'Moderate');
  if (score >= 3) return assessRisk('Low', 'Moderate');
  return assessRisk('Low', 'Low');
}

/** Default FIPS 199 categorization when no explicit C/I/A is supplied. */
function defaultFips199(level: NistLevel): Fips199Categorization {
  const drive = (level === 'Very High' || level === 'High') ? 'High'
    : level === 'Moderate' ? 'Moderate'
    : 'Low';
  return fips199Categorize(drive as Fips199Impact, drive as Fips199Impact, drive as Fips199Impact);
}

export class DocGenerator {
  /**
   * Generate an RFC (Request for Change) document. Output is anchored to
   * NIST SP 800-30 risk assessment, NIST CSF 2.0 functional alignment,
   * NIST RMF (SP 800-37) step, and FIPS 199 system categorization.
   */
  generateChangeRFC(data: ChangeData): DocResult {
    const nist = data.nistRisk ?? legacyRiskToNist(data.riskScore);
    const fips = data.fips199 ?? defaultFips199(nist.level);
    const rmfStep = rmfStepForChangeState(data.changeState);
    const csfList = nist.csfFunctions
      .map((f) => `${f} — ${NIST_CSF_FUNCTIONS[f].name}`)
      .join('; ');

    const content = `# Request for Change — ${data.changeId}

> **Governance baseline:** NIST SP 800-30 r1 (risk) · NIST CSF 2.0 (functional alignment) · NIST SP 800-37 r2 / RMF (process) · FIPS 199 (categorization).

## Change Details
| Field | Value |
|-------|-------|
| **Change ID** | ${data.changeId} |
| **Title** | ${data.title} |
| **Type** | ${data.type} |
| **Requested By** | ${data.requestedBy} |
| **Scheduled Start** | ${data.scheduledStart} |
| **Scheduled End** | ${data.scheduledEnd} |

## Description
${data.description}

## NIST SP 800-30 Risk Assessment
| Element | Value |
|---------|-------|
| **Risk level** | ${nist.level} |
| **Likelihood** | ${nist.likelihood} |
| **Impact** | ${nist.impact} |
| **Change pathway** | ${nist.changePathway} |
| **Approval authority** | ${nist.approvalAuthority} |
| **SP 800-53 controls** | ${nist.controls.join('; ')} |

## NIST CSF 2.0 Functional Alignment
${csfList}

## NIST RMF (SP 800-37 r2) Step
**${rmfStep}** — change is currently aligned to this step in the seven-step RMF lifecycle (Prepare → Categorize → Select → Implement → Assess → **Authorize** → Monitor).

## FIPS 199 System Categorization
| Property | Impact |
|----------|--------|
| Confidentiality | ${fips.confidentiality} |
| Integrity | ${fips.integrity} |
| Availability | ${fips.availability} |
| **Overall (high-water mark)** | **${fips.overall}** |

${fips.rationale}

## Impacted CIs
${data.impactedCIs.map((ci) => `- ${ci}`).join('\n') || '_None recorded_'}

## Implementation Plan
${data.implementationPlan}

## Rollback Plan
${data.rollbackPlan}

## CAB Recommendation
${data.cabRecommendation || '_Pending CAB review_'}

---
_Generated by ITSM Operations Digital Worker — ${new Date().toISOString()}_
_Risk and governance scoring per NIST SP 800-30 r1, CSF 2.0, RMF SP 800-37 r2, and FIPS 199._
`;
    return { content, format: 'markdown', suggestedFilename: `RFC-${data.changeId}.md` };
  }

  /**
   * Generate a post-incident review report aligned to NIST CSF Respond +
   * Recover and SP 800-61 r2 (Computer Security Incident Handling Guide).
   */
  generateIncidentReport(data: IncidentData): DocResult {
    const timelineRows = data.timeline
      .map((t) => `| ${t.time} | ${t.event} |`)
      .join('\n');
    const actionRows = data.actionItems
      .map((a) => `| ${a.owner} | ${a.action} | ${a.dueDate} |`)
      .join('\n');
    const lessons = data.lessonsLearned.map((l) => `- ${l}`).join('\n');

    // Derive a NIST view of the incident from severity if not provided.
    const sev = String(data.severity || '').toLowerCase();
    const derivedImpact: NistLevel = sev.includes('1') || sev.includes('critical') ? 'Very High'
      : sev.includes('2') || sev.includes('high') ? 'High'
      : sev.includes('3') || sev.includes('moderate') || sev.includes('medium') ? 'Moderate'
      : sev.includes('4') || sev.includes('low') ? 'Low'
      : 'Moderate';
    const nist = data.nistRisk ?? assessRisk('Moderate', derivedImpact);
    const fips = data.fips199 ?? defaultFips199(nist.level);

    const content = `# Post-Incident Review — ${data.incidentId}

> **Governance baseline:** NIST SP 800-61 r2 (incident handling) · NIST SP 800-30 r1 (risk) · NIST CSF 2.0 (Respond + Recover) · FIPS 199.

## Incident Summary
| Field | Value |
|-------|-------|
| **Incident ID** | ${data.incidentId} |
| **Title** | ${data.title} |
| **Severity** | ${data.severity} |
| **NIST 800-30 risk level** | ${nist.level} (L=${nist.likelihood}, I=${nist.impact}) |
| **CSF functions engaged** | ${nist.csfFunctions.join(', ')} |
| **FIPS 199 overall** | ${fips.overall} |

## Impact Summary
${data.impactSummary}

## Timeline
| Time | Event |
|------|-------|
${timelineRows}

## Root Cause Analysis (NIST CSF — Identify)
${data.rootCause}

## Resolution (NIST CSF — Respond + Recover)
${data.resolution}

## Lessons Learned (NIST CSF — Govern)
${lessons}

## Action Items (RMF Monitor step)
| Owner | Action | Due Date |
|-------|--------|----------|
${actionRows}

---
_Generated by ITSM Operations Digital Worker — ${new Date().toISOString()}_
_Aligned to NIST SP 800-61 r2, SP 800-30 r1, CSF 2.0, and FIPS 199._
`;
    return { content, format: 'markdown', suggestedFilename: `PIR-${data.incidentId}.md` };
  }

  /**
   * Generate a monthly service review deck (markdown representation).
   */
  generateServiceReviewPack(period: string, metrics: ServiceReviewMetrics): DocResult {
    const categoryRows = metrics.topCategories
      .map((c) => `| ${c.category} | ${c.count} |`)
      .join('\n');
    const highlights = metrics.highlights.map((h) => `- ✅ ${h}`).join('\n');
    const risks = metrics.risks.map((r) => `- ⚠️ ${r}`).join('\n');

    const content = `# Monthly Service Review — ${period}

## Executive Summary
| KPI | Value |
|-----|-------|
| **Incident Count** | ${metrics.incidentCount} |
| **Mean Time to Resolve** | ${metrics.mttr} |
| **SLA Compliance** | ${metrics.slaCompliance}% |
| **Change Success Rate** | ${metrics.changeSuccessRate}% |
| **Problems Resolved** | ${metrics.problemsResolved} |

## Top Incident Categories
| Category | Count |
|----------|-------|
${categoryRows}

## Highlights
${highlights}

## Risks & Concerns
${risks}

---
_Generated by ITSM Operations Digital Worker — ${new Date().toISOString()}_
`;
    return { content, format: 'markdown', suggestedFilename: `ServiceReview-${period}.md` };
  }

  /**
   * Generate a risk register / heatmap document.
   */
  generateRiskHeatmap(riskData: RiskEntry[]): DocResult {
    const rows = riskData
      .sort((a, b) => b.score - a.score)
      .map(
        (r) =>
          `| ${r.id} | ${r.description} | ${r.likelihood} | ${r.impact} | **${r.score}** | ${r.status} | ${r.owner} |`
      )
      .join('\n');

    const content = `# Risk Register & Heatmap

## Risk Matrix
| ID | Description | Likelihood (1-5) | Impact (1-5) | Score | Status | Owner |
|----|-------------|:-----------------:|:------------:|:-----:|--------|-------|
${rows}

## Heatmap Legend
- **20-25:** 🔴 Critical — Immediate action required
- **12-19:** 🟠 High — Action plan needed within 7 days
- **6-11:** 🟡 Medium — Monitor and review monthly
- **1-5:** 🟢 Low — Accept or monitor quarterly

---
_Generated by ITSM Operations Digital Worker — ${new Date().toISOString()}_
`;
    return { content, format: 'markdown', suggestedFilename: `RiskRegister-${new Date().toISOString().slice(0, 10)}.md` };
  }

  /**
   * Generate a CAB meeting agenda.
   */
  generateCABAgenda(changes: ChangeData[]): DocResult {
    const rfcRows = changes
      .map(
        (c) =>
          `| ${c.changeId} | ${c.title} | ${c.type} | ${c.riskScore}/10 | ${c.scheduledStart} |`
      )
      .join('\n');

    const content = `# Change Advisory Board — Agenda

**Date:** ${new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

## 1. Review of Previous Actions
_[Actions from last CAB meeting]_

## 2. Changes for Review (${changes.length})
| Change ID | Title | Type | Risk | Scheduled |
|-----------|-------|------|:----:|-----------|
${rfcRows}

## 3. Emergency Changes (Retrospective)
_[Any emergency changes implemented since last CAB]_

## 4. Failed Changes Review
_[Post-implementation review of failed changes]_

## 5. Forward Schedule of Change
_[Upcoming change freeze periods and key dates]_

## 6. AOB

---
_Generated by ITSM Operations Digital Worker — ${new Date().toISOString()}_
`;
    return { content, format: 'markdown', suggestedFilename: `CAB-Agenda-${new Date().toISOString().slice(0, 10)}.md` };
  }

  /**
   * Generate a KPI dashboard document.
   */
  generateKPIDashboard(kpiData: KPIData): DocResult {
    const trendIcon = (t: string) => (t === 'up' ? '📈' : t === 'down' ? '📉' : '➡️');
    const rows = kpiData.metrics
      .map(
        (m) =>
          `| ${m.name} | ${m.actual} ${m.unit} | ${m.target} ${m.unit} | ${m.actual >= m.target ? '✅' : '❌'} | ${trendIcon(m.trend)} |`
      )
      .join('\n');

    const content = `# KPI Dashboard — ${kpiData.period}

| Metric | Actual | Target | Status | Trend |
|--------|:------:|:------:|:------:|:-----:|
${rows}

---
_Generated by ITSM Operations Digital Worker — ${new Date().toISOString()}_
`;
    return { content, format: 'markdown', suggestedFilename: `KPI-Dashboard-${kpiData.period}.md` };
  }

  /**
   * Generate a DR (Disaster Recovery) drill test report.
   */
  generateDRTestReport(data: DRTestData): DocResult {
    const resultEmoji = data.overallResult === 'pass' ? '✅ PASS' : data.overallResult === 'partial' ? '⚠️ PARTIAL' : '❌ FAIL';
    const findingRows = data.findings
      .map((f) => `| ${f.severity} | ${f.finding} | ${f.recommendation} |`)
      .join('\n');

    const content = `# DR Drill Report — ${data.drillId}

## Drill Summary
| Field | Value |
|-------|-------|
| **Drill ID** | ${data.drillId} |
| **Date** | ${data.date} |
| **Scenario** | ${data.scenario} |
| **Participants** | ${data.participantsCount} |
| **Overall Result** | ${resultEmoji} |

## Recovery Objectives
| Metric | Target | Actual | Met? |
|--------|--------|--------|:----:|
| **RTO** | ${data.rtoTarget} | ${data.rtoActual} | ${data.rtoActual <= data.rtoTarget ? '✅' : '❌'} |
| **RPO** | ${data.rpoTarget} | ${data.rpoActual} | ${data.rpoActual <= data.rpoTarget ? '✅' : '❌'} |

## Findings
| Severity | Finding | Recommendation |
|----------|---------|----------------|
${findingRows}

---
_Generated by ITSM Operations Digital Worker — ${new Date().toISOString()}_
`;
    return { content, format: 'markdown', suggestedFilename: `DR-Report-${data.drillId}.md` };
  }
}

export const docGenerator = new DocGenerator();
