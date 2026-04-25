/**
 * Microsoft Graph Connectors — Index ServiceNow data into M365 Search.
 * Makes ITSM incidents, KB articles, and CIs searchable directly
 * in Microsoft 365 Copilot and SharePoint search.
 *
 * Registers the "ITSMServiceNow" external connection and defines
 * a schema with: title, description, priority, state, assignee,
 * category, createdDate, updatedDate, url.
 */

import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';
import { DefaultAzureCredential } from '@azure/identity';

// ── Configuration ──
const CONNECTION_ID = process.env.GRAPH_CONNECTOR_ID || 'ITSMServiceNow';
const GRAPH_SCOPES = ['https://graph.microsoft.com/.default'];

let graphClient: Client | null = null;

// ── Types ──
export interface ConnectorItem {
  id: string;
  title: string;
  description: string;
  url: string;
  content: string;
  itemType: 'incident' | 'kb_article' | 'change' | 'problem' | 'ci';
  properties: Record<string, string | number | boolean>;
  lastModified: string;
}

export interface SyncResult {
  indexed: number;
  failed: number;
  errors: string[];
}

// ── Initialization ──

function getGraphClient(): Client | null {
  if (graphClient) return graphClient;

  try {
    const credential = new DefaultAzureCredential();
    const authProvider = new TokenCredentialAuthenticationProvider(credential, { scopes: GRAPH_SCOPES });
    graphClient = Client.initWithMiddleware({ authProvider });
    return graphClient;
  } catch (err) {
    console.error('[GraphConnector] Client init failed:', (err as Error).message);
    return null;
  }
}

// ── Schema Definition ──

const CONNECTOR_SCHEMA = {
  baseType: 'microsoft.graph.externalItem',
  properties: [
    { name: 'title', type: 'String', isSearchable: true, isQueryable: true, isRetrievable: true },
    { name: 'description', type: 'String', isSearchable: true, isRetrievable: true },
    { name: 'priority', type: 'String', isQueryable: true, isRetrievable: true },
    { name: 'state', type: 'String', isQueryable: true, isRetrievable: true },
    { name: 'assignee', type: 'String', isQueryable: true, isRetrievable: true },
    { name: 'category', type: 'String', isQueryable: true, isRetrievable: true },
    { name: 'createdDate', type: 'DateTime', isQueryable: true, isRetrievable: true },
    { name: 'updatedDate', type: 'DateTime', isQueryable: true, isRetrievable: true },
    { name: 'url', type: 'String', isRetrievable: true },
    // Additional properties retained for backward compatibility
    { name: 'number', type: 'String', isSearchable: true, isQueryable: true, isRetrievable: true },
    { name: 'assignmentGroup', type: 'String', isQueryable: true, isRetrievable: true },
    { name: 'itemType', type: 'String', isQueryable: true, isRetrievable: true },
  ],
};

// ── Connection Registration ──

/**
 * Register the ITSMServiceNow external connection and schema.
 * Attempts to use ExternalConnection.ReadWrite.OwnedBy permission first.
 * Falls back with clear instructions if permissions are insufficient.
 */
export async function registerConnection(): Promise<boolean> {
  const client = getGraphClient();
  if (!client) {
    console.error('[GraphConnector] Cannot register connection — Graph client not initialized.');
    console.error('[GraphConnector] Ensure DefaultAzureCredential is configured (managed identity, az login, etc.).');
    return false;
  }

  try {
    await client.api('/external/connections').post({
      id: CONNECTION_ID,
      name: 'ITSM ServiceNow',
      description: 'ServiceNow incidents, KB articles, changes, and configuration items indexed for M365 Search and Copilot.',
      connectorId: CONNECTION_ID,
    });
    console.log(`[GraphConnector] Connection '${CONNECTION_ID}' registered successfully.`);
  } catch (err: unknown) {
    const message = (err as Error).message || '';
    const statusCode = extractStatusCode(err);

    if (message.includes('already exists') || statusCode === 409) {
      console.log(`[GraphConnector] Connection '${CONNECTION_ID}' already exists — will update schema.`);
    } else if (statusCode === 403 || statusCode === 401 || message.includes('Authorization') || message.includes('Insufficient privileges')) {
      console.error('[GraphConnector] ❌ Permission denied creating external connection.');
      console.error('[GraphConnector] The app requires the "ExternalConnection.ReadWrite.OwnedBy" application permission.');
      console.error('[GraphConnector] To fix this:');
      console.error('[GraphConnector]   1. Go to Azure Portal → App registrations → your app');
      console.error('[GraphConnector]   2. API permissions → Add permission → Microsoft Graph → Application');
      console.error('[GraphConnector]   3. Search "ExternalConnection.ReadWrite.OwnedBy" and add it');
      console.error('[GraphConnector]   4. Grant admin consent for the tenant');
      console.error('[GraphConnector]   5. If using managed identity, assign the permission via PowerShell:');
      console.error('[GraphConnector]      New-MgServicePrincipalAppRoleAssignment ...');
      return false;
    } else {
      console.error('[GraphConnector] Connection creation failed:', message);
      return false;
    }
  }

  return await registerSchema(client);
}

async function registerSchema(client: Client): Promise<boolean> {
  try {
    await client.api(`/external/connections/${CONNECTION_ID}/schema`).patch({
      ...CONNECTOR_SCHEMA,
    });
    console.log('[GraphConnector] Schema registered with properties: title, description, priority, state, assignee, category, createdDate, updatedDate, url');
    return true;
  } catch (err: unknown) {
    const statusCode = extractStatusCode(err);
    const message = (err as Error).message || '';

    if (statusCode === 403 || statusCode === 401) {
      console.error('[GraphConnector] ❌ Permission denied registering schema.');
      console.error('[GraphConnector] Ensure "ExternalConnection.ReadWrite.OwnedBy" is granted and admin-consented.');
    } else {
      console.error('[GraphConnector] Schema registration failed:', message);
    }
    return false;
  }
}

/**
 * Create or update the external connection and schema (alias for registerConnection).
 */
export async function setupConnection(): Promise<boolean> {
  return registerConnection();
}

/**
 * Index an item into M365 search.
 */
export async function indexItem(item: ConnectorItem): Promise<boolean> {
  const client = getGraphClient();
  if (!client) {
    console.error('[GraphConnector] Cannot index item — Graph client not initialized.');
    return false;
  }

  try {
    await client.api(`/external/connections/${CONNECTION_ID}/items/${item.id}`).put({
      acl: [
        {
          type: 'everyone',
          value: 'everyone',
          accessType: 'grant',
        },
      ],
      properties: {
        title: item.title,
        description: item.description,
        priority: String(item.properties.priority || ''),
        state: String(item.properties.state || ''),
        assignee: String(item.properties.assignedTo || item.properties.assignee || ''),
        category: String(item.properties.category || ''),
        createdDate: String(item.properties.createdDate || item.lastModified),
        updatedDate: item.lastModified,
        url: item.url,
        number: String(item.properties.number || ''),
        assignmentGroup: String(item.properties.assignmentGroup || ''),
        itemType: item.itemType,
      },
      content: {
        type: 'text',
        value: item.content,
      },
    });

    return true;
  } catch (err: unknown) {
    const statusCode = extractStatusCode(err);
    const message = (err as Error).message || '';

    if (statusCode === 403 || statusCode === 401) {
      console.error(`[GraphConnector] ❌ Permission denied indexing item '${item.id}'. Check ExternalConnection.ReadWrite.OwnedBy permission.`);
    } else if (statusCode === 404) {
      console.error(`[GraphConnector] Connection '${CONNECTION_ID}' not found. Run registerConnection() first.`);
    } else {
      console.error(`[GraphConnector] Index failed for ${item.id}:`, message);
    }
    return false;
  }
}

/**
 * Index a batch of ServiceNow incidents.
 */
export async function indexIncidents(incidents: Record<string, unknown>[]): Promise<{ indexed: number; failed: number }> {
  let indexed = 0;
  let failed = 0;

  for (const inc of incidents) {
    const item: ConnectorItem = {
      id: `inc-${inc.sys_id || inc.number}`,
      title: (inc.short_description as string) || 'Untitled Incident',
      description: (inc.description as string) || '',
      url: `${process.env.SNOW_INSTANCE}/incident.do?sys_id=${inc.sys_id}`,
      content: `${inc.short_description}\n${inc.description || ''}\n${inc.close_notes || ''}`,
      itemType: 'incident',
      properties: {
        number: (inc.number as string) || '',
        state: String(inc.state || ''),
        priority: String(inc.priority || ''),
        category: (inc.category as string) || '',
        assignedTo: (inc.assigned_to as string) || '',
        assignmentGroup: (inc.assignment_group as string) || '',
      },
      lastModified: (inc.sys_updated_on as string) || new Date().toISOString(),
    };

    if (await indexItem(item)) indexed++;
    else failed++;
  }

  console.log(`[GraphConnector] Indexed ${indexed} incidents (${failed} failed)`);
  return { indexed, failed };
}

/**
 * Index KB articles for Copilot search.
 */
export async function indexKbArticles(articles: Record<string, unknown>[]): Promise<{ indexed: number; failed: number }> {
  let indexed = 0;
  let failed = 0;

  for (const kb of articles) {
    const item: ConnectorItem = {
      id: `kb-${kb.sys_id || kb.number}`,
      title: (kb.short_description as string) || 'Untitled Article',
      description: (kb.description as string) || '',
      url: `${process.env.SNOW_INSTANCE}/kb_view.do?sys_kb_id=${kb.sys_id}`,
      content: `${kb.short_description}\n${kb.text || ''}\n${kb.description || ''}`,
      itemType: 'kb_article',
      properties: {
        number: (kb.number as string) || '',
        state: String(kb.workflow_state || 'published'),
        priority: '',
        category: (kb.kb_category as string) || '',
        assignedTo: '',
        assignmentGroup: '',
      },
      lastModified: (kb.sys_updated_on as string) || new Date().toISOString(),
    };

    if (await indexItem(item)) indexed++;
    else failed++;
  }

  console.log(`[GraphConnector] Indexed ${indexed} KB articles (${failed} failed)`);
  return { indexed, failed };
}

/**
 * Sync ServiceNow incidents and KB articles in a single batch.
 * Fetches from the provided arrays and indexes them into M365 Search.
 */
export async function syncServiceNowData(
  incidents: Record<string, unknown>[],
  kbArticles: Record<string, unknown>[],
): Promise<{ incidents: SyncResult; kbArticles: SyncResult }> {
  console.log(`[GraphConnector] Starting sync: ${incidents.length} incidents, ${kbArticles.length} KB articles`);
  const incidentResult = await indexIncidents(incidents);
  const kbResult = await indexKbArticles(kbArticles);
  console.log(`[GraphConnector] Sync complete — Incidents: ${incidentResult.indexed}/${incidents.length}, KB: ${kbResult.indexed}/${kbArticles.length}`);
  return {
    incidents: { ...incidentResult, errors: [] },
    kbArticles: { ...kbResult, errors: [] },
  };
}

/**
 * Delete an item from the index.
 */
export async function deleteItem(itemId: string): Promise<boolean> {
  const client = getGraphClient();
  if (!client) return false;

  try {
    await client.api(`/external/connections/${CONNECTION_ID}/items/${itemId}`).delete();
    return true;
  } catch (err: unknown) {
    const statusCode = extractStatusCode(err);
    if (statusCode === 404) {
      console.warn(`[GraphConnector] Item '${itemId}' not found in index (already deleted?).`);
      return true;
    }
    console.error(`[GraphConnector] Delete failed for ${itemId}:`, (err as Error).message);
    return false;
  }
}

/**
 * Get connector status.
 */
export function getConnectorStatus(): {
  enabled: boolean;
  connectionId: string;
  requiredPermission: string;
} {
  return {
    enabled: !!getGraphClient(),
    connectionId: CONNECTION_ID,
    requiredPermission: 'ExternalConnection.ReadWrite.OwnedBy',
  };
}

// ── Helpers ──

function extractStatusCode(err: unknown): number | null {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.statusCode === 'number') return e.statusCode;
    if (typeof e.code === 'number') return e.code;
    const msg = String(e.message || '');
    const match = msg.match(/\b(401|403|404|409|429|500)\b/);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}
