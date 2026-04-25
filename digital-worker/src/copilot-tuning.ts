/**
 * Copilot Tuning — Fine-tuning pipeline for resolved ITSM tickets.
 *
 * Exports resolved INC/PRB/CHG records from ServiceNow, formats them
 * for Copilot Tuning in Copilot Control System, and manages model
 * deployment for specific workers (Knowledge Harvester, Resolution Notes).
 */

export interface TuningDataset {
  id: string;
  name: string;
  version: string;
  recordCount: number;
  tables: string[];
  createdAt: string;
  status: 'collecting' | 'formatting' | 'ready' | 'training' | 'deployed';
}

export interface TuningExample {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  metadata: {
    sourceTable: string;
    recordId: string;
    category: string;
  };
}

export interface TunedModel {
  id: string;
  baseModel: string;
  datasetId: string;
  status: 'pending' | 'training' | 'ready' | 'deployed' | 'retired';
  deployedTo: string[];
  metrics?: {
    accuracy: number;
    coherence: number;
    groundedness: number;
  };
}

// Tuning config
const TUNING_ENDPOINT = process.env.COPILOT_TUNING_ENDPOINT || '';
const MCP_ENDPOINT = process.env.MCP_ENDPOINT || 'http://localhost:3002';

// Workers that use the tuned model
export const TUNED_MODEL_WORKERS = [
  'knowledge-manager',
  'knowledge-harvester',
] as const;

/**
 * Extract resolved incidents from ServiceNow for training data.
 */
export async function extractResolvedIncidents(months: number = 12): Promise<TuningExample[]> {
  const examples: TuningExample[] = [];

  try {
    // Call MCP server to get resolved incidents
    const res = await fetch(`${MCP_ENDPOINT}/api/snow/table/incident?sysparm_query=state=6^resolved_atRELATIVEGE@month@ago@${months}&sysparm_limit=500&sysparm_fields=number,short_description,description,close_notes,close_code,category,subcategory,priority`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      console.warn(`[Tuning] Failed to fetch incidents: ${res.status}`);
      return examples;
    }

    const data = await res.json() as Record<string, unknown>;
    const records = (data?.result as Array<Record<string, string>>) || [];

    for (const record of records) {
      if (!record.close_notes || record.close_notes.length < 20) continue;

      examples.push({
        messages: [
          {
            role: 'system',
            content: 'You are an ITSM resolution notes writer. Given an incident description, write a comprehensive resolution note following ITIL best practices.',
          },
          {
            role: 'user',
            content: `Incident: ${record.short_description}\n\nDescription: ${record.description || 'N/A'}\n\nCategory: ${record.category || 'N/A'}\nPriority: ${record.priority || 'N/A'}`,
          },
          {
            role: 'assistant',
            content: record.close_notes,
          },
        ],
        metadata: {
          sourceTable: 'incident',
          recordId: record.number || record.sys_id,
          category: record.category || 'unknown',
        },
      });
    }

    console.log(`[Tuning] Extracted ${examples.length} incident examples`);
  } catch (err) {
    console.error(`[Tuning] Incident extraction failed:`, (err as Error).message);
  }

  return examples;
}

/**
 * Extract resolved problems for training data.
 */
export async function extractResolvedProblems(months: number = 12): Promise<TuningExample[]> {
  const examples: TuningExample[] = [];

  try {
    const res = await fetch(`${MCP_ENDPOINT}/api/snow/table/problem?sysparm_query=state=4^sys_updated_onRELATIVEGE@month@ago@${months}&sysparm_limit=200&sysparm_fields=number,short_description,description,cause_notes,fix_notes,category`, {
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) return examples;

    const data = await res.json() as Record<string, unknown>;
    const records = (data?.result as Array<Record<string, string>>) || [];

    for (const record of records) {
      if (!record.cause_notes && !record.fix_notes) continue;

      examples.push({
        messages: [
          {
            role: 'system',
            content: 'You are an ITSM root cause analysis writer. Given a problem description, write a thorough RCA with cause and fix notes following ITIL best practices.',
          },
          {
            role: 'user',
            content: `Problem: ${record.short_description}\n\nDescription: ${record.description || 'N/A'}\nCategory: ${record.category || 'N/A'}`,
          },
          {
            role: 'assistant',
            content: `Root Cause: ${record.cause_notes || 'Not documented'}\n\nFix: ${record.fix_notes || 'Not documented'}`,
          },
        ],
        metadata: {
          sourceTable: 'problem',
          recordId: record.number || record.sys_id,
          category: record.category || 'unknown',
        },
      });
    }

    console.log(`[Tuning] Extracted ${examples.length} problem examples`);
  } catch (err) {
    console.error(`[Tuning] Problem extraction failed:`, (err as Error).message);
  }

  return examples;
}

/**
 * Format examples into JSONL for fine-tuning upload.
 */
export function formatForTuning(examples: TuningExample[]): string {
  return examples
    .map(ex => JSON.stringify({ messages: ex.messages }))
    .join('\n');
}

/**
 * Create a complete tuning dataset from all sources.
 */
export async function createTuningDataset(): Promise<TuningDataset> {
  const dataset: TuningDataset = {
    id: `ds-${Date.now()}`,
    name: 'itsm-resolved-tickets',
    version: '1.0',
    recordCount: 0,
    tables: ['incident', 'problem'],
    createdAt: new Date().toISOString(),
    status: 'collecting',
  };

  console.log(`[Tuning] Creating dataset ${dataset.id}...`);

  // Collect from all sources
  dataset.status = 'collecting';
  const incidents = await extractResolvedIncidents();
  const problems = await extractResolvedProblems();

  const allExamples = [...incidents, ...problems];
  dataset.recordCount = allExamples.length;

  if (allExamples.length === 0) {
    console.warn('[Tuning] No training examples found');
    dataset.status = 'ready';
    return dataset;
  }

  // Format
  dataset.status = 'formatting';
  const jsonl = formatForTuning(allExamples);

  console.log(`[Tuning] Dataset ready: ${allExamples.length} examples, ${jsonl.length} bytes`);
  dataset.status = 'ready';

  // Upload to Copilot Tuning if configured
  if (TUNING_ENDPOINT) {
    try {
      dataset.status = 'training';
      const res = await fetch(`${TUNING_ENDPOINT}/datasets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/jsonl' },
        body: jsonl,
      });

      if (res.ok) {
        console.log(`[Tuning] Dataset uploaded to Copilot Tuning`);
      }
    } catch (err) {
      console.warn(`[Tuning] Upload failed:`, (err as Error).message);
      dataset.status = 'ready';
    }
  }

  return dataset;
}

/**
 * Get model to use for a worker — returns tuned model if available.
 */
export function getTunedModel(workerId: string): string | null {
  if (!(TUNED_MODEL_WORKERS as readonly string[]).includes(workerId)) return null;

  const tunedModel = process.env.TUNED_MODEL_DEPLOYMENT;
  if (!tunedModel) return null;

  return tunedModel;
}

/**
 * Get tuning pipeline status.
 */
export function getTuningStatus(): {
  enabled: boolean;
  tunedModelWorkers: readonly string[];
  tunedModelDeployment: string | null;
} {
  return {
    enabled: !!TUNING_ENDPOINT,
    tunedModelWorkers: TUNED_MODEL_WORKERS,
    tunedModelDeployment: process.env.TUNED_MODEL_DEPLOYMENT || null,
  };
}
