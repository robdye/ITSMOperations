// Loads Adaptive Card templates, fills in data, returns for MCP response
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARDS_DIR = path.resolve(__dirname, '..', 'src', 'adaptive-cards');

export interface CardData {
  [key: string]: unknown;
}

export function renderCard(templateName: string, data: CardData): object {
  const templatePath = path.join(CARDS_DIR, `${templateName}.json`);
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  // Simple template variable replacement
  return fillTemplate(template, data) as object;
}

function fillTemplate(obj: unknown, data: CardData): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+(?:\.\w+)*)}/g, (_, key) => {
      const parts = key.split('.');
      let val: unknown = data;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      return val !== undefined ? String(val) : `\${${key}}`;
    });
  }
  if (Array.isArray(obj)) return obj.map(item => fillTemplate(item, data));
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) result[k] = fillTemplate(v, data);
    return result;
  }
  return obj;
}

export function getAvailableCards(): string[] {
  if (!fs.existsSync(CARDS_DIR)) return [];
  return fs.readdirSync(CARDS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}
