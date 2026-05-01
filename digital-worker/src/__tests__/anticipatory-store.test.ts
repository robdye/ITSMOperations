// Phase 9.1 — anticipatory store smoke tests (in-memory mode only)
// Validates that the lazy-init/get-fallback pattern degrades to memory when
// no AUDIT_STORAGE_* env vars are set, so existing tests remain hermetic.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ANTICIPATORY_TABLES,
  loadRecent,
  upsertEntry,
  getBackend,
  _resetAnticipatoryStore,
} from '../anticipatory-store';

describe('anticipatory-store (no Azure config)', () => {
  beforeEach(() => {
    // Ensure env is clean for each test
    delete process.env.AUDIT_STORAGE_CONNECTION_STRING;
    delete process.env.AUDIT_STORAGE_ACCOUNT;
    delete process.env.AUDIT_STORAGE_KEY;
    _resetAnticipatoryStore();
  });

  it('reports memory backend when no storage env is configured', async () => {
    // Touch the client to force lazy init
    await loadRecent(ANTICIPATORY_TABLES.forecasts);
    expect(getBackend(ANTICIPATORY_TABLES.forecasts)).toBe('memory');
  });

  it('upsertEntry is a silent no-op without storage', async () => {
    await expect(
      upsertEntry(ANTICIPATORY_TABLES.outcomes, 'p', 'r', { hello: 'world' }),
    ).resolves.toBeUndefined();
  });

  it('loadRecent returns empty array without storage', async () => {
    const out = await loadRecent(ANTICIPATORY_TABLES.tuner);
    expect(out).toEqual([]);
  });
});
