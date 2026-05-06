// Phase E — cognition-tags tests + cognition-graph integration.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyTag,
  clearTag,
  isTagged,
  listTags,
  _resetCognitionTags,
} from '../cognition-tags';
import { buildCognitionGraph } from '../cognition-graph';
import { signalRouter } from '../signal-router';
import { _resetForesight } from '../foresight';
import { _resetVerifier } from '../outcome-verifier';

describe('cognition-tags', () => {
  beforeEach(() => {
    _resetCognitionTags();
    _resetForesight();
    _resetVerifier();
    signalRouter.reset();
  });

  it('applies and reads tags by namespace', () => {
    const t = applyTag({
      namespace: 'upstream-degraded',
      key: 'eastus',
      ttlMs: 60_000,
      detail: { source: 'azure-status' },
    });
    expect(t.namespace).toBe('upstream-degraded');
    expect(t.key).toBe('eastus');
    expect(isTagged('upstream-degraded', 'eastus')).toBe(true);

    const list = listTags('upstream-degraded');
    expect(list.length).toBe(1);
    expect(list[0].detail).toMatchObject({ source: 'azure-status' });
  });

  it('expires tags past their TTL', async () => {
    applyTag({ namespace: 'upstream-degraded', key: 'westeurope', ttlMs: 5 });
    await new Promise((r) => setTimeout(r, 20));
    expect(isTagged('upstream-degraded', 'westeurope')).toBe(false);
    expect(listTags('upstream-degraded')).toHaveLength(0);
  });

  it('removes a tag explicitly', () => {
    applyTag({ namespace: 'upstream-degraded', key: 'centralus' });
    expect(clearTag('upstream-degraded', 'centralus')).toBe(true);
    expect(isTagged('upstream-degraded', 'centralus')).toBe(false);
  });

  it('surfaces live tags as nodes in the cognition graph', () => {
    applyTag({
      namespace: 'upstream-degraded',
      key: 'eastus',
      ttlMs: 60_000,
      detail: { region: 'eastus' },
    });
    const g = buildCognitionGraph();
    const tagNode = g.nodes.find((n) => n.id === 'tag:upstream-degraded:eastus');
    expect(tagNode).toBeDefined();
    expect(tagNode?.group).toBe('tag');
    expect(tagNode?.namespace).toBe('upstream-degraded');
    expect(typeof tagNode?.expiresAt).toBe('string');
    expect(g.counts.tags).toBe(1);
  });
});
