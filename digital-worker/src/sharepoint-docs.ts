/**
 * SharePoint Document Library — Store generated reports and documents.
 * PIR reports, shift handovers, KB drafts → versioned, searchable,
 * governed by Microsoft Purview.
 */

import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';
import { DefaultAzureCredential } from '@azure/identity';

// ── Configuration ──
const SHAREPOINT_SITE_ID = process.env.SHAREPOINT_SITE_ID || '';
const SHAREPOINT_DRIVE_ID = process.env.SHAREPOINT_DRIVE_ID || '';
const GRAPH_SCOPES = ['https://graph.microsoft.com/.default'];

let graphClient: Client | null = null;

// ── Types ──
export interface DocumentUpload {
  fileName: string;
  content: string | Buffer;
  contentType: string;
  folder: string;
  metadata?: Record<string, string>;
}

export interface UploadResult {
  success: boolean;
  fileId?: string;
  webUrl?: string;
  error?: string;
}

// ── Initialization ──

function getGraphClient(): Client | null {
  if (graphClient) return graphClient;
  if (!SHAREPOINT_SITE_ID) return null;

  try {
    const credential = new DefaultAzureCredential();
    const authProvider = new TokenCredentialAuthenticationProvider(credential, { scopes: GRAPH_SCOPES });
    graphClient = Client.initWithMiddleware({ authProvider });
    return graphClient;
  } catch (err) {
    console.error('[SharePoint] Client init failed:', (err as Error).message);
    return null;
  }
}

/**
 * Upload a document to SharePoint.
 */
export async function uploadDocument(doc: DocumentUpload): Promise<UploadResult> {
  const client = getGraphClient();

  if (!client || !SHAREPOINT_DRIVE_ID) {
    console.warn('[SharePoint] Not configured — logging document instead');
    console.log(`[SharePoint:Fallback] Would upload: ${doc.folder}/${doc.fileName} (${doc.contentType})`);
    return { success: false, error: 'SharePoint not configured' };
  }

  try {
    const path = `${doc.folder}/${doc.fileName}`.replace(/^\//, '');
    
    const result = await client
      .api(`/drives/${SHAREPOINT_DRIVE_ID}/root:/${path}:/content`)
      .putStream(typeof doc.content === 'string' ? Buffer.from(doc.content) : doc.content);

    console.log(`[SharePoint] Uploaded: ${path} → ${result.webUrl}`);
    return {
      success: true,
      fileId: result.id,
      webUrl: result.webUrl,
    };
  } catch (err) {
    console.error('[SharePoint] Upload failed:', (err as Error).message);
    return { success: false, error: (err as Error).message };
  }
}

// ── Convenience Functions ──

export async function uploadShiftHandover(
  period: string,
  htmlContent: string,
): Promise<UploadResult> {
  const date = new Date().toISOString().split('T')[0];
  return uploadDocument({
    fileName: `Shift-Handover-${date}-${period.replace(/\s+/g, '-')}.html`,
    content: htmlContent,
    contentType: 'text/html',
    folder: 'ITSM/Shift-Handovers',
  });
}

export async function uploadPirReport(
  incidentNumber: string,
  htmlContent: string,
): Promise<UploadResult> {
  const date = new Date().toISOString().split('T')[0];
  return uploadDocument({
    fileName: `PIR-${incidentNumber}-${date}.html`,
    content: htmlContent,
    contentType: 'text/html',
    folder: 'ITSM/PIR-Reports',
  });
}

export async function uploadKbDraft(
  title: string,
  markdownContent: string,
): Promise<UploadResult> {
  const safeName = title.replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 80);
  return uploadDocument({
    fileName: `KB-Draft-${safeName}.md`,
    content: markdownContent,
    contentType: 'text/markdown',
    folder: 'ITSM/KB-Drafts',
  });
}

/**
 * List documents in a folder.
 */
export async function listDocuments(folder: string): Promise<Array<{ name: string; webUrl: string; lastModified: string }>> {
  const client = getGraphClient();
  if (!client || !SHAREPOINT_DRIVE_ID) return [];

  try {
    const result = await client
      .api(`/drives/${SHAREPOINT_DRIVE_ID}/root:/${folder}:/children`)
      .select('name,webUrl,lastModifiedDateTime')
      .get();

    return (result.value || []).map((item: Record<string, unknown>) => ({
      name: item.name as string,
      webUrl: item.webUrl as string,
      lastModified: item.lastModifiedDateTime as string,
    }));
  } catch (err) {
    console.error(`[SharePoint] List failed for ${folder}:`, (err as Error).message);
    return [];
  }
}

// ── Status ──

export function getSharePointStatus(): {
  enabled: boolean;
  siteId: string;
  driveId: string;
} {
  return {
    enabled: !!getGraphClient() && !!SHAREPOINT_DRIVE_ID,
    siteId: SHAREPOINT_SITE_ID || 'not-configured',
    driveId: SHAREPOINT_DRIVE_ID || 'not-configured',
  };
}
