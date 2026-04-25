/**
 * Microsoft Planner — Auto-create tasks from ITSM actions.
 * Creates and tracks remediation tasks in Planner, assigned to
 * engineers, linked back to incidents/problems.
 */

import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';
import { DefaultAzureCredential } from '@azure/identity';

// ── Configuration ──
const PLANNER_GROUP_ID = process.env.PLANNER_GROUP_ID || '';
const PLANNER_PLAN_ID = process.env.PLANNER_PLAN_ID || '';
const GRAPH_SCOPES = ['https://graph.microsoft.com/.default'];

let graphClient: Client | null = null;

// ── Types ──
export interface PlannerTask {
  title: string;
  assigneeId?: string;
  bucketId?: string;
  dueDate?: string;
  priority: 1 | 3 | 5 | 9; // Urgent, Important, Medium, Low
  description?: string;
  categories?: string[];
  references?: { url: string; alias: string }[];
}

export interface CreatedTask {
  id: string;
  title: string;
  planId: string;
  status: 'created' | 'failed';
  url?: string;
  error?: string;
}

// Bucket cache (name → ID)
const bucketCache = new Map<string, string>();

// ── Initialization ──

function getGraphClient(): Client | null {
  if (graphClient) return graphClient;
  if (!PLANNER_PLAN_ID) return null;

  try {
    const credential = new DefaultAzureCredential();
    const authProvider = new TokenCredentialAuthenticationProvider(credential, { scopes: GRAPH_SCOPES });
    graphClient = Client.initWithMiddleware({ authProvider });
    return graphClient;
  } catch (err) {
    console.error('[Planner] Client init failed:', (err as Error).message);
    return null;
  }
}

/**
 * Get or create a bucket in the plan.
 */
async function getOrCreateBucket(name: string): Promise<string | null> {
  if (bucketCache.has(name)) return bucketCache.get(name)!;

  const client = getGraphClient();
  if (!client) return null;

  try {
    // List existing buckets
    const buckets = await client.api(`/planner/plans/${PLANNER_PLAN_ID}/buckets`).get();
    for (const bucket of buckets.value || []) {
      bucketCache.set(bucket.name, bucket.id);
      if (bucket.name === name) return bucket.id;
    }

    // Create new bucket
    const newBucket = await client.api('/planner/buckets').post({
      name,
      planId: PLANNER_PLAN_ID,
    });
    bucketCache.set(name, newBucket.id);
    return newBucket.id;
  } catch (err) {
    console.error(`[Planner] Bucket operation failed for '${name}':`, (err as Error).message);
    return null;
  }
}

/**
 * Create a task in Planner from an ITSM action.
 */
export async function createTask(task: PlannerTask): Promise<CreatedTask> {
  const client = getGraphClient();

  if (!client || !PLANNER_PLAN_ID) {
    console.warn('[Planner] Not configured — logging task instead');
    console.log(`[Planner:Fallback] Task: ${task.title} | Priority: ${task.priority} | Due: ${task.dueDate || 'none'}`);
    return { id: `local-${Date.now()}`, title: task.title, planId: 'none', status: 'failed', error: 'Planner not configured' };
  }

  try {
    // Resolve bucket
    const bucketId = task.bucketId || await getOrCreateBucket('ITSM Actions');

    const plannerTask: Record<string, unknown> = {
      planId: PLANNER_PLAN_ID,
      title: task.title,
      priority: task.priority,
      bucketId,
    };

    if (task.assigneeId) {
      plannerTask.assignments = {
        [task.assigneeId]: { '@odata.type': '#microsoft.graph.plannerAssignment', orderHint: ' !' },
      };
    }

    if (task.dueDate) {
      plannerTask.dueDateTime = task.dueDate;
    }

    const created = await client.api('/planner/tasks').post(plannerTask);

    // Add description if provided
    if (task.description && created.id) {
      try {
        const details = await client.api(`/planner/tasks/${created.id}/details`).get();
        await client.api(`/planner/tasks/${created.id}/details`)
          .header('If-Match', details['@odata.etag'])
          .update({
            description: task.description,
            previewType: 'description',
          });
      } catch {
        // Non-critical — task created but description not set
      }
    }

    console.log(`[Planner] Task created: ${created.id} — ${task.title}`);
    return {
      id: created.id,
      title: task.title,
      planId: PLANNER_PLAN_ID,
      status: 'created',
      url: `https://tasks.office.com/planner/task/${created.id}`,
    };
  } catch (err) {
    console.error('[Planner] Task creation failed:', (err as Error).message);
    return { id: '', title: task.title, planId: PLANNER_PLAN_ID, status: 'failed', error: (err as Error).message };
  }
}

// ── Convenience Functions ──

export async function createIncidentRemediationTask(
  incidentNumber: string,
  description: string,
  assigneeId?: string,
  priority: 1 | 3 | 5 | 9 = 5,
): Promise<CreatedTask> {
  return createTask({
    title: `[${incidentNumber}] Remediation: ${description.slice(0, 100)}`,
    assigneeId,
    priority,
    description: `Remediation task for ServiceNow incident ${incidentNumber}.\n\n${description}`,
    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Due in 24h
  });
}

export async function createChangeImplementationTask(
  changeNumber: string,
  description: string,
  assigneeId?: string,
  dueDate?: string,
): Promise<CreatedTask> {
  return createTask({
    title: `[${changeNumber}] Implementation: ${description.slice(0, 100)}`,
    assigneeId,
    priority: 3,
    description: `Implementation task for ServiceNow change ${changeNumber}.\n\n${description}`,
    dueDate,
  });
}

export async function createProblemInvestigationTask(
  problemNumber: string,
  description: string,
  assigneeId?: string,
): Promise<CreatedTask> {
  return createTask({
    title: `[${problemNumber}] Investigation: ${description.slice(0, 100)}`,
    assigneeId,
    priority: 3,
    description: `Root cause investigation for ServiceNow problem ${problemNumber}.\n\n${description}`,
    dueDate: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(), // Due in 72h
  });
}

// ── Status ──

export function getPlannerStatus(): {
  enabled: boolean;
  planId: string;
  groupId: string;
} {
  return {
    enabled: !!getGraphClient() && !!PLANNER_PLAN_ID,
    planId: PLANNER_PLAN_ID || 'not-configured',
    groupId: PLANNER_GROUP_ID || 'not-configured',
  };
}
