// ITSM Operations — Mock ServiceNow backend
// In-process HTTP server implementing a minimal Table API surface plus
// Business-Rule-equivalent webhook callbacks. Used by the demo-director and
// integration tests so the SNOW→Alex→SNOW loop runs end-to-end without a PDI.
//
// Lives under digital-worker/src/demo so the prod tree-shaker can drop it
// alongside the rest of the demo isolation surface.

import http from 'http';
import crypto from 'crypto';

// ── Types ──

export type SnowTable = 'incident' | 'change_request' | 'em_event' | 'problem';

export interface MockSnowRecord extends Record<string, unknown> {
  sys_id: string;
  sys_updated_on: string;
  sys_created_on: string;
  number?: string;
}

export interface BusinessRuleEvent {
  table: SnowTable;
  action: 'insert' | 'update';
  sys_id: string;
  sys_updated_on: string;
  current: MockSnowRecord;
  previous?: MockSnowRecord;
}

export interface MockSnowOptions {
  /** Bind port. Use 0 for an ephemeral port. */
  port?: number;
  /** HMAC secret shared with the snow-webhook function. */
  webhookSecret?: string;
  /** Webhook URL the mock POSTs Business-Rule events to. Optional. */
  webhookUrl?: string;
  /** Auth header value clients must send (defaults to 'Basic mock'). */
  expectedAuthHeader?: string;
}

const tablePrefix: Record<SnowTable, string> = {
  incident: 'INC',
  change_request: 'CHG',
  em_event: 'EVT',
  problem: 'PRB',
};

let counter = 1;
function nextSysId(): string {
  return `mock-${Date.now().toString(36)}-${(counter++).toString(36)}`;
}
function nextNumber(table: SnowTable): string {
  return `${tablePrefix[table]}${String(counter).padStart(7, '0')}`;
}

export function signPayload(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

// ── Server ──

export class MockServiceNow {
  private server?: http.Server;
  private tables: Record<SnowTable, Map<string, MockSnowRecord>> = {
    incident: new Map(),
    change_request: new Map(),
    em_event: new Map(),
    problem: new Map(),
  };
  private opts: Required<Omit<MockSnowOptions, 'webhookUrl'>> & { webhookUrl?: string };
  private deliveredEvents: BusinessRuleEvent[] = [];

  constructor(opts: MockSnowOptions = {}) {
    this.opts = {
      port: opts.port ?? 0,
      webhookSecret: opts.webhookSecret ?? 'mock-snow-secret',
      webhookUrl: opts.webhookUrl,
      expectedAuthHeader: opts.expectedAuthHeader ?? 'Basic bW9jazptb2Nr',
    };
  }

  async start(): Promise<{ port: number; baseUrl: string }> {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(this.opts.port, '127.0.0.1', resolve));
    const addr = this.server!.address();
    const port = typeof addr === 'object' && addr ? addr.port : this.opts.port;
    return { port, baseUrl: `http://127.0.0.1:${port}` };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) =>
      this.server!.close((err) => (err ? reject(err) : resolve())),
    );
    this.server = undefined;
  }

  /** Wipe all tables. */
  reset(): void {
    for (const t of Object.keys(this.tables) as SnowTable[]) {
      this.tables[t].clear();
    }
    this.deliveredEvents = [];
  }

  /** Delete records tagged with the given demo run id. */
  resetDemoRun(demoRunId: string): number {
    let removed = 0;
    for (const t of Object.keys(this.tables) as SnowTable[]) {
      for (const [sysId, record] of this.tables[t]) {
        if (record['u_demo_run'] === demoRunId) {
          this.tables[t].delete(sysId);
          removed++;
        }
      }
    }
    return removed;
  }

  getRecord(table: SnowTable, sysId: string): MockSnowRecord | undefined {
    return this.tables[table].get(sysId);
  }

  listRecords(table: SnowTable): MockSnowRecord[] {
    return Array.from(this.tables[table].values());
  }

  getDeliveredEvents(): BusinessRuleEvent[] {
    return [...this.deliveredEvents];
  }

  /** Test/demo helper that inserts a record without going through HTTP. */
  insertRecord(table: SnowTable, fields: Record<string, unknown>): MockSnowRecord {
    return this.insertInternal(table, fields, /*emit*/ true);
  }

  // ── HTTP handler ──

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const auth = req.headers['authorization'];
    if (auth !== this.opts.expectedAuthHeader) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const tableMatch = url.pathname.match(/^\/api\/now\/table\/([^/]+)(?:\/([^/]+))?$/);
    if (!tableMatch) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    const table = tableMatch[1] as SnowTable;
    const sysId = tableMatch[2];
    if (!this.tables[table]) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: `Unknown table ${table}` }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        if (req.method === 'GET' && sysId) {
          const record = this.tables[table].get(sysId);
          if (!record) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Record not found' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ result: record }));
          return;
        }
        if (req.method === 'POST' && !sysId) {
          const fields = body ? JSON.parse(body) : {};
          const record = this.insertInternal(table, fields, true);
          res.statusCode = 201;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ result: record }));
          return;
        }
        if ((req.method === 'PATCH' || req.method === 'PUT') && sysId) {
          const fields = body ? JSON.parse(body) : {};
          const updated = this.updateInternal(table, sysId, fields);
          if (!updated) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Record not found' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ result: updated }));
          return;
        }
        res.statusCode = 405;
        res.end(JSON.stringify({ error: 'Method not allowed' }));
      } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    });
  }

  private insertInternal(
    table: SnowTable,
    fields: Record<string, unknown>,
    emit: boolean,
  ): MockSnowRecord {
    const sys_id = (fields.sys_id as string) || nextSysId();
    const now = new Date().toISOString();
    const number = (fields.number as string) || nextNumber(table);
    const record: MockSnowRecord = {
      ...fields,
      sys_id,
      number,
      sys_created_on: now,
      sys_updated_on: now,
    };
    this.tables[table].set(sys_id, record);
    if (emit) {
      void this.emitBusinessRule({
        table,
        action: 'insert',
        sys_id,
        sys_updated_on: now,
        current: record,
      });
    }
    return record;
  }

  private updateInternal(
    table: SnowTable,
    sysId: string,
    fields: Record<string, unknown>,
  ): MockSnowRecord | null {
    const previous = this.tables[table].get(sysId);
    if (!previous) return null;
    const now = new Date().toISOString();
    const merged: MockSnowRecord = {
      ...previous,
      ...fields,
      sys_id: sysId,
      sys_updated_on: now,
    };
    this.tables[table].set(sysId, merged);
    void this.emitBusinessRule({
      table,
      action: 'update',
      sys_id: sysId,
      sys_updated_on: now,
      current: merged,
      previous,
    });
    return merged;
  }

  private async emitBusinessRule(event: BusinessRuleEvent): Promise<void> {
    this.deliveredEvents.push(event);
    if (!this.opts.webhookUrl) return;
    try {
      const body = JSON.stringify(event);
      const signature = signPayload(body, this.opts.webhookSecret);
      await fetch(this.opts.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-snow-signature': signature,
        },
        body,
      });
    } catch (err) {
      // Mock SNOW must not crash on webhook delivery failures.
      console.warn('[MockSnow] webhook delivery failed:', (err as Error).message);
    }
  }
}
