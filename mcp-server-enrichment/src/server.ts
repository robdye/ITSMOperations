/**
 * Enrichment MCP server factory.
 *
 * Registers 9 tools (intent-led names from the Phase E spec):
 *   - enrichment.kev.lookup
 *   - enrichment.kev.recent
 *   - enrichment.cve.detail
 *   - enrichment.cve.byProduct
 *   - enrichment.msrc.monthly
 *   - enrichment.cloud.azure.status
 *   - enrichment.cloud.m365.health
 *   - enrichment.holidays.byCountry
 *   - enrichment.holidays.isHolidayOn
 *
 * Per-request `createEnrichmentServer(ctx)` so the auth context is closed
 * over by every CallTool handler.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import type { EnrichmentAuthContext } from './auth.js';
import { lookupKev, recentKev } from './sources/cisa-kev.js';
import { cveDetail, cveByProduct } from './sources/nvd.js';
import { msrcMonthly } from './sources/msrc.js';
import { azureStatus } from './sources/azure-status.js';
import { m365Health } from './sources/m365-service-health.js';
import { holidaysByCountry, isHolidayOn } from './sources/nager-holidays.js';

const TOOLS: Tool[] = [
  {
    name: 'enrichment.kev.lookup',
    description:
      'Look up CISA Known Exploited Vulnerabilities (KEV) entries that match a product or vendor name. Read-only intelligence call.',
    inputSchema: {
      type: 'object',
      properties: {
        productOrVendor: { type: 'string', description: 'Product or vendor substring, e.g. "Log4j" or "Microsoft".' },
      },
      required: ['productOrVendor'],
    },
  },
  {
    name: 'enrichment.kev.recent',
    description: 'Return CISA KEV catalog entries added within the past N hours.',
    inputSchema: {
      type: 'object',
      properties: {
        hours: { type: 'number', minimum: 1, maximum: 720, default: 24 },
      },
      required: ['hours'],
    },
  },
  {
    name: 'enrichment.cve.detail',
    description: 'Fetch NVD CVE detail (description, CVSS v3.1 score, references) for a given CVE id.',
    inputSchema: {
      type: 'object',
      properties: {
        cveId: { type: 'string', description: 'CVE identifier, e.g. "CVE-2024-43572".' },
      },
      required: ['cveId'],
    },
  },
  {
    name: 'enrichment.cve.byProduct',
    description: 'Search NVD for CVEs by free-text keyword or CPE name.',
    inputSchema: {
      type: 'object',
      properties: {
        cpeOrProduct: { type: 'string', description: 'Product keyword or CPE 2.3 string (must start with "cpe:" for CPE).' },
      },
      required: ['cpeOrProduct'],
    },
  },
  {
    name: 'enrichment.msrc.monthly',
    description: 'Fetch the Microsoft MSRC CVRF document for a given Patch Tuesday id (e.g. "2024-Oct").',
    inputSchema: {
      type: 'object',
      properties: {
        yearMonth: { type: 'string', description: 'CVRF document id (e.g. "2024-Oct").' },
      },
      required: ['yearMonth'],
    },
  },
  {
    name: 'enrichment.cloud.azure.status',
    description: 'Return active Azure Status incidents (optionally filtered by region).',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string', description: 'Optional Azure region (e.g. "East US 2").' },
      },
    },
  },
  {
    name: 'enrichment.cloud.m365.health',
    description: 'Return Microsoft 365 Service Health overview (Exchange, Teams, SharePoint, etc).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'enrichment.holidays.byCountry',
    description: 'Return public holidays for a country and year (Nager.Date).',
    inputSchema: {
      type: 'object',
      properties: {
        year: { type: 'number', minimum: 1970, maximum: 2100 },
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code, e.g. "US".' },
      },
      required: ['year', 'country'],
    },
  },
  {
    name: 'enrichment.holidays.isHolidayOn',
    description:
      'Check whether the given ISO date is a national holiday in the given country. Used by change-manager to refuse change windows on holidays.',
    inputSchema: {
      type: 'object',
      properties: {
        country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code.' },
        date: { type: 'string', description: 'YYYY-MM-DD date to check.' },
      },
      required: ['country', 'date'],
    },
  },
];

export function listEnrichmentTools(): Tool[] {
  return [...TOOLS];
}

function ok<T>(payload: T): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

function fail(message: string): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/**
 * Per-request server. The OBO + tenant context is captured at construction
 * time (set by the Express layer in `index.ts`) and read by each tool.
 */
export function createEnrichmentServer(ctx: EnrichmentAuthContext): Server {
  const server = new Server(
    {
      name: 'enrichment-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: { listChanged: false },
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case 'enrichment.kev.lookup': {
          if (typeof args.productOrVendor !== 'string') return fail('productOrVendor (string) required');
          return ok(await lookupKev({ productOrVendor: args.productOrVendor }, ctx));
        }
        case 'enrichment.kev.recent': {
          const hours = typeof args.hours === 'number' ? args.hours : 24;
          return ok(await recentKev({ hours }, ctx));
        }
        case 'enrichment.cve.detail': {
          if (typeof args.cveId !== 'string') return fail('cveId (string) required');
          return ok(await cveDetail({ cveId: args.cveId }, ctx));
        }
        case 'enrichment.cve.byProduct': {
          if (typeof args.cpeOrProduct !== 'string') return fail('cpeOrProduct (string) required');
          return ok(await cveByProduct({ cpeOrProduct: args.cpeOrProduct }, ctx));
        }
        case 'enrichment.msrc.monthly': {
          if (typeof args.yearMonth !== 'string') return fail('yearMonth (string) required');
          return ok(await msrcMonthly({ yearMonth: args.yearMonth }, ctx));
        }
        case 'enrichment.cloud.azure.status': {
          const region = typeof args.region === 'string' ? args.region : undefined;
          return ok(await azureStatus({ region }, ctx));
        }
        case 'enrichment.cloud.m365.health': {
          return ok(await m365Health({}, ctx));
        }
        case 'enrichment.holidays.byCountry': {
          if (typeof args.year !== 'number' || typeof args.country !== 'string') {
            return fail('year (number) and country (string) required');
          }
          return ok(await holidaysByCountry({ year: args.year, country: args.country }, ctx));
        }
        case 'enrichment.holidays.isHolidayOn': {
          if (typeof args.country !== 'string' || typeof args.date !== 'string') {
            return fail('country (string) and date (YYYY-MM-DD string) required');
          }
          return ok(await isHolidayOn({ country: args.country, date: args.date }, ctx));
        }
        default:
          return fail(`Unknown tool: ${name}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[enrichment] tool ${name} failed:`, msg);
      return fail(`tool error: ${msg}`);
    }
  });

  return server;
}
