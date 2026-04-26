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
import { getGraphMailStatus } from './graph-mail';
import { getPlannerStatus } from './planner-tasks';
import { getSharePointStatus } from './sharepoint-docs';
import { isApimEnabled, getApimStatus, getProxiedEndpoint } from './apim-gateway';
import { getComputerUseStatus } from './computer-use';
import { getTuningStatus, createTuningDataset, extractResolvedIncidents, extractResolvedProblems } from './copilot-tuning';
import { isFoundryEnabled, getFoundryStatus } from './foundry-agents';

console.log(`ITSM Operations Digital Worker`);

// Keyless auth via managed identity (Azure) or local az login (dev)
export const credential = new DefaultAzureCredential();

// Only NODE_ENV=development disables authentication
const isDevelopment = process.env.NODE_ENV === 'development';
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

// Apply JWT auth middleware for routes below — skip public routes
server.use((req, res, next) => {
  const publicPaths = ['/api/health', '/api/platform-status', '/api/voice/status', '/api/voice/avatar-config', '/voice', '/api/scheduled', '/api/workers', '/api/approvals', '/api/approvals/callback', '/api/routines', '/api/audit', '/api/memory', '/api/reasoning', '/mission-control', '/api/a2a/message', '/api/a2a/discover', '/api/flows/callback', '/api/tuning/extract', '/api/tuning/status'];
  if (publicPaths.some(p => req.path === p)) {
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

  const cronDisabled = !!process.env.DISABLE_CRON;

  console.log('\n  Starting autonomous services...');
  if (!cronDisabled) {
    startHandoverScheduler();
    startIncidentMonitor();
    startScheduledRoutines();
    console.log('  Scheduled worker routines started');
  } else {
    console.log('  DISABLE_CRON=true — skipping in-process schedulers (using Durable Functions timers)');
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
  if (!process.env.DISABLE_CRON) {
    stopIncidentMonitor();
    stopHandoverScheduler();
    stopScheduledRoutines();
  }
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
