/**
 * Test-only fixture loader.
 *
 * Tests can request the `demo` profile to return committed JSON without
 * making live HTTP calls. Runtime authentication never selects this profile.
 *
 * Production must never silently fall back to fixtures.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES_DIR = join(__dirname, '__tests__', 'fixtures');

const cache = new Map<string, unknown>();

export type FixtureKey =
  | 'kev-fixture.json'
  | 'nvd-fixture.json'
  | 'msrc-fixture.json'
  | 'azure-status-fixture.json'
  | 'm365-health-fixture.json'
  | 'holidays-fixture.json';

export function loadFixture<T = unknown>(name: FixtureKey): T {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('[fixtures-loader] fixtures are available only under NODE_ENV=test');
  }
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
