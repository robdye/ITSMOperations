/**
 * Widget build script.
 *
 *  - Reads `_icons.mjs` and substitutes any `{{icon:NAME}}` or `{{wordmark}}`
 *    tokens in HTML so widgets stay self-contained.
 *  - Copies the result to `mcp-server/assets/`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname);
const DEST = path.resolve(__dirname, "..", "assets");

if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });

// Load icon library.
const iconsModuleUrl = pathToFileURL(path.join(SRC, "_icons.mjs")).href;
const { ICONS, WORDMARK_SVG } = await import(iconsModuleUrl);

function substituteIcons(html) {
  return html
    .replace(/\{\{icon:([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (_m, name) => {
      const svg = ICONS[name];
      if (!svg) {
        console.warn(`  ! Unknown icon token: ${name}`);
        return "";
      }
      return svg;
    })
    .replace(/\{\{wordmark\}\}/g, WORDMARK_SVG);
}

const htmlFiles = fs.readdirSync(SRC).filter((f) => f.endsWith(".html"));
for (const file of htmlFiles) {
  const src = fs.readFileSync(path.join(SRC, file), "utf8");
  const out = substituteIcons(src);
  fs.writeFileSync(path.join(DEST, file), out, "utf8");
  console.log(`  OK ${file} -> assets/${file}`);
}
console.log(`\n  ${htmlFiles.length} widget(s) built to assets/\n`);
