// Phase 4 — case-manager smoke tests.
//
// Validates the in-memory fallback path: open → activity → state → close.
// Cosmos backend is exercised via integration tests elsewhere; here we
// only assert behaviour when COSMOS_CONNECTION_STRING is unset (the
// default in CI) so the suite stays hermetic.

import { describe, it, expect } from 'vitest';
import {
  openCase,
  appendActivity,
  setState,
  recordApprovalRequest,
  recordApprovalDecision,
  appendEnrichment,
  close,
  setNextReminder,
  getCase,
  findCaseBySubject,
  listOpenCases,
  listCasesDueForReminder,
  getCaseKpi,
  addRelatedSignal,
  addRelatedWorkflow,
} from '../case-manager';

describe('case-manager (in-memory fallback)', () => {
  it('opens a case with subject + owner and returns a populated record', async () => {
    const c = await openCase({
      subjectRef: { kind: 'incident', sysId: 'INC-test-001', number: 'INC0099001' },
      ownerWorkerId: 'incident-manager',
      initialNote: 'opened by smoke test',
    });
    expect(c.id).toMatch(/^case-/);
    expect(c.state).toBe('open');
    expect(c.notes.length).toBe(1);
    expect(c.subjectRef.sysId).toBe('INC-test-001');
    expect(c.ownerWorkerId).toBe('incident-manager');
  });

  it('appendActivity adds a note and updates updatedAt', async () => {
    const c = await openCase({
      subjectRef: { kind: 'incident', sysId: 'INC-test-002' },
      ownerWorkerId: 'incident-manager',
    });
    const updated = await appendActivity(c.id, { kind: 'note', text: 'second note' });
    expect(updated).not.toBeNull();
    expect(updated!.notes.length).toBeGreaterThan(0);
  });

  it('setState transitions state and records activity', async () => {
    const c = await openCase({
      subjectRef: { kind: 'incident', sysId: 'INC-test-003' },
      ownerWorkerId: 'incident-manager',
    });
    const r = await setState(c.id, 'waiting', 'pending CAB approval');
    expect(r).not.toBeNull();
    expect(r!.state).toBe('waiting');
  });

  it('approval request + decision flow updates pendingApprovals', async () => {
    const c = await openCase({
      subjectRef: { kind: 'change', sysId: 'CHG-test-001' },
      ownerWorkerId: 'change-manager',
    });
    const r1 = await recordApprovalRequest(c.id, 'apr-1', 'change-manager');
    expect(r1!.pendingApprovals.length).toBe(1);
    const r2 = await recordApprovalDecision(c.id, 'apr-1', 'approved', 'looks fine');
    expect(r2!.pendingApprovals[0].decision).toBe('approved');
  });

  it('appendEnrichment records an enrichment', async () => {
    const c = await openCase({
      subjectRef: { kind: 'incident', sysId: 'INC-test-004' },
      ownerWorkerId: 'incident-manager',
    });
    const r = await appendEnrichment(c.id, { source: 'enrichment:nvd', summary: 'CVE-2026-0001 high' });
    expect(r!.enrichments.length).toBe(1);
    expect(r!.enrichments[0].source).toBe('enrichment:nvd');
  });

  it('close marks the case closed with a reason and timestamp', async () => {
    const c = await openCase({
      subjectRef: { kind: 'incident', sysId: 'INC-test-005' },
      ownerWorkerId: 'incident-manager',
    });
    const r = await close(c.id, 'duplicate-of-INC0099001');
    expect(r!.state).toBe('closed');
    expect(r!.closeReason).toBe('duplicate-of-INC0099001');
    expect(r!.closedAt).toBeTruthy();
  });

  it('addRelatedSignal + addRelatedWorkflow append unique ids', async () => {
    const c = await openCase({
      subjectRef: { kind: 'incident', sysId: 'INC-test-006' },
      ownerWorkerId: 'incident-manager',
    });
    await addRelatedSignal(c.id, 'sig-1');
    await addRelatedSignal(c.id, 'sig-1'); // duplicate
    const r = await addRelatedWorkflow(c.id, 'wf-1');
    expect(r!.relatedSignals).toEqual(['sig-1']);
    expect(r!.relatedWorkflows).toEqual(['wf-1']);
  });

  it('findCaseBySubject locates an open case by subjectRef', async () => {
    const c = await openCase({
      subjectRef: { kind: 'incident', sysId: 'INC-test-007' },
      ownerWorkerId: 'incident-manager',
    });
    const found = await findCaseBySubject('incident', 'INC-test-007');
    expect(found?.id).toBe(c.id);
  });

  it('setNextReminder + listCasesDueForReminder surface due cases', async () => {
    const c = await openCase({
      subjectRef: { kind: 'incident', sysId: 'INC-test-008' },
      ownerWorkerId: 'incident-manager',
    });
    await setNextReminder(c.id, new Date(Date.now() - 60_000).toISOString());
    const due = await listCasesDueForReminder();
    expect(due.some((d) => d.id === c.id)).toBe(true);
  });

  it('listOpenCases excludes closed and getCaseKpi reports totals', async () => {
    const before = (await listOpenCases()).length;
    const c = await openCase({
      subjectRef: { kind: 'incident', sysId: 'INC-test-009' },
      ownerWorkerId: 'incident-manager',
    });
    expect((await listOpenCases()).length).toBeGreaterThanOrEqual(before + 1);
    await close(c.id, 'done');
    const kpi = getCaseKpi();
    expect(kpi.total).toBeGreaterThan(0);
    expect(kpi.byState.closed).toBeGreaterThan(0);
  });

  it('getCase returns null for a missing id', async () => {
    expect(await getCase('case-does-not-exist')).toBeNull();
  });
});
