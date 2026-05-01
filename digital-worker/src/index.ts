// ITSM Operations Digital Worker — Entry point

import { initTelemetry, initMetrics } from './telemetry';
initTelemetry();

import { configDotenv } from 'dotenv';
configDotenv();

import {
  AuthConfiguration,
  authorizeJWT,
  CloudAdapter,
  loadAuthConfigFromEnv,
  Request as AgentRequest,
} from '@microsoft/agents-hosting';
import express, { Request, Response } from 'express';
import http from 'http';
import crypto from 'crypto';
import path from 'path';
import { DefaultAzureCredential } from '@azure/identity';
import { agentApplication } from './agent';
import { startHandoverScheduler, stopHandoverScheduler, generateHandover } from './shift-handover';
import { startIncidentMonitor, stopIncidentMonitor, runIncidentPoll } from './incident-monitor';
import { getAuditSummary, getRecentAuditEntries } from './audit-trail';
import { getMemoryStoreSummary } from './memory-store';
import { startScheduledRoutines, getRoutineStatus, stopScheduledRoutines, executeRoutine } from './scheduled-routines';
import { getQueueSummary } from './approval-queue';
import { attachVoiceWebSocket } from './voice/voiceProxy';
import {
  attachAcsMediaWebSocket,
  handleAcsEvent,
  initiateOutboundTeamsCall,
  isAcsConfigured,
  getActiveCallSnapshot,
} from './voice/acsBridge';
import { getTraces, getConversations, getReasoningStats } from './reasoning-trace';
import { isVoiceEnabled } from './voice/voiceGate';
import { initCosmosStore } from './cosmos-store';
import { resolveSecrets } from './secret-resolver';
import { initServiceBus, closeServiceBus, getServiceBusStatus } from './service-bus';
import { createA2AHandler, getDiscoveryManifest, registerServiceNowAgent } from './connected-agents';
import { initRedis, closeRedis, getRedisStatus } from './redis-store';
import { handleApprovalCallback, cancelAllPendingApprovals } from './teams-approvals';
import { handleFlowCallback, getPowerAutomateStatus } from './power-automate';
import { trackEvent, trackWorkerRouting, getKqlTemplates } from './log-analytics';
import { setupConnection as setupGraphConnector, getConnectorStatus } from './graph-connector';
import { getEmailServiceStatus } from './email-service';
import { getGraphMailStatus } from './graph-mail';
import { getPlannerStatus } from './planner-tasks';
import { getSharePointStatus } from './sharepoint-docs';
import { isApimEnabled, getApimStatus, getProxiedEndpoint } from './apim-gateway';
import { getComputerUseStatus } from './computer-use';
import { getTuningStatus, createTuningDataset, extractResolvedIncidents, extractResolvedProblems } from './copilot-tuning';
import { isFoundryEnabled, getFoundryStatus } from './foundry-agents';
import { signalRouter, type Signal } from './signal-router';
import { registerDefaultSubscriptions } from './workflow-subscriptions';
import { DemoDirector, DemoTargetNotAllowedError } from './demo/demo-director';
import { sendEmail as sendGraphMail } from './graph-mail';
import { autonomousActions } from './autonomous-actions';
import { startForesight, stopForesight, getRecentForecasts, runForesightOnce, backfillForesight } from './foresight';
import {
  isKillSwitchEngaged,
  getKillState,
  engageKillSwitch,
  releaseKillSwitch,
  getBudgetSnapshot,
  isChangeFreezeActive,
  getChangeFreezeWindows,
  setChangeFreezeWindows,
  statementsOfAutonomy,
} from './governance';
import { getRecentOutcomes, getRollingSuccessRate } from './outcome-verifier';
import { getTunedThresholds } from './autonomy-tuner';
import { pursueGoal, getRegisteredRecipes, planForGoal } from './goal-seeker';
import { workflowEngine } from './workflow-engine';
import { workerMap } from './worker-definitions';

console.log(`ITSM Operations Digital Worker`);

// Keyless auth via managed identity (Azure) or local az login (dev)
export const credential = new DefaultAzureCredential();

// Only NODE_ENV=development disables authentication
const isDevelopment = process.env.NODE_ENV === 'development';

function isEnvFlagEnabled(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

let authConfig: AuthConfiguration = {};
if (!isDevelopment) {
  try {
    authConfig = loadAuthConfigFromEnv();
  } catch (err) {
    console.error('Failed to load auth config from env, continuing with empty config:', err);
  }
}
console.log(`Environment: NODE_ENV=${process.env.NODE_ENV}, isDevelopment=${isDevelopment}`);

// Fail fast if SCHEDULED_SECRET not set in production
if (!isDevelopment && !process.env.SCHEDULED_SECRET) {
  console.warn('⚠️  SCHEDULED_SECRET is not set. The /api/scheduled endpoint will reject all requests in production.');
}

const server = express();
server.use(express.json());

// Health endpoint
server.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    agent: 'ITSM Operations Digital Worker',
    timestamp: new Date().toISOString(),
    uptimeMs: Math.floor(process.uptime() * 1000),
    voiceEnabled: isVoiceEnabled(),
    features: {
      architecture: 'multi-agent',
      workers: 13,
      tiers: ['core', 'extended', 'strategic'],
      shiftHandover: true,
      incidentMonitoring: true,
      slaPrediction: true,
      changeCorrelation: true,
      voice: true,
      hitlControls: true,
    },
  });
});

// Comprehensive platform status — all integrated services
server.get('/api/platform-status', (_req: Request, res: Response) => {
  res.json({
    timestamp: new Date().toISOString(),
    services: {
      foundry: getFoundryStatus(),
      serviceBus: getServiceBusStatus(),
      redis: getRedisStatus(),
      email: getEmailServiceStatus(),
      graphMail: getGraphMailStatus(),
      planner: getPlannerStatus(),
      sharepoint: getSharePointStatus(),
      graphConnector: getConnectorStatus(),
      powerAutomate: getPowerAutomateStatus(),
      apim: getApimStatus(),
      computerUse: getComputerUseStatus(),
      copilotTuning: getTuningStatus(),
    },
    kqlTemplates: Object.keys(getKqlTemplates()),
  });
});

// Voice page
server.get('/voice', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'voice', 'voice.html'));
});

// Avatar configuration — returns Entra auth token and avatar settings for client-side WebRTC
// Uses custom subdomain + Managed Identity (production) or az login (dev) — no subscription key needed
server.get('/api/voice/avatar-config', async (_req: Request, res: Response) => {
  const speechRegion = process.env.AZURE_SPEECH_REGION || '';
  const speechEndpoint = process.env.AZURE_SPEECH_ENDPOINT || '';
  const avatarCharacter = process.env.AVATAR_CHARACTER || 'lisa';
  const avatarStyle = process.env.AVATAR_STYLE || 'casual-sitting';

  if (!speechRegion) {
    res.status(200).json({ enabled: false, reason: 'AZURE_SPEECH_REGION not configured' });
    return;
  }

  try {
    // Get Entra token for Cognitive Services via Managed Identity (no key required)
    const tokenResponse = await credential.getToken('https://cognitiveservices.azure.com/.default');
    if (!tokenResponse?.token) {
      res.status(200).json({ enabled: false, reason: 'Failed to acquire Entra token for Speech service' });
      return;
    }
    const entraToken = tokenResponse.token;

    // Use custom subdomain endpoint (required when disableLocalAuth=true)
    // Falls back to regional endpoint if no custom domain configured
    const baseUrl = speechEndpoint
      ? speechEndpoint.replace(/\/$/, '')
      : `https://${speechRegion}.api.cognitive.microsoft.com`;

    // Fetch ICE relay token using Entra Bearer token via custom domain
    const iceUrl = speechEndpoint
      ? `${baseUrl}/tts/cognitiveservices/avatar/relay/token/v1`
      : `https://${speechRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`;
    const iceRes = await fetch(iceUrl, { headers: { Authorization: `Bearer ${entraToken}` } });
    if (!iceRes.ok) {
      const body = await iceRes.text();
      res.status(200).json({ enabled: false, reason: `ICE token fetch failed (${iceRes.status}): ${body.slice(0, 100)}` });
      return;
    }
    const iceData = await iceRes.json();

    // Issue a short-lived Speech auth token using Entra Bearer token
    const tokenRes = await fetch(
      `${baseUrl}/sts/v1.0/issueToken`,
      { method: 'POST', headers: { Authorization: `Bearer ${entraToken}`, 'Content-Length': '0' } }
    );
    const authToken = tokenRes.ok ? await tokenRes.text() : '';

    if (!authToken) {
      const errBody = tokenRes.ok ? '' : await tokenRes.text().catch(() => '');
      res.status(200).json({ enabled: false, reason: `Speech token failed (${tokenRes.status}): ${errBody.slice(0, 200)}` });
      return;
    }

    res.status(200).json({
      enabled: true,
      region: speechRegion,
      authToken,
      iceServers: iceData,
      character: avatarCharacter,
      style: avatarStyle,
      voice: process.env.AVATAR_VOICE || 'en-US-AvaMultilingualNeural',
    });
  } catch (err) {
    res.status(200).json({ enabled: false, reason: `Error: ${(err as Error).message}` });
  }
});

// Scheduled routine endpoint — protected by SCHEDULED_SECRET, not JWT
// Used by Azure Function timer triggers for shift handover and all routines
server.post('/api/scheduled', async (req: Request, res: Response) => {
  const secret = String(req.headers['x-scheduled-secret'] || req.body?.secret || '');
  const expected = process.env.SCHEDULED_SECRET || '';
  const secretBuf = Buffer.from(secret);
  const expectedBuf = Buffer.from(expected);
  if (!expected || secretBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(secretBuf, expectedBuf)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const routineId: string | undefined = req.body?.routineId;

    // Route to the correct handler based on routineId
    if (routineId === 'shift-handover') {
      console.log('Shift handover triggered via /api/scheduled');
      await generateHandover();
      res.status(200).json({ status: 'handover_complete', routineId, timestamp: new Date().toISOString() });
    } else if (routineId === 'incident-poll') {
      console.log('Incident poll triggered via /api/scheduled');
      await runIncidentPoll();
      res.status(200).json({ status: 'poll_complete', routineId, timestamp: new Date().toISOString() });
    } else if (routineId) {
      console.log(`Scheduled routine triggered via /api/scheduled: ${routineId}`);
      const result = await executeRoutine(routineId);
      res.status(200).json({ status: 'routine_complete', ...result, timestamp: new Date().toISOString() });
    } else {
      // Legacy fallback: no routineId — run shift handover (backwards compatibility)
      console.log('Scheduled briefing triggered via /api/scheduled (legacy, no routineId)');
      const { getStandaloneClient } = require('./client');
      const client = await getStandaloneClient();
      const response = await client.invokeAgentWithScope('Generate the shift handover briefing and email it to the ops manager.');
      res.status(200).json({ status: 'briefing_complete', response, timestamp: new Date().toISOString() });
    }
  } catch (err: unknown) {
    console.error('Scheduled routine error:', err);
    res.status(500).json({ error: String((err as Error).message || err), timestamp: new Date().toISOString() });
  }
});

// Approval queue summary
server.get('/api/approvals', (_req: Request, res: Response) => {
  res.status(200).json(getQueueSummary());
});

// Approval callback endpoint
server.post('/api/approvals/callback', (req: Request, res: Response) => {
  const { approvalId, status, respondedBy, comments } = req.body;
  const handled = handleApprovalCallback(approvalId, status, respondedBy, comments);
  res.json({ handled });
});

// Scheduled routines status endpoint
server.get('/api/routines', (_req: Request, res: Response) => {
  res.status(200).json({ routines: getRoutineStatus() });
});

// Audit trail summary endpoint
server.get('/api/audit', (_req: Request, res: Response) => {
  res.status(200).json(getAuditSummary());
});

// Memory store summary endpoint
server.get('/api/memory', (_req: Request, res: Response) => {
  res.status(200).json(getMemoryStoreSummary());
});

// Reasoning trace endpoint — agent decision-making process
server.get('/api/reasoning', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 200;
  const conversationId = req.query.conversationId as string;
  const type = req.query.type as string;
  const since = req.query.since as string;

  res.status(200).json({
    traces: getTraces({ limit, conversationId, type: type as any, since }),
    conversations: getConversations(50),
    stats: getReasoningStats(),
  });
});

// A2A Connected Agents endpoints
server.post('/api/a2a/message', createA2AHandler());
server.get('/api/a2a/discover', (_req: Request, res: Response) => res.json(getDiscoveryManifest()));

// Power Automate flow callback
server.post('/api/flows/callback', async (req: Request, res: Response) => {
  try {
    const handled = await handleFlowCallback(req.body);
    res.json({ handled });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Worker registry endpoint — lists all available ITIL 4 workers
server.get('/api/workers', (_req: Request, res: Response) => {
  const { allWorkers } = require('./worker-definitions');
  const workers = allWorkers.map((w: any) => ({
    id: w.id,
    name: w.name,
    itilPractice: w.itilPractice,
    toolCount: w.tools?.length || 0,
  }));
  res.status(200).json({ workers, total: workers.length });
});

// Mission Control dashboard
server.get('/mission-control', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'mission-control.html'));
});

// Tuning pipeline endpoints
server.post('/api/tuning/extract', async (req: Request, res: Response) => {
  try {
    const months = req.body?.months || 12;
    const [incidents, problems] = await Promise.all([
      extractResolvedIncidents(months),
      extractResolvedProblems(months),
    ]);
    const allExamples = [...incidents, ...problems];
    const dataset = await createTuningDataset();
    res.status(200).json({
      dataset,
      preview: allExamples.slice(0, 3),
      totalExamples: allExamples.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Tuning extraction failed', message: err.message });
  }
});

server.get('/api/tuning/status', (_req: Request, res: Response) => {
  const status = getTuningStatus();
  res.status(200).json(status);
});

// ── Signal bus surface (Phase 1/2) ──

const SIGNAL_REPLAY_WINDOW_MS = 10 * 60 * 1000;
const recentSignalIds: Array<{ id: string; expiresAt: number }> = [];
function signalAlreadySeen(id: string): boolean {
  const now = Date.now();
  for (let i = recentSignalIds.length - 1; i >= 0; i--) {
    if (recentSignalIds[i].expiresAt < now) recentSignalIds.splice(i, 1);
  }
  return recentSignalIds.some((e) => e.id === id);
}
function markSignalSeen(id: string): void {
  recentSignalIds.push({ id, expiresAt: Date.now() + SIGNAL_REPLAY_WINDOW_MS });
}

function signalsAuthOk(req: Request): boolean {
  const provided = String(req.headers['x-scheduled-secret'] || req.body?.secret || '');
  const expected = process.env.SCHEDULED_SECRET || '';
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

server.post('/api/signals', async (req: Request, res: Response) => {
  if (!signalsAuthOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const signal = req.body?.signal as Signal | undefined;
  if (!signal || !signal.id || !signal.source || !signal.type) {
    res.status(400).json({ error: 'signal payload missing id/source/type' });
    return;
  }
  if (signalAlreadySeen(signal.id)) {
    res.status(202).json({ status: 'duplicate', signalId: signal.id });
    return;
  }
  markSignalSeen(signal.id);
  try {
    const decisions = await signalRouter.publish(signal);
    res.status(202).json({ status: 'accepted', signalId: signal.id, decisions });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

server.get('/api/signals', (req: Request, res: Response) => {
  const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit || '50'), 10) || 50));
  res.status(200).json({ signals: signalRouter.getRecentSignals(limit) });
});

server.get('/api/decisions', (req: Request, res: Response) => {
  const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit || '50'), 10) || 50));
  res.status(200).json({ decisions: signalRouter.getRecentDecisions(limit) });
});

// ── Demo Director surface (Phase 3) ──
// Tenant-flagged, secret-protected. Refuses to run unless the tenant profile
// has allowDemoDirector = true and the SNOW host is on the allow-list.
server.post('/api/demo', async (req: Request, res: Response) => {
  if (!signalsAuthOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const action = String(req.body?.action || '');
  const tenantId = String(req.body?.tenantId || process.env.TENANT_ID || 'default');
  const instanceUrl = String(req.body?.instanceUrl || process.env.SNOW_INSTANCE_URL || '');
  const authHeader = String(req.body?.authHeader || process.env.SNOW_AUTH_HEADER || '');

  try {
    const director = new DemoDirector({ tenantId, instanceUrl, authHeader });
    if (action === 'list') {
      res.status(200).json({ scenarios: director.list(), profile: director.getProfile() });
      return;
    }
    if (action === 'status') {
      res.status(200).json({ profile: director.getProfile() });
      return;
    }
    if (action === 'run') {
      const scenario = String(req.body?.scenario || '');
      if (!scenario) {
        res.status(400).json({ error: 'scenario id required' });
        return;
      }
      const report = await director.run(scenario);
      res.status(200).json({ report });
      return;
    }
    res.status(400).json({ error: `unknown action: ${action}` });
  } catch (err) {
    if (err instanceof DemoTargetNotAllowedError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Demo: scripted P1 storm (no SNOW required) ─────────────────────────
// One-click button on Mission Control fires this. It synthesizes the same
// scripted signals that `verify-mir-workflow` used during validation so the
// signal-router → trigger-policy → major-incident-bridge / sla-breach
// workflows light up end-to-end without needing a live ServiceNow tenant.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

server.post('/api/demo/scripted-storm', async (_req: Request, res: Response) => {
  const now = Date.now();
  const runId = `storm-${now}`;
  const baseTime = new Date(now).toISOString();
  const stormSignals: Signal[] = [
    {
      id: `${runId}-monitor-bgp`,
      source: 'monitor',
      type: 'edge-router.link-flap',
      severity: 'high',
      asset: 'edge-router-01',
      payload: { runId, message: 'BGP session flapping on edge-router-01' },
      occurredAt: baseTime,
      origin: 'scripted',
    },
    {
      id: `${runId}-snow-inc-001`,
      source: 'servicenow',
      type: 'incident.created',
      severity: 'critical',
      asset: 'edge-router-01',
      payload: { runId, number: 'INC9000001', priority: '1', short_description: 'Customers reporting intermittent connectivity loss' },
      occurredAt: baseTime,
      origin: 'scripted',
    },
    {
      id: `${runId}-snow-inc-002`,
      source: 'servicenow',
      type: 'incident.created',
      severity: 'critical',
      asset: 'vpn-gw-01',
      payload: { runId, number: 'INC9000002', priority: '1', short_description: 'VPN gateway returning timeouts for remote workforce' },
      occurredAt: baseTime,
      origin: 'scripted',
    },
    {
      id: `${runId}-snow-inc-003`,
      source: 'servicenow',
      type: 'incident.created',
      severity: 'critical',
      asset: 'checkout-svc',
      payload: { runId, number: 'INC9000003', priority: '1', short_description: 'Production checkout latency spiking above 8s' },
      occurredAt: baseTime,
      origin: 'scripted',
    },
    {
      id: `${runId}-snow-sla-breach`,
      source: 'servicenow',
      type: 'sla.breach-imminent',
      severity: 'high',
      asset: 'INC9000001',
      payload: { runId, number: 'INC9000001', minutesToBreach: 12 },
      occurredAt: baseTime,
      origin: 'scripted',
    },
  ];

  // Fire-and-forget: handlers may be long-running (LLM workflows). We
  // return immediately so the demo button feels snappy; routing decisions
  // surface in the Live Ops Feed via /api/decisions polling.
  for (const s of stormSignals) {
    void signalRouter.publish(s).catch((err) => {
      console.warn('[demo:scripted-storm] publish failed', s.id, (err as Error).message);
    });
  }

  res.status(202).json({
    status: 'accepted',
    runId,
    signalsInjected: stormSignals.length,
    note: 'Signals dispatched asynchronously — watch /mission-control or /api/decisions for routing outcomes.',
  });
});

// ── ACS Call Automation callback events ──
// ACS POSTs CloudEvents-formatted JSON arrays here for each call lifecycle
// event (CallConnected, CallDisconnected, CreateCallFailed, etc.). Must be
// publicly reachable — set PUBLIC_HOSTNAME / CONTAINER_APP_HOSTNAME so ACS
// can build the callback URL on createCall.
server.post('/api/calls/acs-events', (req: Request, res: Response) => {
  try {
    handleAcsEvent(req.body);
  } catch (err) {
    console.warn('[acs-bridge] event handler threw', (err as Error).message);
  }
  res.status(200).json({ ok: true });
});

// Diagnostics — list active ACS-bridged calls.
server.get('/api/calls/active', (_req: Request, res: Response) => {
  res.status(200).json({
    acsConfigured: isAcsConfigured(),
    activeCalls: getActiveCallSnapshot(),
  });
});

// ── Voice: page me ──
// Triggered by the "Page me" button on Mission Control or by Alex when she
// needs the human on the bridge. Three delivery channels, in priority order:
//   1. ACS Call Automation outbound Teams call (Cassidy pattern) — when ACS
//      is configured AND we have an AAD object id for the manager. Alex
//      actually rings the user's Teams client and speaks via Voice Live.
//   2. Teams channel post + email — always attempted. Both contain a
//      Teams click-to-call deep link as a fallback CTA.
//   3. Browser /voice avatar page — debug/fallback link in the response.
server.post('/api/voice/page-me', async (req: Request, res: Response) => {
  const reason = String(req.body?.reason || 'Alex needs you on the bridge.');
  const ownerEmail = process.env.MANAGER_EMAIL || process.env.OWNER_EMAIL || process.env.GRAPH_SENDER || '';
  const teamId = process.env.ITSM_TEAM_ID || '';
  const channelId = process.env.ITSM_ALERTS_CHANNEL_ID || process.env.ITSM_CHANNEL_ID || '';
  const baseHost = req.get('x-forwarded-host') || req.get('host') || '';
  const proto = (req.get('x-forwarded-proto') || 'https').split(',')[0].trim();
  const voiceUrl = baseHost ? `${proto}://${baseHost}/voice` : '/voice';

  // Teams click-to-call deep link target. Defaults to the GRAPH_MAIL_SENDER
  // (alexitops UPN) which is the Alex IT Ops Teams identity. Override via
  // ALEX_TEAMS_UPN if Alex moves to a different mailbox or a calling bot.
  const alexTeamsUpn = process.env.ALEX_TEAMS_UPN || process.env.GRAPH_MAIL_SENDER || '';
  const teamsCallUrl = alexTeamsUpn
    ? `https://teams.microsoft.com/l/call/0/0?users=${encodeURIComponent(alexTeamsUpn)}&withVideo=false&source=itsm-page-me`
    : '';

  // Manager AAD Object ID — required for ACS outbound Teams call (the
  // microsoftTeamsUserId field on the call invite must be the user's Entra
  // OID, not their UPN). Set MANAGER_TEAMS_OID to enable the Cassidy-style
  // outbound call path.
  const managerOid =
    String(req.body?.teamsUserAadOid || '').trim() ||
    process.env.MANAGER_TEAMS_OID ||
    process.env.OWNER_TEAMS_OID ||
    '';
  const requestedBy = String(req.body?.requestedBy || process.env.MANAGER_NAME || '').trim() || undefined;

  const delivered: string[] = [];
  const errors: Record<string, string> = {};
  let acsCallConnectionId: string | undefined;

  // 1. ACS Call Automation outbound Teams call (preferred) — Alex actually
  // rings the user's Teams client and bridges to Voice Live.
  if (isAcsConfigured() && managerOid) {
    try {
      const r = await initiateOutboundTeamsCall({
        teamsUserAadOid: managerOid,
        requestedBy,
        reason,
      });
      acsCallConnectionId = r.callConnectionId;
      delivered.push('acs-call');
      console.log(`[page-me] ACS outbound call placed → ${managerOid} (${r.callConnectionId})`);
    } catch (err) {
      errors.acsCall = (err as Error).message;
      console.warn('[page-me] ACS outbound call failed, falling back to chat/email', errors.acsCall);
    }
  } else if (!isAcsConfigured()) {
    errors.acsCall = 'ACS not configured (set ACS_CONNECTION_STRING + PUBLIC_HOSTNAME)';
  } else if (!managerOid) {
    errors.acsCall = 'MANAGER_TEAMS_OID not set (need user Entra OID for ACS Teams interop)';
  }

  // 2a. Teams channel post (HTML) — always attempted as audit trail / mobile
  // notification. CTA is the Teams click-to-call deep link.
  if (teamId && channelId) {
    try {
      const acsLine = acsCallConnectionId
        ? `<div style="margin:6px 0;font-size:12px;color:#16a34a">📞 Alex is calling you on Teams now (call id ${acsCallConnectionId.slice(0, 8)})</div>`
        : '';
      const primaryCta = teamsCallUrl
        ? `<a href="${teamsCallUrl}" style="display:inline-block;background:#6264a7;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600">📞 Call Alex on Teams</a>`
        : `<a href="${voiceUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600">🎙 Talk to Alex now</a>`;
      const html = `<div style="font-family:Segoe UI,sans-serif">
  <div style="font-size:18px;font-weight:600;color:#dc2626">📞 Alex is paging you</div>
  <div style="margin:8px 0">${escapeHtml(reason)}</div>
  ${acsLine}
  <div style="margin:12px 0">${primaryCta}</div>
  <div style="font-size:11px;color:#64748b">Sent ${new Date().toLocaleString()}</div>
</div>`;
      const r = await autonomousActions.postToTeamsChannel(teamId, channelId, html);
      if (r.success) delivered.push('teams');
      else errors.teams = r.error || 'unknown';
    } catch (err) {
      errors.teams = (err as Error).message;
    }
  } else {
    errors.teams = 'ITSM_TEAM_ID / ITSM_ALERTS_CHANNEL_ID not configured';
  }

  // 2b. Email — always attempted. Primary CTA is the Teams click-to-call link.
  if (ownerEmail) {
    try {
      const acsLine = acsCallConnectionId
        ? `<p style="margin:0 0 12px 0;font-size:13px;color:#16a34a">📞 Alex is calling you on Teams now — answer the incoming Teams call.</p>`
        : '';
      const primaryCta = teamsCallUrl
        ? `<a href="${teamsCallUrl}" style="display:inline-block;background:#6264a7;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">📞 Call Alex on Teams</a>`
        : `<a href="${voiceUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">🎙 Talk to Alex now</a>`;
      const html = `<div style="font-family:Segoe UI,sans-serif;max-width:560px">
  <div style="background:linear-gradient(135deg,#dc2626,#7f1d1d);color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;font-size:18px;font-weight:600">📞 Alex is paging you</div>
  <div style="border:1px solid #e5e7eb;border-top:none;padding:18px;border-radius:0 0 8px 8px">
    <p style="margin:0 0 12px 0;font-size:14px">${escapeHtml(reason)}</p>
    ${acsLine}
    <p style="margin:0 0 16px 0">${primaryCta}</p>
    <p style="margin:0;font-size:11px;color:#64748b">Sent ${new Date().toLocaleString()} from ITSM Operations Mission Control.</p>
  </div>
</div>`;
      const r = await sendGraphMail({
        to: [ownerEmail],
        subject: `📞 Alex is paging you — ${reason.slice(0, 60)}`,
        body: html,
        isHtml: true,
        importance: 'high',
      });
      if (r.sent) delivered.push('email');
      else errors.email = r.error || 'send failed';
    } catch (err) {
      errors.email = (err as Error).message;
    }
  } else {
    errors.email = 'MANAGER_EMAIL / OWNER_EMAIL not configured';
  }

  // Always return 200. status reflects what actually shipped.
  const status = acsCallConnectionId
    ? 'calling'
    : delivered.length
    ? 'sent'
    : teamsCallUrl
    ? 'call-only'
    : 'voice-only';

  res.status(200).json({
    status,
    reason,
    acsCallConnectionId,
    acsConfigured: isAcsConfigured(),
    teamsCallUrl: teamsCallUrl || undefined,
    alexTeamsUpn: alexTeamsUpn || undefined,
    managerOid: managerOid || undefined,
    voiceUrl,
    delivered,
    errors: Object.keys(errors).length ? errors : undefined,
  });
});

// ── Foresight (Pillar 3) ──
server.get('/api/foresight', (req: Request, res: Response) => {
  const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit || '50'), 10) || 50));
  res.status(200).json({ forecasts: getRecentForecasts(limit) });
});

server.post('/api/foresight/run', async (req: Request, res: Response) => {
  if (!signalsAuthOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const tick = await runForesightOnce(signalRouter.getRecentSignals(200));
  res.status(200).json({ tick });
});

// ── Outcomes (Pillar 4) ──
server.get('/api/outcomes', (req: Request, res: Response) => {
  const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit || '50'), 10) || 50));
  const wf = String(req.query.workflowId || '');
  const sigType = String(req.query.signalType || '');
  const recent = getRecentOutcomes(limit);
  const stats = wf ? getRollingSuccessRate(wf, sigType || undefined) : null;
  res.status(200).json({ outcomes: recent, stats });
});

// ── Governance (Pillar 7) ──
server.get('/api/governance', (req: Request, res: Response) => {
  const tenantId = String(req.query.tenantId || 'default');
  const workers = Array.from(workerMap.values());
  res.status(200).json({
    killSwitch: getKillState(),
    changeFreezeActive: isChangeFreezeActive(),
    changeFreezeWindows: getChangeFreezeWindows(),
    budget: getBudgetSnapshot(tenantId),
    statementsOfAutonomy: statementsOfAutonomy(workers),
  });
});

server.post('/api/governance/kill', (req: Request, res: Response) => {
  if (!signalsAuthOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const by = String(req.body?.by || 'api');
  const reason = req.body?.reason ? String(req.body.reason) : undefined;
  const state = engageKillSwitch(by, reason);
  res.status(200).json({ killSwitch: state });
});

server.post('/api/governance/release', (req: Request, res: Response) => {
  if (!signalsAuthOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const by = String(req.body?.by || 'api');
  const state = releaseKillSwitch(by);
  res.status(200).json({ killSwitch: state });
});

server.post('/api/governance/freeze', (req: Request, res: Response) => {
  if (!signalsAuthOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const windows = Array.isArray(req.body?.windows) ? req.body.windows : [];
  setChangeFreezeWindows(windows);
  res.status(200).json({ changeFreezeWindows: getChangeFreezeWindows() });
});

// ── Tuner (Pillar 6) ──
server.get('/api/autonomy/thresholds', (req: Request, res: Response) => {
  const wf = String(req.query.workflowId || 'major-incident-response');
  const st = req.query.signalType ? String(req.query.signalType) : undefined;
  res.status(200).json({ workflowId: wf, signalType: st, tuned: getTunedThresholds(wf, st) });
});

// ── Goals (Pillar 5) ──
server.get('/api/goals', (_req: Request, res: Response) => {
  res.status(200).json({ recipes: getRegisteredRecipes() });
});

server.post('/api/goals/plan', (req: Request, res: Response) => {
  const goal = String(req.body?.goal || '');
  if (!goal) { res.status(400).json({ error: 'goal required' }); return; }
  res.status(200).json({ plan: planForGoal(goal) });
});

server.post('/api/goals/pursue', async (req: Request, res: Response) => {
  if (!signalsAuthOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const goal = String(req.body?.goal || '');
  const ctx = (req.body?.context as Record<string, unknown> | undefined) ?? {};
  if (!goal) { res.status(400).json({ error: 'goal required' }); return; }
  try {
    const report = await pursueGoal(workflowEngine, goal, { context: ctx });
    res.status(200).json({ report });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Experiential memory (Phase 9.4) ──
server.get('/api/experience/recent', async (req: Request, res: Response) => {
  const { getExperientialMemory } = await import('./experiential-memory');
  const limit = Math.min(200, Number(req.query.limit) || 50);
  res.status(200).json({ memory: getExperientialMemory(limit) });
});

server.post('/api/experience/find', async (req: Request, res: Response) => {
  const signal = req.body?.signal;
  if (!signal || typeof signal !== 'object') {
    res.status(400).json({ error: 'signal required (Signal-shaped object)' });
    return;
  }
  const { findPriorPattern } = await import('./experiential-memory');
  const result = findPriorPattern(signal as any, {
    topK: Number(req.body?.topK) || undefined,
    minSimilarity: Number(req.body?.minSimilarity) || undefined,
  });
  res.status(200).json({ pattern: result });
});

// ── Cognition graph (Phase 9.5) ──
server.get('/api/cognition/graph', async (_req: Request, res: Response) => {
  const { buildCognitionGraph } = await import('./cognition-graph');
  res.status(200).json(buildCognitionGraph());
});

// ── Async jobs (Phase 9.6) ──
server.get('/api/jobs', async (req: Request, res: Response) => {
  const { listJobs, getJobStats } = await import('./async-jobs');
  const limit = Math.min(200, Number(req.query.limit) || 50);
  res.status(200).json({ jobs: listJobs(limit), stats: getJobStats() });
});

server.get('/api/jobs/:id', async (req: Request, res: Response) => {
  const { getJob } = await import('./async-jobs');
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'job not found' });
    return;
  }
  res.status(200).json({ job });
});

// Apply JWT auth middleware for routes below — skip public routes
server.use((req, res, next) => {
  const publicPaths = ['/api/health', '/api/platform-status', '/api/voice/status', '/api/voice/avatar-config', '/api/voice/page-me', '/voice', '/api/scheduled', '/api/signals', '/api/decisions', '/api/demo', '/api/demo/scripted-storm', '/api/foresight', '/api/foresight/run', '/api/outcomes', '/api/governance', '/api/governance/kill', '/api/governance/release', '/api/governance/freeze', '/api/autonomy/thresholds', '/api/goals', '/api/goals/plan', '/api/goals/pursue', '/api/experience', '/api/experience/recent', '/api/experience/find', '/api/jobs', '/api/cognition', '/api/cognition/graph', '/api/workers', '/api/approvals', '/api/approvals/callback', '/api/routines', '/api/audit', '/api/memory', '/api/reasoning', '/mission-control', '/api/a2a/message', '/api/a2a/discover', '/api/flows/callback', '/api/tuning/extract', '/api/tuning/status'];
  // Phase 9 — prefix matching for parameterised routes (e.g. /api/jobs/:id).
  const publicPrefixes = ['/api/jobs/'];
  if (publicPaths.some(p => req.path === p)) {
    return next();
  }
  if (publicPrefixes.some(p => req.path.startsWith(p))) {
    return next();
  }
  return authorizeJWT(authConfig)(req, res, next);
});

// Main messages endpoint — Teams bot channel via CloudAdapter (Agent 365 SDK)
server.post('/api/messages', (req: AgentRequest, res: Response) => {
  const adapter = agentApplication.adapter as CloudAdapter;
  adapter.process(req, res, async (context) => {
    await agentApplication.run(context);
  });
});

// Chat endpoint for direct API access (testing) — protected by JWT
server.post('/api/chat', async (req: Request, res: Response) => {
  const { message } = req.body;
  if (!message) { res.status(400).json({ error: 'message required' }); return; }
  try {
    const { getStandaloneClient } = require('./client');
    const client = await getStandaloneClient();
    const response = await client.invokeAgentWithScope(message);
    res.json({ response });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Agent-to-Agent (A2A) messages endpoint — same processing, separate logging
server.post('/api/agent-messages', (req: AgentRequest, res: Response) => {
  console.log('A2A message received from:', req.headers['x-agent-id'] || 'unknown-agent');
  const adapter = agentApplication.adapter as CloudAdapter;
  adapter.process(req, res, async (context) => {
    await agentApplication.run(context);
  });
});

const port = Number(process.env.PORT) || 3978;
const host = process.env.HOST ?? (isDevelopment ? 'localhost' : '0.0.0.0');

// Create raw HTTP server for WebSocket support
const httpServer = http.createServer((req, res) => {
  // Voice gate status — bypasses all Express middleware
  if (req.method === 'GET' && (req.url === '/api/voice/status' || req.url?.startsWith('/api/voice/status?'))) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ enabled: isVoiceEnabled() }));
    return;
  }
  // Everything else goes through Express
  server(req, res);
});

httpServer.listen(port, host, async () => {
  // Resolve secrets from Key Vault (or env fallback) before anything else
  await resolveSecrets();

  // Initialize Cosmos DB persistence (falls back to in-memory if not configured)
  await initCosmosStore();

  // Initialize Redis cache (falls back to in-memory if not configured)
  await initRedis();

  // Initialize Azure Service Bus pub/sub messaging (falls back to local dispatch if not configured)
  await initServiceBus();

  // Register ServiceNow first-party agent for A2A communication
  registerServiceNowAgent();

  // Initialize Graph Connector for M365 search indexing (non-blocking)
  setupGraphConnector().then(ok => {
    if (ok) console.log('  ✓ Microsoft Graph Connector initialized');
    else console.log('  ⚠ Graph Connector not configured (M365 search indexing disabled)');
  }).catch(err => console.warn('  ⚠ Graph Connector init failed:', (err as Error).message));

  console.log(`\n  ITSM Operations Digital Worker listening on ${host}:${port}`);
  console.log(`  Health:    http://${host}:${port}/api/health`);
  console.log(`  Messages:  http://${host}:${port}/api/messages`);
  console.log(`  Voice:     http://${host}:${port}/voice`);
  console.log(`  Chat:      http://${host}:${port}/api/chat`);
  console.log(`  Mission Control: http://${host}:${port}/mission-control`);

  attachVoiceWebSocket(httpServer);
  attachAcsMediaWebSocket(httpServer);

  const cronDisabled = isEnvFlagEnabled('DISABLE_CRON');

  console.log('\n  Starting autonomous services...');
  if (!cronDisabled) {
    startHandoverScheduler();
    startIncidentMonitor();
    startScheduledRoutines();
    console.log('  Scheduled worker routines started');
  } else {
    console.log('  DISABLE_CRON=true — skipping in-process schedulers (using Durable Functions timers)');
  }
  registerDefaultSubscriptions();
  console.log('  Signal-router default subscriptions registered');

  // Phase 9.1 — backfill anticipatory state from Azure Table Storage so that
  // restart does not erase forecasts/outcomes/tuner-overrides/governance.
  try {
    const { backfillOutcomes } = await import('./outcome-verifier');
    const { backfillTuner } = await import('./autonomy-tuner');
    const { backfillGovernance } = await import('./governance');
    const { backfillExperientialMemory } = await import('./experiential-memory');
    const [forecasts, outcomes, tuner, gov, experiential] = await Promise.all([
      backfillForesight().catch(() => 0),
      backfillOutcomes().catch(() => 0),
      backfillTuner().catch(() => 0),
      backfillGovernance().catch(() => ({ kill: 0, freeze: 0, tenants: 0 })),
      backfillExperientialMemory().catch(() => 0),
    ]);
    console.log(
      `  Anticipatory state restored: forecasts=${forecasts} outcomes=${outcomes} tunerKeys=${tuner} governance(kill=${(gov as any).kill}, freeze=${(gov as any).freeze}, tenants=${(gov as any).tenants}) experiential=${experiential}`,
    );
  } catch (err) {
    console.warn('  Anticipatory backfill skipped:', (err as Error).message);
  }

  if (!isEnvFlagEnabled('DISABLE_FORESIGHT')) {
    startForesight();
    console.log('  Foresight engine started');
  } else {
    console.log('  DISABLE_FORESIGHT=true — skipping foresight engine');
  }

  initMetrics();
  console.log('  OpenTelemetry metrics initialized');
  console.log('\n  ITSM Operations Digital Worker is ready!\n');

  // Pre-warm managed identity token to avoid first-message IMDS cold-start delay (~60s)
  if (!isDevelopment) {
    credential.getToken('https://cognitiveservices.azure.com/.default')
      .then(() => console.log('  Managed identity token pre-warmed successfully'))
      .catch((err: unknown) => console.warn('  Token pre-warm failed (will retry on first message):', err));
  }
});

// ── Graceful Shutdown ──
// Cleans up intervals, cron jobs, and connections on SIGTERM/SIGINT (container orchestration)
function gracefulShutdown(signal: string) {
  console.log(`\n  ${signal} received — shutting down gracefully...`);
  cancelAllPendingApprovals();
  if (!isEnvFlagEnabled('DISABLE_CRON')) {
    stopIncidentMonitor();
    stopHandoverScheduler();
    stopScheduledRoutines();
  }
  stopForesight();
  closeServiceBus().catch(() => {});
  closeRedis().catch(() => {});
  httpServer.close(() => {
    console.log('  HTTP server closed');
    process.exit(0);
  });
  // Force exit after 10s if graceful close hangs
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
