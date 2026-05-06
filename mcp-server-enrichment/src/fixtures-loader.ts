/**
 * Demo-mode fixture loader.
 *
 * When the caller's `tenant.profile === 'demo'` (signalled via
 * `x-itsm-profile: demo` header or `TENANT_PROFILE=demo` env), the
 * enrichment server returns committed JSON from `__fixtures__/` instead of
 * making live HTTP calls. This keeps demos hermetic and the wire-level
 * trace identical to a real KEV / NVD / MSRC / Azure / M365 / Nager
 * response (same shape, fewer fields).
 *
 * Hard rule (Phase E): "demo profile must return committed fixtures only;
 * no live network calls."
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Repo-root-relative `__fixtures__/` directory inside this package. */
const FIXTURES_DIR = join(__dirname, '..', '__fixtures__');

const cache = new Map<string, unknown>();

export type FixtureKey =
  | 'kev-fixture.json'
  | 'nvd-fixture.json'
  | 'msrc-fixture.json'
  | 'azure-status-fixture.json'
  | 'm365-health-fixture.json'
  | 'holidays-fixture.json';

export function loadFixture<T = unknown>(name: FixtureKey): T {
  if (cache.has(name)) return cache.get(name) as T;
  const path = join(FIXTURES_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`[fixtures-loader] fixture not found: ${path}`);
  }
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw);
  cache.set(name, parsed);
  return parsed as T;
}

export function fixturesDir(): string {
  return FIXTURES_DIR;
}
