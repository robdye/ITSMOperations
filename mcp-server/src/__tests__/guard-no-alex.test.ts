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
    // Allow-list FIRST: any line containing the literal token "// guard:allow"
    // is excluded from scanning entirely. Use sparingly — must be on the same
    // line as the legitimate reference.
    content = content
      .split(/\r?\n/)
      .filter((line) => !/\/\/\s*guard:allow\b/.test(line))
      .join('\n');
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
            `DA-visible UX must not reference Alex's runtime. ` +
            `If this is a legitimate reference, append " // guard:allow" to the line.`,
          );
        }
      }
    });
  }

  // Self-test: the regex set must actually fire on hostile content. This
  // proves the guard would catch a regression — without it, a future change
  // could remove the rules silently and the test would still pass vacuously.
  describe('self-test (proves guard would fire)', () => {
    const hostileFixtures: { label: string; content: string }[] = [
      { label: 'digital-worker /api/signals call', content: 'fetch("/api/signals")' },
      { label: 'digital-worker /api/foresight call', content: 'fetch("/api/foresight/recent")' },
      { label: 'whole-word Alex', content: 'const greeting = "Hi from Alex";' },
      { label: 'autonomy framing', content: 'const desc = "agent autonomy level";' },
      { label: 'signal-router import', content: 'import { route } from "./signal-router";' },
      { label: 'trigger-policy framing', content: 'const x = "trigger-policy";' },
      { label: 'foresight framing', content: 'const x = "foresight engine";' },
    ];
    for (const { label, content } of hostileFixtures) {
      it(`would flag: ${label}`, () => {
        const fired = FORBIDDEN_PATTERNS.some(({ re }) => re.test(content));
        expect(fired).toBe(true);
      });
    }
    it('does NOT flag benign words like "Alexa"', () => {
      const fired = FORBIDDEN_PATTERNS.some(({ re }) => re.test('Alexa, play music'));
      expect(fired).toBe(false);
    });
    it('respects the // guard:allow allow-list', () => {
      // Build a TS-style snippet with the allow-list marker; the same
      // scanner the live test uses must filter it out.
      const tmp = path.join(MCP_ROOT, 'src', '__tests__', '__guard_fixture__.ts');
      fs.writeFileSync(tmp, `const link = "/api/signals"; // guard:allow\n`);
      try {
        let content = fs.readFileSync(tmp, 'utf8');
        // Match scanContent's order: filter allow-list lines BEFORE stripping comments.
        content = content
          .split(/\r?\n/)
          .filter((line) => !/\/\/\s*guard:allow\b/.test(line))
          .join('\n')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        const fired = FORBIDDEN_PATTERNS.some(({ re }) => re.test(content));
        expect(fired).toBe(false);
      } finally {
        fs.unlinkSync(tmp);
      }
    });
  });
});
