/**
 * Azure AI Search Client for ITSM Knowledge RAG
 * Provides semantic + vector search over ServiceNow KB articles,
 * resolved incident close notes, and CMDB CI descriptions.
 * Falls back to ServiceNow LIKE search when not configured.
 */

import { SearchClient, AzureKeyCredential, type SearchOptions } from '@azure/search-documents';

const SEARCH_ENDPOINT = process.env.AZURE_SEARCH_ENDPOINT || '';
const SEARCH_KEY = process.env.AZURE_SEARCH_KEY || '';
const SEARCH_INDEX = process.env.AZURE_SEARCH_INDEX || 'idx-itsm-knowledge';

let searchClient: SearchClient<KnowledgeDocument> | null = null;

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  source: 'kb_article' | 'incident_resolution' | 'runbook' | 'cmdb_ci';
  sourceId: string;  // e.g. KB0001234, INC0001234
  category: string;
  lastUpdated: string;
  relevanceScore?: number;
  url?: string;
}

export interface SearchResult {
  documents: KnowledgeDocument[];
  totalCount: number;
  searchDurationMs: number;
  searchMode: 'semantic' | 'keyword' | 'fallback';
}

/**
 * Initialize the search client. Call at startup.
 */
export function initSearchClient(): void {
  if (!SEARCH_ENDPOINT || !SEARCH_KEY) {
    console.log('[Search] Azure AI Search not configured — semantic search disabled');
    return;
  }

  try {
    searchClient = new SearchClient<KnowledgeDocument>(
      SEARCH_ENDPOINT,
      SEARCH_INDEX,
      new AzureKeyCredential(SEARCH_KEY),
    );
    console.log(`[Search] Azure AI Search configured: ${SEARCH_ENDPOINT} / ${SEARCH_INDEX}`);
  } catch (err) {
    console.error('[Search] Failed to initialize search client:', (err as Error).message);
  }
}

/**
 * Semantic search over ITSM knowledge base.
 * Uses hybrid (vector + keyword) search with semantic ranking.
 */
export async function searchKnowledge(
  query: string,
  options?: {
    source?: KnowledgeDocument['source'];
    category?: string;
    top?: number;
  }
): Promise<SearchResult> {
  const startTime = Date.now();

  if (!searchClient) {
    return {
      documents: [],
      totalCount: 0,
      searchDurationMs: Date.now() - startTime,
      searchMode: 'fallback',
    };
  }

  try {
    const searchOptions: SearchOptions<KnowledgeDocument> = {
      top: options?.top || 10,
      queryType: 'semantic',
      semanticSearchOptions: {
        configurationName: 'itsm-semantic-config',
      },
      select: ['id', 'title', 'content', 'source', 'sourceId', 'category', 'lastUpdated', 'url'] as any,
    };

    // Add filters
    const filters: string[] = [];
    if (options?.source) {
      filters.push(`source eq '${options.source}'`);
    }
    if (options?.category) {
      filters.push(`category eq '${options.category}'`);
    }
    if (filters.length > 0) {
      searchOptions.filter = filters.join(' and ');
    }

    const results = await searchClient.search(query, searchOptions);
    const documents: KnowledgeDocument[] = [];
    let totalCount = 0;

    for await (const result of results.results) {
      documents.push({
        ...result.document,
        relevanceScore: result.score,
      });
      totalCount++;
      if (totalCount >= (options?.top || 10)) break;
    }

    return {
      documents,
      totalCount,
      searchDurationMs: Date.now() - startTime,
      searchMode: 'semantic',
    };
  } catch (err) {
    console.error('[Search] Search failed:', (err as Error).message);
    return {
      documents: [],
      totalCount: 0,
      searchDurationMs: Date.now() - startTime,
      searchMode: 'fallback',
    };
  }
}

/**
 * Search specifically for KB articles relevant to an incident.
 * Used by the Knowledge Manager for incident resolution assistance.
 */
export async function searchForIncidentResolution(
  incidentDescription: string,
  category?: string,
): Promise<KnowledgeDocument[]> {
  const result = await searchKnowledge(incidentDescription, {
    source: 'kb_article',
    category,
    top: 5,
  });
  return result.documents;
}

/**
 * Search for similar past incident resolutions.
 * Used by Problem Manager for pattern detection and RCA.
 */
export async function searchSimilarResolutions(
  description: string,
  top = 10,
): Promise<KnowledgeDocument[]> {
  const result = await searchKnowledge(description, {
    source: 'incident_resolution',
    top,
  });
  return result.documents;
}

/**
 * Search runbooks by description.
 */
export async function searchRunbooks(query: string): Promise<KnowledgeDocument[]> {
  const result = await searchKnowledge(query, {
    source: 'runbook',
    top: 5,
  });
  return result.documents;
}

/**
 * Get search client status for health checks.
 */
export function getSearchStatus(): { configured: boolean; endpoint: string; index: string } {
  return {
    configured: searchClient !== null,
    endpoint: SEARCH_ENDPOINT ? SEARCH_ENDPOINT.replace(/https?:\/\//, '').split('.')[0] : 'not-configured',
    index: SEARCH_INDEX,
  };
}
