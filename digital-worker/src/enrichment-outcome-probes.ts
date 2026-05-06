// ITSM Operations — Phase E enrichment outcome probes.
//
// Two probes are registered when this module is imported:
//
//   • major-incident-response  — success when the run was triggered by an
//     `enrichment.kev.match` signal AND a SNOW P1 incident was created
//     with a CISA citation in the worknote.
//
//   • vulnerability-to-change — success when the run was triggered by an
//     `enrichment.msrc.critical` signal AND at least one RFC was drafted.
//
// Probes are *additive* — they only return a result when their trigger
// signal type matches; otherwise they return `inconclusive` so the
// existing default / LLM-judge probes can take over without conflict.

import {
  registerProbe,
  type VerifierProbe,
  type VerifierProbeResult,
} from './outcome-verifier';
import { getRecentAuditEntries } from './audit-trail';

function findStepOutputs(ctx: Parameters<VerifierProbe>[0], stepIds: string[]): string {
  const buf: string[] = [];
  for (const s of ctx.workflowResult.steps) {
    if (stepIds.includes(s.stepId) && s.output) buf.push(s.output);
  }
  return buf.join('\n');
}

export const kevProbe: VerifierProbe = async (ctx): Promise<VerifierProbeResult> => {
  if (ctx.signal?.type !== 'enrichment.kev.match') {
    return {
      label: 'inconclusive',
      notes: 'kev-probe: signal type did not match enrichment.kev.match',
    };
  }

  // Look for a SNOW write that created a P1 incident in the audit ring.
  // We accept any tool whose name suggests SNOW incident creation; the
  // worknote text is checked downstream against the CISA citation.
  const entries = getRecentAuditEntries(200);
  const since = new Date(ctx.workflowResult.steps[0]?.startedAt ?? 0).getTime();
  const snowCreate = entries.find(
    (e) =>
      new Date(e.timestamp).getTime() >= since &&
      /snow/i.test(e.toolName) &&
      /(incident|create)/i.test(e.toolName) &&
      /(p1|priority.*1|severity.*1|critical)/i.test(e.resultSummary || ''),
  );

  const outputs = findStepOutputs(ctx, ['detect', 'bridge', 'notify', 'coordinate']);
  const hasCisaCitation = /cisa|kev|known exploited/i.test(outputs);
  const cve = (ctx.signal?.payload as { cveId?: string } | undefined)?.cveId ?? '';
  const hasCveCitation = cve ? outputs.includes(cve) : true;

  if (snowCreate && hasCisaCitation && hasCveCitation) {
    return {
      label: 'success',
      notes: `kev-probe: SNOW P1 created (tool=${snowCreate.toolName}) with CISA/KEV citation${cve ? ` for ${cve}` : ''}.`,
      metrics: { snowP1Created: 1, cisaCitation: 1 },
    };
  }
  if (snowCreate) {
    return {
      label: 'partial',
      notes: `kev-probe: SNOW P1 created via ${snowCreate.toolName} but CISA/KEV citation missing in workflow outputs.`,
      metrics: { snowP1Created: 1, cisaCitation: 0 },
    };
  }
  return {
    label: 'failure',
    notes: 'kev-probe: no SNOW P1 incident creation detected in audit ring.',
    metrics: { snowP1Created: 0, cisaCitation: hasCisaCitation ? 1 : 0 },
  };
};

export const msrcProbe: VerifierProbe = async (ctx): Promise<VerifierProbeResult> => {
  if (ctx.signal?.type !== 'enrichment.msrc.critical') {
    return {
      label: 'inconclusive',
      notes: 'msrc-probe: signal type did not match enrichment.msrc.critical',
    };
  }

  const entries = getRecentAuditEntries(200);
  const since = new Date(ctx.workflowResult.steps[0]?.startedAt ?? 0).getTime();
  const rfcCreate = entries.find(
    (e) =>
      new Date(e.timestamp).getTime() >= since &&
      /snow/i.test(e.toolName) &&
      /(change|rfc)/i.test(e.toolName) &&
      /(create|insert|draft)/i.test(e.toolName + ' ' + (e.resultSummary || '')),
  );

  const outputs = findStepOutputs(ctx, ['draft-rfc', 'rfc', 'change-create', 'plan']);
  const hasMsrcCitation = /msrc|microsoft security response|cvrf/i.test(outputs);
  const cve = (ctx.signal?.payload as { cveId?: string } | undefined)?.cveId ?? '';
  const hasCveCitation = cve ? outputs.includes(cve) : true;

  if (rfcCreate && hasMsrcCitation && hasCveCitation) {
    return {
      label: 'success',
      notes: `msrc-probe: RFC drafted (tool=${rfcCreate.toolName}) with MSRC citation${cve ? ` for ${cve}` : ''}.`,
      metrics: { rfcsDrafted: 1, msrcCitation: 1 },
    };
  }
  if (rfcCreate) {
    return {
      label: 'partial',
      notes: `msrc-probe: RFC drafted via ${rfcCreate.toolName} but MSRC citation missing in workflow outputs.`,
      metrics: { rfcsDrafted: 1, msrcCitation: 0 },
    };
  }
  return {
    label: 'failure',
    notes: 'msrc-probe: no RFC creation detected in audit ring.',
    metrics: { rfcsDrafted: 0, msrcCitation: hasMsrcCitation ? 1 : 0 },
  };
};

let registered = false;
export function registerEnrichmentOutcomeProbes(): void {
  if (registered) return;
  registered = true;
  // NOTE: Direct registration here is now deferred to outcome-probes.ts
  // which composes kevProbe + msrcProbe with existing probes. This entry
  // point remains for tests and demo runners that need to register the
  // bare probes without the composition layer.
  registerProbe('major-incident-response', kevProbe);
  registerProbe('major-incident-response-dag', kevProbe);
  registerProbe('vulnerability-to-change', msrcProbe);
  console.log('[enrichment-outcome-probes] registered KEV + MSRC probes (bare)');
}
