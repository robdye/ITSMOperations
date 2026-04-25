// ITSM Asset & CMDB Management tools
// ITIL 4 Practices: IT Asset Management + Service Configuration Management
// Side effects: create_asset, update_asset (write)

import { tool } from '@openai/agents';
import { z } from 'zod';
import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

function stringify(data: unknown): string {
  if (typeof data === 'string') return data;
  return JSON.stringify(data, null, 2);
}

export const assetCmdbTools = [
  tool({
    name: 'get_cmdb_ci',
    description: 'Look up a configuration item in the CMDB by name.',
    parameters: z.object({ name: z.string().describe('CI name to look up') }),
    execute: async ({ name }) => stringify(await mcp.getCmdbCi(name)),
  }),

  tool({
    name: 'get_ci_relationships',
    description: 'Get relationships and dependencies for a CI by its sys_id.',
    parameters: z.object({ ci_sys_id: z.string().describe('sys_id of the configuration item') }),
    execute: async ({ ci_sys_id }) => stringify(await mcp.getCiRelationships(ci_sys_id)),
  }),

  tool({
    name: 'get_assets',
    description: 'Query IT assets from ServiceNow with optional filters.',
    parameters: z.object({
      category: z.string().optional().describe('Filter by asset category'),
      status: z.string().optional().describe('Filter by asset status'),
    }),
    execute: async ({ category, status }) => {
      const filters: Record<string, unknown> = {};
      if (category) filters.category = category;
      if (status) filters.status = status;
      return stringify(await mcp.getAssets(filters));
    },
  }),

  tool({
    name: 'get_expired_warranties',
    description: 'Get assets with expired warranties.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.getExpiredWarranties()),
  }),

  tool({
    name: 'show_asset_lifecycle',
    description: 'Show the asset lifecycle dashboard — EOL dates, warranty status, refresh planning.',
    parameters: z.object({}),
    execute: async () => stringify(await mcp.getAssetLifecycle()),
  }),

  tool({
    name: 'check_eol_status',
    description: 'Check end-of-life status for a product and version using endoflife.date API.',
    parameters: z.object({
      product: z.string().describe('Product name, e.g. "nodejs", "windows", "ubuntu"'),
      version: z.string().describe('Version string, e.g. "18", "11", "22.04"'),
    }),
    execute: async ({ product, version }) => stringify(await mcp.checkEolStatus(product, version)),
  }),

  tool({
    name: 'create_asset',
    description: 'Create a new hardware asset in ServiceNow. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      data: z.string().describe('JSON object of asset fields, e.g. {"display_name":"Server-01","asset_tag":"A001","serial_number":"SN123"}'),
    }),
    execute: async ({ data }) => stringify(await mcp.createAsset(JSON.parse(data))),
  }),

  tool({
    name: 'update_asset',
    description: 'Update an existing hardware asset in ServiceNow. WRITE OPERATION — confirm with user before executing.',
    parameters: z.object({
      sys_id: z.string().describe('sys_id of the asset to update'),
      fields: z.string().describe('JSON object of fields to update, e.g. {"install_status":"retired","assigned_to":"user123"}'),
    }),
    execute: async ({ sys_id, fields }) => stringify(await mcp.updateAsset(sys_id, JSON.parse(fields))),
  }),
];
