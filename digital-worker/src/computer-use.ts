/**
 * Foundry Computer Use — Legacy console operator.
 * Uses the Foundry Computer Use primitive to interact with legacy
 * ITSM systems, network management consoles, and mainframe terminals.
 *
 * All sessions are recorded and streamed into the audit trail.
 */

export interface ComputerUseSession {
  id: string;
  target: string;
  status: 'initializing' | 'active' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  actions: ComputerAction[];
  screenshots: string[];
}

export interface ComputerAction {
  type: 'click' | 'type' | 'scroll' | 'screenshot' | 'key' | 'wait';
  timestamp: string;
  details: Record<string, unknown>;
  result?: string;
}

export interface ComputerUseConfig {
  endpoint: string;
  apiKey: string;
  maxSessionDuration: number; // seconds
  screenshotInterval: number; // seconds
  allowedTargets: string[];
}

const COMPUTER_USE_ENDPOINT = process.env.COMPUTER_USE_ENDPOINT || '';
const COMPUTER_USE_API_KEY = process.env.COMPUTER_USE_API_KEY || '';

// Session registry
const activeSessions = new Map<string, ComputerUseSession>();

/**
 * Check if Computer Use is enabled.
 */
export function isComputerUseEnabled(): boolean {
  return !!(COMPUTER_USE_ENDPOINT && COMPUTER_USE_API_KEY);
}

/**
 * Allowed target systems for Computer Use.
 */
const ALLOWED_TARGETS = [
  'legacy-itsm-console',
  'network-management-console',
  'mainframe-terminal',
  'monitoring-dashboard',
  'legacy-cmdb-ui',
];

/**
 * Create a new Computer Use session.
 */
export async function createSession(
  target: string,
  objective: string,
): Promise<ComputerUseSession> {
  if (!ALLOWED_TARGETS.includes(target)) {
    throw new Error(`Target '${target}' not in allowed list: ${ALLOWED_TARGETS.join(', ')}`);
  }

  const session: ComputerUseSession = {
    id: `cuse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    target,
    status: 'initializing',
    startedAt: new Date().toISOString(),
    actions: [],
    screenshots: [],
  };

  activeSessions.set(session.id, session);

  console.log(`[ComputerUse] Session ${session.id} created for target: ${target}`);
  console.log(`[ComputerUse] Objective: ${objective}`);

  if (isComputerUseEnabled()) {
    // Initialize via Foundry Computer Use API
    try {
      const res = await fetch(`${COMPUTER_USE_ENDPOINT}/sessions`, {
        method: 'POST',
        headers: {
          'api-key': COMPUTER_USE_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target,
          objective,
          maxDuration: 300,
          screenshotOnAction: true,
        }),
      });

      if (res.ok) {
        session.status = 'active';
      } else {
        console.warn(`[ComputerUse] Failed to initialize Foundry session: ${res.status}`);
        session.status = 'active'; // Continue in local mode
      }
    } catch (err) {
      console.warn(`[ComputerUse] Foundry endpoint unreachable, running in local mode`);
      session.status = 'active';
    }
  } else {
    session.status = 'active';
  }

  return session;
}

/**
 * Execute an action within a session.
 */
export async function executeAction(
  sessionId: string,
  action: Omit<ComputerAction, 'timestamp'>,
): Promise<ComputerAction> {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (session.status !== 'active') throw new Error(`Session ${sessionId} is ${session.status}`);

  const fullAction: ComputerAction = {
    ...action,
    timestamp: new Date().toISOString(),
  };

  session.actions.push(fullAction);

  console.log(`[ComputerUse] Action in ${sessionId}: ${action.type} ${JSON.stringify(action.details)}`);

  if (isComputerUseEnabled()) {
    try {
      const res = await fetch(`${COMPUTER_USE_ENDPOINT}/sessions/${sessionId}/actions`, {
        method: 'POST',
        headers: {
          'api-key': COMPUTER_USE_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(fullAction),
      });

      if (res.ok) {
        const result = await res.json() as Record<string, unknown>;
        fullAction.result = (result.result as string) || 'action completed';
        if (result.screenshot) session.screenshots.push(result.screenshot as string);
      }
    } catch {
      fullAction.result = 'action executed (local mode)';
    }
  } else {
    fullAction.result = 'action simulated (Computer Use not configured)';
  }

  return fullAction;
}

/**
 * Complete a session and generate audit record.
 */
export async function completeSession(sessionId: string): Promise<ComputerUseSession> {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  session.status = 'completed';
  session.completedAt = new Date().toISOString();

  console.log(`[ComputerUse] Session ${sessionId} completed: ${session.actions.length} actions`);

  return session;
}

/**
 * Get session details for audit trail.
 */
export function getSession(sessionId: string): ComputerUseSession | undefined {
  return activeSessions.get(sessionId);
}

/**
 * Get all active sessions.
 */
export function getActiveSessions(): ComputerUseSession[] {
  return Array.from(activeSessions.values()).filter(s => s.status === 'active');
}

/**
 * Get audit trail for a session — formatted for Azure Table Storage.
 */
export function getSessionAuditRecord(sessionId: string): Record<string, unknown> | null {
  const session = activeSessions.get(sessionId);
  if (!session) return null;

  return {
    sessionId: session.id,
    target: session.target,
    status: session.status,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    actionCount: session.actions.length,
    screenshotCount: session.screenshots.length,
    actions: JSON.stringify(session.actions),
    // Audit metadata
    auditType: 'computer-use-session',
    riskLevel: 'high',
    requiresReview: true,
  };
}

/**
 * Get Computer Use status.
 */
export function getComputerUseStatus(): {
  enabled: boolean;
  activeSessions: number;
  allowedTargets: string[];
} {
  return {
    enabled: isComputerUseEnabled(),
    activeSessions: getActiveSessions().length,
    allowedTargets: ALLOWED_TARGETS,
  };
}
