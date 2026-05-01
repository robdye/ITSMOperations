// ITSM Operations — SNOW injector (demo-only)
// Thin wrapper used exclusively by the demo-director to insert/update records
// in a ServiceNow instance (real PDI or mock-snow). Every record is tagged
// with `u_demo_run` and a `[demo:run:<id>]` work_notes prefix so cleanup is
// bullet-proof. Rate-limited to keep scenarios from hammering the target.

import { isSnowHostAllowed, loadTenantProfile, type TenantProfile } from './tenant-profile';

export interface SnowInjectorOptions {
  /** Tenant whose profile gates this injector. */
  tenantId: string;
  /** Demo-run id stamped on every record. */
  demoRunId: string;
  /** Base URL of the SNOW instance (real PDI or mock-snow). */
  instanceUrl: string;
  /** Auth header value (Basic … or Bearer …). */
  authHeader: string;
  /** Optional max requests per second (defaults to 5). */
  rateLimitRps?: number;
}

interface InjectorContext {
  profile: TenantProfile;
  instanceUrl: string;
  authHeader: string;
  demoRunId: string;
  rateLimitRps: number;
}

export class DemoTargetNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoTargetNotAllowedError';
  }
}

export class SnowInjector {
  private ctx: InjectorContext;
  private lastRequestAt = 0;

  constructor(opts: SnowInjectorOptions) {
    const profile = loadTenantProfile(opts.tenantId);
    if (!profile.allowDemoDirector) {
      throw new DemoTargetNotAllowedError(
        `Tenant ${opts.tenantId} does not have allowDemoDirector enabled.`,
      );
    }
    if (!isSnowHostAllowed(profile, opts.instanceUrl)) {
      throw new DemoTargetNotAllowedError(
        `SNOW instance ${opts.instanceUrl} is not on the allow-list for tenant ${opts.tenantId}.`,
      );
    }
    this.ctx = {
      profile,
      instanceUrl: opts.instanceUrl.replace(/\/+$/, ''),
      authHeader: opts.authHeader,
      demoRunId: opts.demoRunId,
      rateLimitRps: opts.rateLimitRps ?? 5,
    };
  }

  async createIncident(fields: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.create('incident', fields);
  }

  async createChangeRequest(fields: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.create('change_request', fields);
  }

  async addEvent(fields: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.create('em_event', fields);
  }

  async updateRecord(
    table: 'incident' | 'change_request' | 'em_event' | 'problem',
    sysId: string,
    fields: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    await this.throttle();
    const body = JSON.stringify(this.tagFields(fields, /*isUpdate*/ true));
    const res = await this.request('PATCH', `/api/now/table/${table}/${encodeURIComponent(sysId)}`, body);
    return res;
  }

  /** Caller-driven cleanup; demo-runner uses this in tests. */
  getDemoRunId(): string {
    return this.ctx.demoRunId;
  }

  // ── Internals ──

  private async create(
    table: 'incident' | 'change_request' | 'em_event' | 'problem',
    fields: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    await this.throttle();
    const body = JSON.stringify(this.tagFields(fields, /*isUpdate*/ false));
    return this.request('POST', `/api/now/table/${table}`, body);
  }

  private tagFields(fields: Record<string, unknown>, isUpdate: boolean): Record<string, unknown> {
    const next: Record<string, unknown> = { ...fields, u_demo_run: this.ctx.demoRunId };
    if (!isUpdate) {
      const note = String(fields.work_notes ?? '');
      next.work_notes = `[demo:run:${this.ctx.demoRunId}] ${note}`.trim();
    }
    return next;
  }

  private async throttle(): Promise<void> {
    const minSpacingMs = 1000 / Math.max(1, this.ctx.rateLimitRps);
    const now = Date.now();
    const wait = this.lastRequestAt + minSpacingMs - now;
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    this.lastRequestAt = Date.now();
  }

  private async request(method: 'POST' | 'PATCH', path: string, body: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.ctx.instanceUrl}${path}`, {
      method,
      headers: {
        Authorization: this.ctx.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`SNOW ${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`);
    }
    try {
      const parsed = JSON.parse(text) as { result?: Record<string, unknown> };
      return parsed.result ?? {};
    } catch {
      return {};
    }
  }
}
