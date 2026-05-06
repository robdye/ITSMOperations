import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ASSETS = path.resolve(__dirname, '..', '..', 'assets');

// Smoke test contract for the 6 new manager-facing widgets shipped with the
// "DA Visual Upgrade" build. Each widget must:
//   - exist in mcp-server/assets/ (i.e. build.mjs ran cleanly)
//   - resolve every {{icon:...}} and {{wordmark}} token
//   - include the brand-bar element (Phase 3 polish)
//   - read window.__TOOL_DATA__ (data injection contract)
//   - respect prefers-reduced-motion (Phase 3)
//   - include the canonical wordmark or footer text "ITSM Operations"
const WIDGETS = [
  'command-bridge',
  'estate-heatmap',
  'time-travel',
  'change-collisions',
  'cab-pack',
  'outcome-story',
];

describe('Manager-facing widgets — built asset smoke test', () => {
  for (const w of WIDGETS) {
    describe(w, () => {
      const file = path.join(ASSETS, `${w}.html`);
      const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

      it('exists in assets/', () => {
        expect(fs.existsSync(file)).toBe(true);
        expect(content.length).toBeGreaterThan(1000);
      });

      it('has no unresolved icon/wordmark tokens', () => {
        expect(content).not.toMatch(/\{\{icon:[a-zA-Z0-9_]+\}\}/);
        expect(content).not.toMatch(/\{\{wordmark\}\}/);
      });

      it('includes the Phase 3 brand bar', () => {
        expect(content).toMatch(/class="brand-bar"/);
      });

      it('reads window.__TOOL_DATA__ for data injection', () => {
        expect(content).toMatch(/window\.__TOOL_DATA__/);
      });

      it('respects prefers-reduced-motion', () => {
        expect(content).toMatch(/prefers-reduced-motion/);
      });

      it('contains the ITSM Operations wordmark', () => {
        expect(content).toMatch(/ITSM Operations/);
      });

      it('wires sendFollowUp for click interactions', () => {
        // every widget except outcome-story may not have it if static; check majority.
        // command-bridge / estate-heatmap / time-travel / change-collisions / cab-pack / outcome-story
        // all wire sendFollowUp.
        expect(content).toMatch(/sendFollowUp/);
      });
    });
  }
});
