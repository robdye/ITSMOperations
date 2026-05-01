import { describe, it, expect, beforeEach } from 'vitest';
import { signalRouter, when, type Signal } from '../signal-router';
import { mapSnowPayloadToSignal } from '../snow-signal-mapper';

/**
 * Contract test: a scripted SNOW payload (`u_demo_run` set) and an observed
 * SNOW payload (no demo tag) must produce identical workflow execution paths
 * once they enter the signal-router. Origin is the *only* difference.
 */
describe('signal contract — scripted vs observed', () => {
  beforeEach(() => {
    signalRouter.reset();
  });

  it('routes both origins to the same workflow with identical decisions', async () => {
    const recorded: Signal[] = [];
    signalRouter.subscribe({
      workflowId: 'major-incident-response',
      predicate: when.all(when.source('servicenow'), (s) => s.type.startsWith('incident.')),
      handler: (s) => {
        recorded.push(s);
      },
    });

    const observed = mapSnowPayloadToSignal({
      table: 'incident',
      action: 'insert',
      sys_id: 'sys-observed',
      sys_updated_on: '2026-05-01T12:00:00Z',
      current: { number: 'INC0001', priority: '1', short_description: 'Outage' },
    });

    const scripted = mapSnowPayloadToSignal({
      table: 'incident',
      action: 'insert',
      sys_id: 'sys-scripted',
      sys_updated_on: '2026-05-01T12:00:01Z',
      current: { number: 'INC0002', priority: '1', short_description: 'Outage', u_demo_run: 'demo-1' },
    });

    expect(observed.origin).toBe('observed');
    expect(scripted.origin).toBe('scripted');

    const observedDecisions = await signalRouter.publish(observed);
    const scriptedDecisions = await signalRouter.publish(scripted);

    // Same workflow targeted, same matched flag, same lack of suppression.
    expect(observedDecisions.map((d) => ({ workflowId: d.workflowId, matched: d.matched, suppressedReason: d.suppressedReason }))).toEqual(
      scriptedDecisions.map((d) => ({ workflowId: d.workflowId, matched: d.matched, suppressedReason: d.suppressedReason })),
    );
    expect(recorded).toHaveLength(2);
    expect(recorded.map((s) => s.type)).toEqual(['incident.insert', 'incident.insert']);
    expect(recorded.map((s) => s.severity)).toEqual(['critical', 'critical']);
  });
});
