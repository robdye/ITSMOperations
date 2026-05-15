// ITSM Operations — Demo Director
// Public surface for orchestrating demo scenarios. Refuses to load unless the
// tenant profile has `allowDemoDirector: true`. Refuses to target a SNOW
// instance not on the per-tenant allow-list.

import fs from 'fs';
import path from 'path';
import { isSnowHostAllowed, loadTenantProfile, type TenantProfile } from './tenant-profile';
import { SnowInjector, DemoTargetNotAllowedError } from './snow-injector';
import { ScenarioRunner, type Scenario, type ScenarioRunReport } from './scenario-runner';

const SCENARIOS_DIR = path.resolve(__dirname, 'scenarios');

/** Tables that injectors stamp with `u_demo_run` and that cleanup targets. */
export const DEMO_TAGGED_TABLES = [
  'incident',
  'change_request',
  'problem',
  'em_event',
] as const;
export type DemoTaggedTable = (typeof DEMO_TAGGED_TABLES)[number];

/** Terminal-state codes used when DEMO_CLEANUP_MODE=close. */
const CLOSE_STATE_BY_TABLE: Record<DemoTaggedTable, string> = {
  // incident: 8 = Cancelled (numeric state per SNOW). Memory note: 1=New,2=InProgress,3=OnHold,6=Resolved,7=Closed,8=Cancelled.
  incident: '8',
  // change_request: 4 = Cancelled.
  change_request: '4',
  // problem: 4 = Closed/Resolved.
  problem: '4',
  // em_event: no canonical "cancelled" state — use 'Closed' string which SNOW accepts on event_state.
  em_event: 'Closed',
};

export interface DemoDirectorOptions {
  tenantId: string;
  instanceUrl: string;
  authHeader: string;
}

export interface ScenarioMetadata {
  id: string;
  description: string;
  stepCount: number;
  expectedOutcomes: string[];
}

export type DemoCleanupMode = 'delete' | 'close';

export interface DemoCleanupResult {
  mode: DemoCleanupMode;
  demoRunId?: string;
  perTable: Record<DemoTaggedTable, { found: number; cleaned: number; errors: string[] }>;
  totalFound: number;
  totalCleaned: number;
  errors: string[];
}

export class DemoDirector {
  private profile: TenantProfile;
  private opts: DemoDirectorOptions;
  private instanceUrl: string;

  constructor(opts: DemoDirectorOptions) {
    this.opts = opts;
    const profile = loadTenantProfile(opts.tenantId);
    if (!profile.allowDemoDirector) {
      throw new DemoTargetNotAllowedError(
        `Tenant '${opts.tenantId}' does not allow demo-director.`,
      );
    }
    if (!isSnowHostAllowed(profile, opts.instanceUrl)) {
      throw new DemoTargetNotAllowedError(
        `SNOW host ${opts.instanceUrl} is not on the allow-list for tenant '${opts.tenantId}'.`,
      );
    }
    this.profile = profile;
    this.instanceUrl = opts.instanceUrl.replace(/\/+$/, '');
  }

  /** Returns the list of available scenario ids. */
  list(): string[] {
    if (!fs.existsSync(SCENARIOS_DIR)) return [];
    return fs
      .readdirSync(SCENARIOS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  }

  /**
   * Returns scenarios with their description, step count, and expected outcomes
   * so the Mission Control picker can render meaningful options without a
   * second round-trip per scenario.
   */
  listDetailed(): ScenarioMetadata[] {
    if (!fs.existsSync(SCENARIOS_DIR)) return [];
    const out: ScenarioMetadata[] = [];
    for (const file of fs.readdirSync(SCENARIOS_DIR)) {
      if (!file.endsWith('.json')) continue;
      const id = file.replace(/\.json$/, '');
      try {
        const raw = fs.readFileSync(path.join(SCENARIOS_DIR, file), 'utf8');
        const parsed = JSON.parse(raw) as Partial<Scenario>;
        out.push({
          id: typeof parsed.id === 'string' && parsed.id ? parsed.id : id,
          description: typeof parsed.description === 'string' ? parsed.description : '',
          stepCount: Array.isArray(parsed.steps) ? parsed.steps.length : 0,
          expectedOutcomes: Array.isArray(parsed.expectedOutcomes)
            ? parsed.expectedOutcomes.filter((s): s is string => typeof s === 'string')
            : [],
        });
      } catch (err) {
        // Surface a placeholder so the picker still shows the file but flags it.
        out.push({
          id,
          description: `(failed to parse: ${(err as Error).message})`,
          stepCount: 0,
          expectedOutcomes: [],
        });
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Returns scenario metadata for a single id, or null if not found. */
  getScenarioMetadata(scenarioId: string): ScenarioMetadata | null {
    const file = path.join(SCENARIOS_DIR, `${scenarioId}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Scenario>;
      return {
        id: typeof parsed.id === 'string' && parsed.id ? parsed.id : scenarioId,
        description: typeof parsed.description === 'string' ? parsed.description : '',
        stepCount: Array.isArray(parsed.steps) ? parsed.steps.length : 0,
        expectedOutcomes: Array.isArray(parsed.expectedOutcomes)
          ? parsed.expectedOutcomes.filter((s): s is string => typeof s === 'string')
          : [],
      };
    } catch {
      return null;
    }
  }

  /** Execute a scenario end-to-end. */
  async run(scenarioId: string): Promise<ScenarioRunReport> {
    const file = path.join(SCENARIOS_DIR, `${scenarioId}.json`);
    if (!fs.existsSync(file)) {
      throw new Error(`Scenario not found: ${scenarioId}`);
    }
    const scenario = JSON.parse(fs.readFileSync(file, 'utf8')) as Scenario;
    const demoRunId = `${scenarioId}-${Date.now().toString(36)}`;
    const injector = new SnowInjector({
      tenantId: this.opts.tenantId,
      demoRunId,
      instanceUrl: this.opts.instanceUrl,
      authHeader: this.opts.authHeader,
    });
    const runner = new ScenarioRunner({ injector });
    return runner.run(scenario);
  }

  /**
   * Removes or closes demo-tagged records from the configured SNOW instance.
   * Scopes to a single demoRunId when provided; otherwise targets every
   * record where `u_demo_run` is set. Each table is queried independently and
   * a per-record error never aborts the sweep.
   */
  async cleanup(opts: { demoRunId?: string; mode?: DemoCleanupMode } = {}): Promise<DemoCleanupResult> {
    const mode: DemoCleanupMode = opts.mode === 'close' ? 'close' : 'delete';
    const result: DemoCleanupResult = {
      mode,
      demoRunId: opts.demoRunId,
      perTable: {
        incident: { found: 0, cleaned: 0, errors: [] },
        change_request: { found: 0, cleaned: 0, errors: [] },
        problem: { found: 0, cleaned: 0, errors: [] },
        em_event: { found: 0, cleaned: 0, errors: [] },
      },
      totalFound: 0,
      totalCleaned: 0,
      errors: [],
    };

    const query = opts.demoRunId
      ? `u_demo_run=${encodeURIComponent(opts.demoRunId)}`
      : 'u_demo_runISNOTEMPTY';

    for (const table of DEMO_TAGGED_TABLES) {
      try {
        const records = await this.queryTable(table, query);
        result.perTable[table].found = records.length;
        result.totalFound += records.length;

        for (const rec of records) {
          const sysId = String(rec.sys_id ?? '').trim();
          if (!sysId) continue;
          try {
            if (mode === 'delete') {
              await this.deleteRecord(table, sysId);
            } else {
              await this.closeRecord(table, sysId, opts.demoRunId);
            }
            result.perTable[table].cleaned += 1;
            result.totalCleaned += 1;
          } catch (err) {
            const msg = `${table}/${sysId}: ${(err as Error).message}`;
            result.perTable[table].errors.push(msg);
            result.errors.push(msg);
          }
        }
      } catch (err) {
        const msg = `${table}: ${(err as Error).message}`;
        result.perTable[table].errors.push(msg);
        result.errors.push(msg);
      }
    }

    return result;
  }

  getProfile(): TenantProfile {
    return this.profile;
  }

  // ── Internals ──

  private async queryTable(
    table: DemoTaggedTable,
    sysparmQuery: string,
  ): Promise<Array<Record<string, unknown>>> {
    // sysparm_fields keeps the payload minimal: we only need sys_id + the tag.
    const url =
      `${this.instanceUrl}/api/now/table/${table}` +
      `?sysparm_query=${sysparmQuery}` +
      `&sysparm_fields=sys_id,u_demo_run,number` +
      `&sysparm_limit=1000`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: this.opts.authHeader,
        Accept: 'application/json',
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`GET ${table} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    try {
      const parsed = JSON.parse(text) as { result?: Array<Record<string, unknown>> };
      return parsed.result ?? [];
    } catch {
      return [];
    }
  }

  private async deleteRecord(table: DemoTaggedTable, sysId: string): Promise<void> {
    const url = `${this.instanceUrl}/api/now/table/${table}/${encodeURIComponent(sysId)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: this.opts.authHeader,
        Accept: 'application/json',
      },
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`DELETE failed: ${res.status} ${text.slice(0, 200)}`);
    }
  }

  private async closeRecord(
    table: DemoTaggedTable,
    sysId: string,
    demoRunId?: string,
  ): Promise<void> {
    const state = CLOSE_STATE_BY_TABLE[table];
    const tag = demoRunId ? `[cleanup:run:${demoRunId}]` : '[cleanup:demo-data]';
    const body: Record<string, unknown> = {
      state,
      work_notes: `${tag} Demo data closed by demo-director cleanup`,
    };
    // close_code/close_notes are required on some incident close paths.
    if (table === 'incident' || table === 'problem') {
      body.close_code = 'Closed/Resolved by Caller';
      body.close_notes = `${tag} Demo data — auto-closed`;
    }
    const url = `${this.instanceUrl}/api/now/table/${table}/${encodeURIComponent(sysId)}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: this.opts.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`PATCH close failed: ${res.status} ${text.slice(0, 200)}`);
    }
  }
}

export { DemoTargetNotAllowedError } from './snow-injector';
