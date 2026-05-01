// Phase 9.6 — async job runner tests

import { describe, it, expect, beforeEach } from 'vitest';
import { startJob, getJob, listJobs, getJobStats, _resetJobs } from '../async-jobs';

function tick(ms = 1): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('async-jobs', () => {
  beforeEach(() => {
    _resetJobs();
  });

  it('startJob returns immediately with status pending and id', () => {
    const job = startJob('demo', async () => 42);
    expect(job.id).toMatch(/^job-/);
    expect(job.kind).toBe('demo');
    expect(job.status).toBe('pending');
    expect(job.createdAt).toBeTruthy();
  });

  it('completes the task and stores output', async () => {
    const job = startJob('compute', async () => ({ value: 'done' }));
    await tick(20);
    const fetched = getJob(job.id);
    expect(fetched).toBeTruthy();
    expect(fetched!.status).toBe('completed');
    expect((fetched!.output as any)?.value).toBe('done');
    expect(fetched!.completedAt).toBeTruthy();
  });

  it('captures failures and exposes error', async () => {
    const job = startJob('boom', async () => {
      throw new Error('intentional');
    });
    await tick(20);
    const fetched = getJob(job.id);
    expect(fetched!.status).toBe('failed');
    expect(fetched!.error).toBe('intentional');
  });

  it('stats and listing reflect mixed states', async () => {
    startJob('a', async () => 1);
    startJob('b', async () => {
      throw new Error('x');
    });
    await tick(30);
    const stats = getJobStats();
    expect(stats.total).toBe(2);
    expect(stats.completed + stats.failed).toBe(2);
    const list = listJobs();
    expect(list.length).toBe(2);
  });

  it('returns null for unknown job ids', () => {
    expect(getJob('does-not-exist')).toBeNull();
  });
});
