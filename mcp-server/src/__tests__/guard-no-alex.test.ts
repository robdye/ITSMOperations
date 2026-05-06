import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
// __dirname = <repo>/mcp-server/src/__tests__
const MCP_ROOT = path.resolve(__dirname, '..', '..');     // <repo>/mcp-server
const REPO_ROOT = path.resolve(MCP_ROOT, '..');           // <repo>

// Forbidden references — the DA must not call, reference, or depend on Alex's runtime.
// Quote (DA Visual Upgrade build prompt):
//   "no reference to 'Alex', 'signal', 'workflow', 'autonomy', 'foresight', 'trigger-policy'
//    in DA-visible UX."
//   "No HTTP calls to any digital-worker /api/* endpoint."
const FORBIDDEN_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'digital-worker /api/* endpoints', re: /\/api\/(signals|goals|governance|voice|cognition|foresight|outcomes|trigger-policy)\b/i },
  { name: 'Alex (the runtime persona)', re: /\bAlex\b/ },
  { name: 'signal-router', re: /signal[-_]router/i },
  { name: 'autonomy framing', re: /\bautonomy\b/i },
  { name: 'foresight framing', re: /\bforesight\b/i },
  { name: 'trigger-policy framing', re: /trigger[-_]policy/i },
];

const SCAN_DIRS = [
  path.join(MCP_ROOT, 'widgets'),
  path.join(MCP_ROOT, 'assets'),
  path.join(REPO_ROOT, 'appPackage'),
  // Phase C.4 — Loop component generators are DA-visible payload sources;
  // any string they emit reaches Loop / Teams / Outlook surfaces.
  path.join(MCP_ROOT, 'src', 'loop-components'),
];

function listFiles(dir: string, exts: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // skip nested build / extracted dirs to avoid scanning duplicates
      if (entry.name === 'build' || entry.name === 'extracted') continue;
      out.push(...listFiles(full, exts));
    } else if (exts.some((e) => entry.name.toLowerCase().endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

describe('Guard: DA must not reference Alex / digital-worker runtime', () => {
  const files = SCAN_DIRS.flatMap((d) => listFiles(d, ['.html', '.json', '.txt', '.ts']));

  // For TypeScript sources we strip comments before matching so guard-doc
  // comments ("// guarded by …") that explicitly mention the forbidden tokens
  // do not flag themselves. String literals, identifiers, JSX, etc. are still
  // scanned. JSON / HTML / TXT files are scanned as-is.
  function scanContent(file: string): string {
    let content = fs.readFileSync(file, 'utf8');
    if (file.toLowerCase().endsWith('.ts')) {
      content = content
        .replace(/\/\*[\s\S]*?\*\//g, '')   // strip /* … */ blocks
        .replace(/(^|[^:])\/\/.*$/gm, '$1'); // strip // line comments (but NOT URL "://")
    }
    return content;
  }

  it('discovers DA-facing files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${path.relative(REPO_ROOT, file)} is clean`, () => {
      const content = scanContent(file);
      for (const { name, re } of FORBIDDEN_PATTERNS) {
        const m = content.match(re);
        if (m) {
          throw new Error(
            `Forbidden pattern "${name}" matched "${m[0]}" in ${path.relative(REPO_ROOT, file)}. ` +
            `DA-visible UX must not reference Alex's runtime.`,
          );
        }
      }
    });
  }
});
