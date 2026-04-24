// ITSM Operations Digital Worker — Entry point

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
import { startHandoverScheduler } from './shift-handover';
import { startIncidentMonitor } from './incident-monitor';
import { getAuditSummary, getRecentAuditEntries } from './audit-trail';
import { getMemoryStoreSummary } from './memory-store';
import { startScheduledRoutines, getRoutineStatus } from './scheduled-routines';
import { getQueueSummary } from './approval-queue';
import { attachVoiceWebSocket } from './voice/voiceProxy';
import { isVoiceEnabled } from './voice/voiceGate';

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

// Voice page
server.get('/voice', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'voice', 'voice.html'));
});

// Scheduled briefing endpoint — protected by SCHEDULED_SECRET, not JWT
// Used by Azure Function timer triggers for shift handover
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
    console.log('Scheduled briefing triggered via /api/scheduled');
    const { getStandaloneClient } = require('./client');
    const client = await getStandaloneClient();
    const response = await client.invokeAgentWithScope('Generate the shift handover briefing and email it to the ops manager.');
    res.status(200).json({ status: 'briefing_complete', response, timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('Scheduled briefing error:', err);
    res.status(500).json({ error: 'Briefing failed', timestamp: new Date().toISOString() });
  }
});

// Approval queue summary
server.get('/api/approvals', (_req: Request, res: Response) => {
  res.status(200).json(getQueueSummary());
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

// Apply JWT auth middleware for routes below — skip public routes
server.use((req, res, next) => {
  const publicPaths = ['/api/health', '/api/voice/status', '/voice', '/api/scheduled', '/api/workers', '/api/approvals', '/api/routines', '/api/audit', '/api/memory'];
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
  console.log(`\n  ITSM Operations Digital Worker listening on ${host}:${port}`);
  console.log(`  Health:    http://${host}:${port}/api/health`);
  console.log(`  Messages:  http://${host}:${port}/api/messages`);
  console.log(`  Voice:     http://${host}:${port}/voice`);
  console.log(`  Chat:      http://${host}:${port}/api/chat`);

  attachVoiceWebSocket(httpServer);

  console.log('\n  Starting autonomous services...');
  startHandoverScheduler();
  startIncidentMonitor();
  startScheduledRoutines();
  console.log('  Scheduled worker routines started');
  console.log('\n  ITSM Operations Digital Worker is ready!\n');

  // Pre-warm managed identity token to avoid first-message IMDS cold-start delay (~60s)
  if (!isDevelopment) {
    credential.getToken('https://cognitiveservices.azure.com/.default')
      .then(() => console.log('  Managed identity token pre-warmed successfully'))
      .catch((err: unknown) => console.warn('  Token pre-warm failed (will retry on first message):', err));
  }
});
