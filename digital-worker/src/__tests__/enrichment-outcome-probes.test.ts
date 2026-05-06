// Phase E — Enrichment outcome probes (KEV + MSRC) tests.
// These probes are pure inspection of (signal, workflowResult, audit ring),
// so we don't need a live MCP server to exercise them — we synthesize
// audit entries via logAuditEntry and call the probes directly.

import { describe, it, expect, beforeEach } from 'vitest';
import { kevProbe, msrcProbe } from '../enrichment-outcome-probes';
import { logAuditEntry, _resetAuditTrail } from '../audit-trail';
import type { Signal } from '../signal-router';

function kevSignal(): Signal {
  return {
    id: 's-kev-1',
    source: 'enrichment:cisa-kev',
    type: 'enrichment.kev.match',
    severity: 'critical',
    asset: 'apache-log4j-app-01',
    payload: {
      cveId: 'CVE-2021-44228',
      vendor: 'Apache',
      product: 'Log4j',
      cvss: { baseScore: 10.0 },
    },
    occurredAt: new Date().toISOString(),
    origin: 'observed',
  };
}

function msrcSignal(): Signal {
  return {
    id: 's-msrc-1',
    source: 'enrichment:msrc',
    type: 'enrichment.msrc.critical',
    severity: 'critical',
    asset: 'exchange-server-01',
    payload: {
      cveId: 'CVE-2024-43572',
      product: 'Microsoft Exchange Server',
      cvss: { baseScore: 9.8 },
    },
    occurredAt: new Date().toISOString(),
    origin: 'observed',
  };
}

function buildResult(stepOutputs: Record<string, string>): any {
  const startedAt = new Date(Date.now() - 1000).toISOString();
  return {
    executionId: `exec-${Math.random().toString(36).slice(2, 8)}`,
    workflowId: 'major-incident-response',
    status: 'completed',
    steps: Object.entries(stepOutputs).map(([stepId, output]) => ({
      stepId,
      status: 'success',
      output,
      startedAt,
      completedAt: new Date().toISOString(),
    })),
    finalOutput: Object.values(stepOutputs).join('\n'),
  };
}

describe('enrichment-outcome-probes / kevProbe', () => {
  beforeEach(() => {
    _resetAuditTrail();
  });

  it('returns inconclusive when signal type does not match', async () => {
    const ctx = {
      workflowId: 'major-incident-response',
      executionId: 'e1',
      signal: { ...kevSignal(), type: 'incident.high' },
      workflowResult: buildResult({}),
    } as any;
    const r = await kevProbe(ctx);
    expect(r.label).toBe('inconclusive');
    expect(r.notes).toMatch(/signal type did not match/);
  });

  it('returns success when SNOW P1 + CISA citation + CVE id present', async () => {
    await logAuditEntry({
      workerId: 'incident-manager',
      workerName: 'Incident Manager',
      toolName: 'snow.create_incident',
      riskLevel: 'write',
      triggeredBy: 'enrichment:cisa-kev',
      triggerType: 'a2a',
      parameters: '{}',
      resultSummary: 'Created P1 incident INC0010001 priority 1',
      requiredConfirmation: false,
      durationMs: 12,
    });

    const ctx = {
      workflowId: 'major-incident-response',
      executionId: 'e2',
      signal: kevSignal(),
      workflowResult: buildResult({
        detect: 'CISA KEV match for CVE-2021-44228 (Log4Shell). Citing CISA Known Exploited Vulnerabilities catalog.',
        notify: 'Notified resolver groups',
      }),
    } as any;
    const r = await kevProbe(ctx);
    expect(r.label).toBe('success');
    expect(r.metrics?.snowP1Created).toBe(1);
    expect(r.metrics?.cisaCitation).toBe(1);
  });

  it('returns failure when no SNOW P1 was created', async () => {
    const ctx = {
      workflowId: 'major-incident-response',
      executionId: 'e3',
      signal: kevSignal(),
      workflowResult: buildResult({
        detect: 'CISA KEV citation present',
      }),
    } as any;
    const r = await kevProbe(ctx);
    expect(r.label).toBe('failure');
    expect(r.metrics?.snowP1Created).toBe(0);
  });
});

describe('enrichment-outcome-probes / msrcProbe', () => {
  beforeEach(() => {
    _resetAuditTrail();
  });

  it('returns inconclusive when signal type does not match', async () => {
    const ctx = {
      workflowId: 'vulnerability-to-change',
      executionId: 'm1',
      signal: { ...msrcSignal(), type: 'vulnerability.kev' },
      workflowResult: buildResult({}),
    } as any;
    const r = await msrcProbe(ctx);
    expect(r.label).toBe('inconclusive');
  });

  it('returns success when RFC drafted with MSRC citation', async () => {
    await logAuditEntry({
      workerId: 'change-manager',
      workerName: 'Change Manager',
      toolName: 'snow.create_change_request',
      riskLevel: 'write',
      triggeredBy: 'enrichment:msrc',
      triggerType: 'a2a',
      parameters: '{}',
      resultSummary: 'Drafted RFC CHG0001234 from MSRC advisory',
      requiredConfirmation: false,
      durationMs: 18,
    });

    const ctx = {
      workflowId: 'vulnerability-to-change',
      executionId: 'm2',
      signal: msrcSignal(),
      workflowResult: buildResult({
        'draft-rfc': 'RFC drafted citing MSRC CVRF document for CVE-2024-43572.',
      }),
    } as any;
    const r = await msrcProbe(ctx);
    expect(r.label).toBe('success');
    expect(r.metrics?.rfcsDrafted).toBe(1);
    expect(r.metrics?.msrcCitation).toBe(1);
  });
});
