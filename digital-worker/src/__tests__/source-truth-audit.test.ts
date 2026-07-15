import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const repoRoot = '..';
const auditPath = `${repoRoot}/docs/audits/live-servicenow-connectivity-audit.md`;
const standardPath = `${repoRoot}/docs/api-mcp-handling-standard.md`;
const sourceSpecPath = `${repoRoot}/docs/source-status-endpoint-spec.md`;

describe('live ServiceNow source-truth audit artefacts', () => {
  it('documents the live ServiceNow connectivity gap and no-silent-fallback rule', () => {
    expect(existsSync(auditPath)).toBe(true);
    const audit = readFileSync(auditPath, 'utf8');
    expect(audit).toContain('ServiceNow');
    expect(audit.toLowerCase()).toContain('silent');
    expect(audit.toLowerCase()).toContain('fallback');
    expect(audit).toContain('Not yet proven');
  });

  it('defines source mode labels for operational responses', () => {
    expect(existsSync(standardPath)).toBe(true);
    const standard = readFileSync(standardPath, 'utf8');
    expect(standard).toContain('live-servicenow');
    expect(standard).not.toContain('synthetic-servicenow');
    expect(standard).toContain('auth-failed');
  });

  it('specifies a source status endpoint for Mission Control', () => {
    expect(existsSync(sourceSpecPath)).toBe(true);
    const spec = readFileSync(sourceSpecPath, 'utf8');
    expect(spec).toContain('GET /api/source-status');
    expect(spec).toContain('sourceMode');
  });
});
