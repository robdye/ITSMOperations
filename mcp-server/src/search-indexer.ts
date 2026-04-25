/**
 * Azure AI Search Indexer for ITSM Knowledge
 * Periodically indexes ServiceNow KB articles, resolved incidents,
 * and CMDB CI descriptions into the search index.
 */

import { SearchIndexClient, type SearchIndex, AzureKeyCredential, SearchClient } from '@azure/search-documents';
import type { KnowledgeDocument } from './search-client.js';

const SEARCH_ENDPOINT = process.env.AZURE_SEARCH_ENDPOINT || '';
const SEARCH_KEY = process.env.AZURE_SEARCH_KEY || '';
const SEARCH_INDEX = process.env.AZURE_SEARCH_INDEX || 'idx-itsm-knowledge';

/**
 * Create the search index with the knowledge document schema.
 * Run once during setup, or on-demand when schema changes.
 */
export async function createSearchIndex(): Promise<void> {
  if (!SEARCH_ENDPOINT || !SEARCH_KEY) {
    console.log('[SearchIndexer] Search not configured — skipping index creation');
    return;
  }

  const indexClient = new SearchIndexClient(
    SEARCH_ENDPOINT,
    new AzureKeyCredential(SEARCH_KEY),
  );

  const index: SearchIndex = {
    name: SEARCH_INDEX,
    fields: [
      { name: 'id', type: 'Edm.String', key: true, filterable: true },
      { name: 'title', type: 'Edm.String', searchable: true, filterable: false },
      { name: 'content', type: 'Edm.String', searchable: true, filterable: false },
      { name: 'source', type: 'Edm.String', searchable: false, filterable: true, facetable: true },
      { name: 'sourceId', type: 'Edm.String', searchable: true, filterable: true },
      { name: 'category', type: 'Edm.String', searchable: true, filterable: true, facetable: true },
      { name: 'lastUpdated', type: 'Edm.DateTimeOffset', filterable: true, sortable: true },
      { name: 'url', type: 'Edm.String', searchable: false, filterable: false },
    ],
    semanticSearch: {
      configurations: [
        {
          name: 'itsm-semantic-config',
          prioritizedFields: {
            titleField: { name: 'title' },
            contentFields: [{ name: 'content' }],
            keywordsFields: [{ name: 'category' }],
          },
        },
      ],
    },
  };

  try {
    await indexClient.createOrUpdateIndex(index);
    console.log(`[SearchIndexer] Index ${SEARCH_INDEX} created/updated successfully`);
  } catch (err) {
    console.error('[SearchIndexer] Index creation failed:', (err as Error).message);
  }
}

/**
 * Index a batch of knowledge documents.
 */
export async function indexDocuments(documents: KnowledgeDocument[]): Promise<{
  succeeded: number;
  failed: number;
}> {
  if (!SEARCH_ENDPOINT || !SEARCH_KEY || documents.length === 0) {
    return { succeeded: 0, failed: 0 };
  }

  const client = new SearchClient(
    SEARCH_ENDPOINT,
    SEARCH_INDEX,
    new AzureKeyCredential(SEARCH_KEY),
  );

  try {
    const result = await client.mergeOrUploadDocuments(documents);
    const succeeded = result.results.filter(r => r.succeeded).length;
    const failed = result.results.filter(r => !r.succeeded).length;

    console.log(`[SearchIndexer] Indexed ${succeeded} documents, ${failed} failed`);
    return { succeeded, failed };
  } catch (err) {
    console.error('[SearchIndexer] Batch indexing failed:', (err as Error).message);
    return { succeeded: 0, failed: documents.length };
  }
}

/**
 * Index ServiceNow KB articles into the search index.
 * Called by the scheduled indexing pipeline.
 */
export async function indexKbArticles(snowGet: (table: string, query?: string, fields?: string[], limit?: number) => Promise<any[]>): Promise<number> {
  console.log('[SearchIndexer] Indexing KB articles from ServiceNow...');

  try {
    const articles = await snowGet(
      'kb_knowledge',
      'workflow_state=published',
      ['sys_id', 'number', 'short_description', 'text', 'topic', 'category', 'sys_updated_on'],
      500,
    );

    const docs: KnowledgeDocument[] = articles.map((a: any) => ({
      id: `kb-${a.sys_id}`,
      title: a.short_description || a.number || 'Untitled',
      content: stripHtml(a.text || ''),
      source: 'kb_article' as const,
      sourceId: a.number || a.sys_id,
      category: a.category || a.topic || 'General',
      lastUpdated: a.sys_updated_on || new Date().toISOString(),
      url: `${process.env.SNOW_INSTANCE}/kb_view.do?sys_kb_id=${a.sys_id}`,
    }));

    const result = await indexDocuments(docs);
    console.log(`[SearchIndexer] KB articles indexed: ${result.succeeded}/${docs.length}`);
    return result.succeeded;
  } catch (err) {
    console.error('[SearchIndexer] KB article indexing failed:', (err as Error).message);
    return 0;
  }
}

/**
 * Index resolved incident close notes.
 */
export async function indexResolvedIncidents(snowGet: (table: string, query?: string, fields?: string[], limit?: number) => Promise<any[]>): Promise<number> {
  console.log('[SearchIndexer] Indexing resolved incidents from ServiceNow...');

  try {
    const incidents = await snowGet(
      'incident',
      'state=6^close_notesISNOTEMPTY^ORDERBYDESCresolved_at',
      ['sys_id', 'number', 'short_description', 'close_notes', 'category', 'subcategory', 'resolved_at'],
      500,
    );

    const docs: KnowledgeDocument[] = incidents.map((inc: any) => ({
      id: `inc-${inc.sys_id}`,
      title: `${inc.number}: ${inc.short_description}`,
      content: inc.close_notes || '',
      source: 'incident_resolution' as const,
      sourceId: inc.number || inc.sys_id,
      category: inc.category || 'General',
      lastUpdated: inc.resolved_at || new Date().toISOString(),
      url: `${process.env.SNOW_INSTANCE}/incident.do?sys_id=${inc.sys_id}`,
    }));

    const result = await indexDocuments(docs);
    console.log(`[SearchIndexer] Resolved incidents indexed: ${result.succeeded}/${docs.length}`);
    return result.succeeded;
  } catch (err) {
    console.error('[SearchIndexer] Incident indexing failed:', (err as Error).message);
    return 0;
  }
}

/** Strip HTML tags from content */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
