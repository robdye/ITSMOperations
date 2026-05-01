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

export interface DemoDirectorOptions {
  tenantId: string;
  instanceUrl: string;
  authHeader: string;
}

export class DemoDirector {
  private profile: TenantProfile;
  private opts: DemoDirectorOptions;

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
  }

  /** Returns the list of available scenario ids. */
  list(): string[] {
    if (!fs.existsSync(SCENARIOS_DIR)) return [];
    return fs
      .readdirSync(SCENARIOS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
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

  getProfile(): TenantProfile {
    return this.profile;
  }
}

export { DemoTargetNotAllowedError } from './snow-injector';
