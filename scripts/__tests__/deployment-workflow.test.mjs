import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'deploy.yml'), 'utf8');

test('deploys the exact commit that passed CI', () => {
  assert.match(workflow, /github\.event\.workflow_run\.head_sha/);
  assert.match(workflow, /ref:\s*\$\{\{\s*env\.DEPLOY_SHA\s*\}\}/);
});

test('uses production Teams configuration', () => {
  assert.doesNotMatch(workflow, /teamsapp deploy --env dev/);
  assert.match(workflow, /teamsapp deploy --env prod/);
});

test('requires every production component and validates live sources', () => {
  assert.doesNotMatch(workflow, /skip if app missing/i);
  assert.match(workflow, /validate-live-deployment\.mjs/);
  assert.match(workflow, /EXPECTED_COMMIT_SHA/);
});

test('rolls application code and configuration back after a failed release', () => {
  assert.match(workflow, /Rollback Container Apps/);
  assert.match(workflow, /steps\.previous\.outputs\.dw-image/);
  assert.match(workflow, /--replace-env-vars/);
  assert.match(workflow, /steps\.readiness\.outcome\s*!=\s*'success'/);
  assert.match(workflow, /Rollback Functions after failed release/);
  assert.match(workflow, /previous-functions\.zip/);
  assert.match(workflow, /needs\.deploy\.result\s*!=\s*'success'/);
  assert.match(workflow, /graph-\$\{secret_suffix\}/);
  assert.match(workflow, /scheduled-\$\{secret_suffix\}/);
});

test('requires an explicit production Functions target', () => {
  assert.match(workflow, /FUNCTIONS_APP:\s*\$\{\{\s*vars\.FUNCTIONS_APP_NAME\s*\}\}/);
  assert.doesNotMatch(workflow, /FUNCTIONS_APP_NAME\s*\|\|/);
});
