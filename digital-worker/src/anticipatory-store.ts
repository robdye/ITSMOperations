// ITSM Operations — Anticipatory State Store (Phase 9.1)
//
// Generic Azure Table Storage wrapper that backs the four anticipatory state
// stores (foresight forecasts, outcome history, autonomy-tuner overrides,
// governance budget ledger) introduced in Phases 5–7.
//
// Why this exists:
//   The Phase 5–7 modules (`foresight.ts`, `outcome-verifier.ts`,
//   `autonomy-tuner.ts`, `governance.ts`) keep their state in process memory.
//   That means the bandit never reaches `warmedUp:true` across restarts,
//   forecasts vanish, outcome stats reset, and the budget ledger forgets
//   throttling. This module persists each store to a dedicated Table
//   following the same connection pattern as `audit-trail.ts`, and falls
//   back to in-memory only when storage is not configured.
//
// Design:
//   - One TableClient per logical store (lazy init on first write).
//   - PartitionKey = caller-provided shard (e.g. workflowId for tuner state,
//     tenantId for governance, "global" for foresight).
//   - RowKey = caller-provided id (forecast id, outcome rowKey, etc.).
//   - Payload columns stored as `payload` JSON string (Table Storage does not
//     accept nested objects).
//   - `loadRecent` is the cold-start backfill helper used by each store.
//   - `upsert` is the write-through used after every update.
//
// Auth:
//   Same env-var trio as `audit-trail.ts`:
//     - `AUDIT_STORAGE_CONNECTION_STRING` (preferred, used by Cosmos+Tables in prod)
//     - `AUDIT_STORAGE_ACCOUNT` + `AUDIT_STORAGE_KEY` (named-key fallback)
//   When neither is set the store reports `backend: 'memory'` and the in-memory
//   implementations in foresight/outcome-verifier/etc. continue unchanged.

import { TableClient, AzureNamedKeyCredential, odata } from '@azure/data-tables';

const STORAGE_ACCOUNT = process.env.AUDIT_STORAGE_ACCOUNT || '';
const STORAGE_KEY = process.env.AUDIT_STORAGE_KEY || '';
const STORAGE_CONNECTION_STRING = process.env.AUDIT_STORAGE_CONNECTION_STRING || '';

export type AnticipatoryBackend = 'azure-table' | 'memory';

interface ClientHolder {
  tableName: string;
  client: TableClient | null;
  initialised: boolean;
}

const holders = new Map<string, ClientHolder>();

function holder(tableName: string): ClientHolder {
  let h = holders.get(tableName);
  if (!h) {
    h = { tableName, client: null, initialised: false };
    holders.set(tableName, h);
  }
  return h;
}

async function ensureClient(tableName: string): Promise<TableClient | null> {
  const h = holder(tableName);
  if (h.initialised) return h.client;
  h.initialised = true;

  let candidate: TableClient | null = null;
  try {
    if (STORAGE_CONNECTION_STRING) {
      candidate = TableClient.fromConnectionString(STORAGE_CONNECTION_STRING, tableName);
    } else if (STORAGE_ACCOUNT && STORAGE_KEY) {
      const cred = new AzureNamedKeyCredential(STORAGE_ACCOUNT, STORAGE_KEY);
      candidate = new TableClient(
        `https://${STORAGE_ACCOUNT}.table.core.windows.net`,
        tableName,
        cred,
      );
    } else {
      console.log(`[AnticipatoryStore] No Azure Table Storage configured for ${tableName} — using in-memory only`);
      return null;
    }
    await candidate.createTable();
    console.log(`[AnticipatoryStore] Connected to Azure Table Storage: ${tableName}`);
  } catch (err: any) {
    if (err?.statusCode === 409) {
      console.log(`[AnticipatoryStore] Table ${tableName} already exists`);
    } else {
      console.warn(`[AnticipatoryStore] init failed for ${tableName}, using in-memory:`, err?.message);
      candidate = null;
    }
  }
  h.client = candidate;
  return candidate;
}

export interface StoredEntry<T> {
  partitionKey: string;
  rowKey: string;
  payload: T;
  /** ISO timestamp set on write. */
  updatedAt: string;
}

/** Write-through upsert. Silent no-op when storage is not configured. */
export async function upsertEntry<T>(
  tableName: string,
  partitionKey: string,
  rowKey: string,
  payload: T,
): Promise<void> {
  const client = await ensureClient(tableName);
  if (!client) return;
  try {
    await client.upsertEntity(
      {
        partitionKey,
        rowKey,
        payload: JSON.stringify(payload),
        updatedAt: new Date().toISOString(),
      },
      'Replace',
    );
  } catch (err: any) {
    console.warn(`[AnticipatoryStore] upsert failed (${tableName}/${partitionKey}/${rowKey}):`, err?.message);
  }
}

/** Delete a single entry. Silent no-op when storage is not configured. */
export async function deleteEntry(
  tableName: string,
  partitionKey: string,
  rowKey: string,
): Promise<void> {
  const client = await ensureClient(tableName);
  if (!client) return;
  try {
    await client.deleteEntity(partitionKey, rowKey);
  } catch (err: any) {
    if (err?.statusCode !== 404) {
      console.warn(`[AnticipatoryStore] delete failed (${tableName}/${partitionKey}/${rowKey}):`, err?.message);
    }
  }
}

/**
 * Load up to `limit` entries (optionally filtered to a partition).
 * Returns [] when storage is not configured or the load fails.
 */
export async function loadRecent<T>(
  tableName: string,
  options: { partitionKey?: string; limit?: number } = {},
): Promise<StoredEntry<T>[]> {
  const client = await ensureClient(tableName);
  if (!client) return [];
  const limit = options.limit ?? 500;
  const filter = options.partitionKey
    ? odata`PartitionKey eq ${options.partitionKey}`
    : undefined;
  const out: StoredEntry<T>[] = [];
  try {
    const iter = client.listEntities<{ partitionKey: string; rowKey: string; payload: string; updatedAt: string }>(
      filter ? { queryOptions: { filter } } : undefined,
    );
    for await (const e of iter) {
      try {
        out.push({
          partitionKey: e.partitionKey,
          rowKey: e.rowKey,
          payload: JSON.parse(e.payload) as T,
          updatedAt: e.updatedAt,
        });
      } catch {
        // Skip malformed rows — they will be overwritten on next upsert.
      }
      if (out.length >= limit) break;
    }
  } catch (err: any) {
    console.warn(`[AnticipatoryStore] loadRecent failed (${tableName}):`, err?.message);
  }
  // Sort newest-first so callers that take(N) get the most recent.
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

export function getBackend(tableName: string): AnticipatoryBackend {
  return holder(tableName).client ? 'azure-table' : 'memory';
}

/** Test helper — drops cached clients so the next call re-initialises. */
export function _resetAnticipatoryStore(): void {
  holders.clear();
}

// ── Logical table names ──
export const ANTICIPATORY_TABLES = {
  forecasts: 'AlexForecasts',
  outcomes: 'AlexOutcomes',
  tuner: 'AlexTunerState',
  governance: 'AlexGovernance',
} as const;
