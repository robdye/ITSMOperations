// ITSM Operations — Async Job Runner (Phase 9.6)
//
// Long-running workflows (major-incident-restoration, full RCA, foresight
// pursuit) can run for several minutes. HTTP responses on Container Apps are
// constrained to ~230s and clients cannot reliably hold a connection for
// that long. This module provides a small, in-memory job ledger so callers
// can fire-and-forget a workflow and poll for status with /api/jobs/:id.
//
// Cassidy parity: Cassidy ships an async job runner with TTL + 200-job cap
// so its CorpGen workdays can run beyond the App Service response window.
// For ITSM the same pattern applies.
//
// Design:
//   - Each job has id, kind, status, createdAt, completedAt?, output?, error?
//   - Jobs older than `JOB_TTL_MS` are purged on each access (lazy GC).
//   - Capacity capped at MAX_JOBS — oldest evicted FIFO.
//   - In-memory only (matches Cassidy's pattern). Persistence is unnecessary
//     because jobs are short-lived by design and clients re-issue on restart.

import crypto from 'crypto';

const JOB_TTL_MS = Number(process.env.JOB_TTL_MS) || 60 * 60 * 1000; // 1h
const MAX_JOBS = Number(process.env.MAX_JOBS) || 200;

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Job<T = unknown> {
  id: string;
  kind: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  output?: T;
  error?: string;
  /** Optional caller-supplied tags (e.g. tenantId, signalId). */
  tags?: Record<string, string>;
}

const jobs = new Map<string, Job>();

function gc(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    const ts = Date.parse(job.completedAt ?? job.createdAt);
    if (Number.isFinite(ts) && ts < cutoff) {
      jobs.delete(id);
    }
  }
  // FIFO cap.
  if (jobs.size > MAX_JOBS) {
    const overflow = jobs.size - MAX_JOBS;
    let i = 0;
    for (const id of jobs.keys()) {
      if (i++ >= overflow) break;
      jobs.delete(id);
    }
  }
}

export function _resetJobs(): void {
  jobs.clear();
}

export function listJobs(limit = 50): Job[] {
  gc();
  return Array.from(jobs.values())
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

export function getJob(id: string): Job | null {
  gc();
  return jobs.get(id) ?? null;
}

/**
 * Start a job. Returns the job descriptor immediately — the caller can
 * respond `202 Accepted` with the id and poll for completion.
 */
export function startJob<T>(
  kind: string,
  task: () => Promise<T>,
  tags?: Record<string, string>,
): Job<T> {
  gc();
  const id = `job-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const job: Job<T> = {
    id,
    kind,
    status: 'pending',
    createdAt: new Date().toISOString(),
    tags,
  };
  jobs.set(id, job as Job);
  // Run on next tick so the caller gets the id back first.
  queueMicrotask(async () => {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    try {
      job.output = await task();
      job.status = 'completed';
    } catch (err: any) {
      job.status = 'failed';
      job.error = err?.message ?? String(err);
      console.warn(`[Jobs] ${kind} failed:`, job.error);
    } finally {
      job.completedAt = new Date().toISOString();
    }
  });
  return job;
}

export function getJobStats(): { total: number; pending: number; running: number; completed: number; failed: number } {
  gc();
  let pending = 0;
  let running = 0;
  let completed = 0;
  let failed = 0;
  for (const j of jobs.values()) {
    if (j.status === 'pending') pending++;
    else if (j.status === 'running') running++;
    else if (j.status === 'completed') completed++;
    else if (j.status === 'failed') failed++;
  }
  return { total: jobs.size, pending, running, completed, failed };
}
