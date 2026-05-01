// ITSM Operations — Governance (Pillar 7 of the Anticipatory-Alex architecture)
//
// Provides the small set of guardrails every autonomous worker must respect:
//   - Global kill-switch (engages from /api/governance/kill, env, or Teams cmd)
//   - Action budget meter (per-tenant, hourly cap on autonomous actions)
//   - Change-freeze calendar (windowed, JSON-loadable, env override)
//   - Statements of autonomy (per-worker disclosure pulled into mission control)
//
// All checks are O(1) and side-effect-free, so they can be called inline from
// the trigger-policy and from the agent-harness autonomy gate.

import type { WorkerDefinition } from './agent-harness';
import {
  ANTICIPATORY_TABLES,
  loadRecent,
  upsertEntry,
  deleteEntry,
  getBackend,
} from './anticipatory-store';

let backfilled = false;

export function getGovernanceBackend(): 'azure-table' | 'memory' {
  return getBackend(ANTICIPATORY_TABLES.governance);
}

/**
 * Cold-start backfill: rebuild kill-switch, freeze windows, and tenant action
 * stamps from Table Storage so a restart does not silently re-arm autonomy.
 */
export async function backfillGovernance(): Promise<{ kill: number; freeze: number; tenants: number }> {
  if (backfilled) return { kill: killState.engaged ? 1 : 0, freeze: freezeWindows.length, tenants: tenantStamps.size };
  backfilled = true;
  const counts = { kill: 0, freeze: 0, tenants: 0 };
  try {
    // Kill-switch state — single row in partition 'kill'.
    const killRows = await loadRecent<KillState>(ANTICIPATORY_TABLES.governance, { partitionKey: 'kill', limit: 1 });
    if (killRows.length > 0) {
      killState = killRows[0].payload;
      counts.kill = killState.engaged ? 1 : 0;
      if (killState.engaged) {
        console.warn(`[Governance] Restored kill-switch ENGAGED state (by ${killState.engagedBy ?? 'unknown'})`);
      }
    }
    // Freeze windows — many rows in partition 'freeze'.
    const freezeRows = await loadRecent<ChangeFreezeWindow>(ANTICIPATORY_TABLES.governance, { partitionKey: 'freeze', limit: 200 });
    freezeWindows = freezeRows.map((r) => r.payload);
    counts.freeze = freezeWindows.length;
    // Tenant action stamps — one row per tenant in partition 'budget'.
    const budgetRows = await loadRecent<{ stamps: number[] }>(ANTICIPATORY_TABLES.governance, { partitionKey: 'budget', limit: 200 });
    for (const r of budgetRows) {
      tenantStamps.set(r.rowKey, r.payload.stamps);
    }
    counts.tenants = tenantStamps.size;
    if (counts.freeze > 0 || counts.tenants > 0 || counts.kill > 0) {
      console.log(`[Governance] Restored: kill=${counts.kill} freezeWindows=${counts.freeze} tenantBudgets=${counts.tenants}`);
    }
  } catch (err: any) {
    console.warn('[Governance] backfill failed:', err?.message);
  }
  return counts;
}

// ── Kill-switch ──

export interface KillState {
  engaged: boolean;
  engagedAt?: string;
  engagedBy?: string;
  reason?: string;
}

let killState: KillState = { engaged: isKillSwitchEnv() };

function isKillSwitchEnv(): boolean {
  const raw = process.env.GLOBAL_KILL_SWITCH;
  if (!raw) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

export function isKillSwitchEngaged(): boolean {
  return killState.engaged || isKillSwitchEnv();
}

export function getKillState(): KillState {
  return { ...killState };
}

export function engageKillSwitch(by: string, reason?: string): KillState {
  killState = {
    engaged: true,
    engagedAt: new Date().toISOString(),
    engagedBy: by,
    reason,
  };
  console.warn(`[Governance] KILL-SWITCH ENGAGED by ${by}${reason ? ` — ${reason}` : ''}`);
  void upsertEntry(ANTICIPATORY_TABLES.governance, 'kill', 'state', killState).catch((err) =>
    console.warn('[Governance] persist kill-switch failed:', (err as Error)?.message),
  );
  void import('./anticipatory-broadcaster')
    .then(({ broadcastKillSwitch }) => broadcastKillSwitch(killState, 'engaged'))
    .catch((err) => console.warn('[Governance] broadcast failed:', (err as Error)?.message));
  return { ...killState };
}

export function releaseKillSwitch(by: string): KillState {
  killState = { engaged: false };
  console.log(`[Governance] kill-switch released by ${by}`);
  void upsertEntry(ANTICIPATORY_TABLES.governance, 'kill', 'state', killState).catch((err) =>
    console.warn('[Governance] persist kill-switch failed:', (err as Error)?.message),
  );
  void import('./anticipatory-broadcaster')
    .then(({ broadcastKillSwitch }) => broadcastKillSwitch(killState, 'released'))
    .catch((err) => console.warn('[Governance] broadcast failed:', (err as Error)?.message));
  return { ...killState };
}

// ── Change-freeze calendar ──

export interface ChangeFreezeWindow {
  /** ISO start. */
  from: string;
  /** ISO end. */
  to: string;
  reason?: string;
}

let freezeWindows: ChangeFreezeWindow[] = [];

export function setChangeFreezeWindows(windows: ChangeFreezeWindow[]): void {
  freezeWindows = [...windows];
  // Persist: rewrite the freeze partition. Delete-then-insert keeps it simple
  // since this surface is rarely mutated.
  void (async () => {
    try {
      const existing = await loadRecent<ChangeFreezeWindow>(ANTICIPATORY_TABLES.governance, {
        partitionKey: 'freeze',
        limit: 200,
      });
      for (const e of existing) {
        await deleteEntry(ANTICIPATORY_TABLES.governance, e.partitionKey, e.rowKey);
      }
      let i = 0;
      for (const w of windows) {
        await upsertEntry(ANTICIPATORY_TABLES.governance, 'freeze', `w-${Date.parse(w.from) || i}-${i}`, w);
        i++;
      }
    } catch (err: any) {
      console.warn('[Governance] persist freeze windows failed:', err?.message);
    }
  })();
}

export function getChangeFreezeWindows(): ChangeFreezeWindow[] {
  return [...freezeWindows];
}

export function isChangeFreezeActive(now: number = Date.now()): boolean {
  if (process.env.CHANGE_FREEZE && ['1', 'true', 'yes', 'on'].includes(process.env.CHANGE_FREEZE.trim().toLowerCase())) {
    return true;
  }
  for (const w of freezeWindows) {
    const from = Date.parse(w.from);
    const to = Date.parse(w.to);
    if (Number.isFinite(from) && Number.isFinite(to) && now >= from && now <= to) return true;
  }
  return false;
}

// ── Action budget meter ──

const HOUR_MS = 60 * 60 * 1000;
const tenantStamps = new Map<string, number[]>();

export interface BudgetSnapshot {
  tenantId: string;
  used: number;
  limit: number;
  windowMs: number;
  remaining: number;
}

export function recordAction(tenantId: string, now: number = Date.now()): void {
  const stamps = tenantStamps.get(tenantId) ?? [];
  stamps.push(now);
  tenantStamps.set(tenantId, stamps);
  // Write-through (debounced via fire-and-forget) so the budget survives restart.
  void upsertEntry(ANTICIPATORY_TABLES.governance, 'budget', tenantId, { stamps }).catch((err) =>
    console.warn('[Governance] persist budget failed:', (err as Error)?.message),
  );
}

export function getBudgetSnapshot(
  tenantId: string,
  limit = 30,
  windowMs = HOUR_MS,
  now: number = Date.now()
): BudgetSnapshot {
  const cutoff = now - windowMs;
  const stamps = tenantStamps.get(tenantId) ?? [];
  const fresh = stamps.filter((t) => t >= cutoff);
  if (fresh.length !== stamps.length) tenantStamps.set(tenantId, fresh);
  return {
    tenantId,
    used: fresh.length,
    limit,
    windowMs,
    remaining: Math.max(0, limit - fresh.length),
  };
}

// ── Statements of autonomy ──

export interface StatementOfAutonomy {
  workerId: string;
  name: string;
  blastRadius: number;
  allowAutonomous: boolean;
  statement: string;
}

export function statementsOfAutonomy(workers: WorkerDefinition[]): StatementOfAutonomy[] {
  return workers.map((w) => ({
    workerId: w.id,
    name: w.name,
    blastRadius: typeof w.blastRadius === 'number' ? w.blastRadius : 0.5,
    allowAutonomous: w.allowAutonomous !== false,
    statement:
      w.statementOfAutonomy ??
      `Worker '${w.name}' may take autonomous actions when effective confidence ≥ 0.85 and within budget. Human-in-the-loop is required for any action with blast radius ≥ 0.5.`,
  }));
}

// ── Test reset ──

export function _resetGovernance(): void {
  killState = { engaged: false };
  freezeWindows = [];
  tenantStamps.clear();
  backfilled = false;
}
