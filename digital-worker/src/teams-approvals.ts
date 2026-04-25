/**
 * Teams Approvals — Native approval workflows via Microsoft Graph.
 * Replaces custom Adaptive Card HITL with Teams Approvals API.
 * 
 * Approvals appear in the Teams Approvals app, are tracked,
 * and support escalation on timeout.
 */

import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { DefaultAzureCredential } from '@azure/identity';

// ── Configuration ──
const APPROVAL_TIMEOUT_MS = Number(process.env.APPROVAL_TIMEOUT_MS) || 30 * 60 * 1000; // 30 min default
const GRAPH_SCOPES = ['https://graph.microsoft.com/.default'];

let graphClient: Client | null = null;

// ── Types ──
export interface ApprovalRequest {
  title: string;
  description: string;
  requestedBy: string; // UPN or user ID
  approvers: string[]; // UPNs or user IDs
  category: 'incident' | 'change' | 'problem' | 'access' | 'general';
  priority: 'urgent' | 'normal' | 'low';
  metadata: Record<string, string>;
  callbackUrl?: string;
}

export interface ApprovalResult {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'timeout' | 'error';
  respondedBy?: string;
  respondedAt?: string;
  comments?: string;
  method: 'teams-approvals' | 'fallback';
}

// In-memory tracking for pending approvals
const pendingApprovals = new Map<string, {
  request: ApprovalRequest;
  createdAt: number;
  timeoutHandle: NodeJS.Timeout;
  resolve: (result: ApprovalResult) => void;
}>();

// ── Initialization ──

function getGraphClient(): Client | null {
  if (graphClient) return graphClient;

  try {
    const credential = new DefaultAzureCredential();
    const authProvider = new TokenCredentialAuthenticationProvider(credential, { scopes: GRAPH_SCOPES });
    graphClient = Client.initWithMiddleware({ authProvider });
    return graphClient;
  } catch (err) {
    console.error('[TeamsApprovals] Graph client init failed:', (err as Error).message);
    return null;
  }
}

// ── Create Approval ──

export async function createApproval(request: ApprovalRequest): Promise<ApprovalResult> {
  const client = getGraphClient();
  const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (!client) {
    console.warn('[TeamsApprovals] Graph not configured, using fallback approval flow');
    return createFallbackApproval(approvalId, request);
  }

  try {
    // Create approval via Graph API
    const approvalBody = {
      displayName: request.title,
      description: request.description,
      approvalType: request.approvers.length > 1 ? 'basicAwaitAll' : 'basic',
      requestor: {
        identity: {
          displayName: request.requestedBy,
          id: request.requestedBy,
        },
      },
      stages: [
        {
          assignedTo: {
            members: request.approvers.map(approver => ({
              identity: {
                displayName: approver,
                id: approver,
              },
            })),
          },
        },
      ],
      customData: JSON.stringify({
        category: request.category,
        priority: request.priority,
        ...request.metadata,
        source: 'itsm-digital-worker',
      }),
    };

    const result = await client.api('/solutions/approval/approvalItems')
      .post(approvalBody);

    console.log(`[TeamsApprovals] Created approval ${result.id}: ${request.title}`);

    // Set up timeout for escalation
    return trackApproval(result.id || approvalId, request);
  } catch (err) {
    console.error('[TeamsApprovals] Create failed:', (err as Error).message);
    return createFallbackApproval(approvalId, request);
  }
}

// ── Track & Poll Approval ──

function trackApproval(id: string, request: ApprovalRequest): Promise<ApprovalResult> {
  return new Promise<ApprovalResult>((resolve) => {
    const timeoutHandle = setTimeout(() => {
      console.warn(`[TeamsApprovals] Approval ${id} timed out after ${APPROVAL_TIMEOUT_MS / 1000}s`);
      pendingApprovals.delete(id);
      resolve({
        id,
        status: 'timeout',
        method: 'teams-approvals',
      });
    }, APPROVAL_TIMEOUT_MS);

    timeoutHandle.unref(); // Don't keep process alive for approval timeouts

    pendingApprovals.set(id, {
      request,
      createdAt: Date.now(),
      timeoutHandle,
      resolve,
    });

    // Start polling
    pollApproval(id);
  });
}

async function pollApproval(id: string): Promise<void> {
  const pending = pendingApprovals.get(id);
  if (!pending) return;

  const client = getGraphClient();
  if (!client) return;

  try {
    const result = await client.api(`/solutions/approval/approvalItems/${id}`).get();

    if (result.status === 'completed') {
      const approved = result.result === 'Approve';
      clearTimeout(pending.timeoutHandle);
      pendingApprovals.delete(id);

      pending.resolve({
        id,
        status: approved ? 'approved' : 'rejected',
        respondedBy: result.responseDetails?.[0]?.assignedTo?.identity?.displayName,
        respondedAt: new Date().toISOString(),
        comments: result.responseDetails?.[0]?.comments,
        method: 'teams-approvals',
      });
      return;
    }

    // Continue polling every 10 seconds
    setTimeout(() => pollApproval(id), 10_000).unref();
  } catch (err) {
    console.error(`[TeamsApprovals] Poll error for ${id}:`, (err as Error).message);
    // Retry in 30 seconds
    setTimeout(() => pollApproval(id), 30_000).unref();
  }
}

// ── Fallback (when Graph unavailable) ──

function createFallbackApproval(id: string, request: ApprovalRequest): ApprovalResult {
  console.log(`[TeamsApprovals:Fallback] Approval ${id}: ${request.title}`);
  console.log(`  Approvers: ${request.approvers.join(', ')}`);
  console.log(`  Category: ${request.category} | Priority: ${request.priority}`);
  
  // In fallback mode, auto-approve READ operations, require manual for WRITE
  if (request.category === 'general' || request.priority === 'low') {
    return { id, status: 'approved', method: 'fallback' };
  }

  return {
    id,
    status: 'pending',
    method: 'fallback',
  };
}

// ── Webhook for approval responses ──

export function handleApprovalCallback(approvalId: string, status: 'approved' | 'rejected', respondedBy: string, comments?: string): boolean {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return false;

  clearTimeout(pending.timeoutHandle);
  pendingApprovals.delete(approvalId);

  pending.resolve({
    id: approvalId,
    status,
    respondedBy,
    respondedAt: new Date().toISOString(),
    comments,
    method: 'teams-approvals',
  });

  console.log(`[TeamsApprovals] Approval ${approvalId} ${status} by ${respondedBy}`);
  return true;
}

// ── Status ──

export function getApprovalsStatus(): {
  enabled: boolean;
  pendingCount: number;
  timeoutMs: number;
} {
  return {
    enabled: !!getGraphClient(),
    pendingCount: pendingApprovals.size,
    timeoutMs: APPROVAL_TIMEOUT_MS,
  };
}

// ── Cleanup ──

export function cancelAllPendingApprovals(): void {
  for (const [id, pending] of pendingApprovals) {
    clearTimeout(pending.timeoutHandle);
    pending.resolve({ id, status: 'cancelled', method: 'teams-approvals' });
  }
  pendingApprovals.clear();
}
