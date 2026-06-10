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
import { startHandoverScheduler, stopHandoverScheduler, generateHandover, generateMidshiftRecap, getBriefingKpi, getRecentBriefings } from './shift-handover';
import { startIncidentMonitor, stopIncidentMonitor, runIncidentPoll } from './incident-monitor';
import { getAuditSummary, getRecentAuditEntries } from './audit-trail';
import { getMemoryStoreSummary } from './memory-store';
import { startScheduledRoutines, getRoutineStatus, stopScheduledRoutines, executeRoutine } from './scheduled-routines';import { getQueueSummary, resolveAction } from './approval-queue';
import { attachVoiceWebSocket } from './voice/voiceProxy';
import {
  attachAcsMediaWebSocket,
  handleAcsEvent,
  initiateOutboundTeamsCall,
  isAcsConfigured,
  getActiveCallSnapshot,
  getVoiceBridgeKpi,
} from './voice/acsBridge';
import { getVoiceApprovalKpi } from './voice/voiceApprovals';
import { getActiveWorkIqTransport } from './workiq-client';
import { getWorkIqKpi } from './workiq-api-client';
import {
  evaluateInboundA2A,
  extractA2AContextFromBody,
  getA2APolicyKpi,
} from './a2a-policy';
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
import { getTuningStatus, createTuningDataset, extractResolvedIncidents, extractResolvedProblems } from './copilot-tuning';
import { isFoundryEnabled, getFoundryStatus } from './foundry-agents';
import { signalRouter, type Signal } from './signal-router';
import { registerDefaultSubscriptions } from './workflow-subscriptions';
import { registerOutcomeProbes, getOutcomeProbeKpi } from './outcome-probes';
import { initCaseManager, getCaseKpi, listOpenCases, getCase as lookupCase } from './case-manager';
import { startCaseReminderLoop, getReminderKpi } from './case-reminders';
import { detectCorrelations, getCorrelationKpi } from './case-correlation';
import { getReviewerKpi } from './reviewer-worker';
import { startMetaMonitor, getMetaMonitorKpi, getRecentMetaAlerts } from './meta-monitor';
import { DemoDirector, DemoTargetNotAllowedError, type DemoCleanupMode } from './demo/demo-director';
import { autonomousWorkday, startAutonomousWorkday, stopAutonomousWorkday } from './autonomous-workday';
import { getKanbanSnapshot, getEndOfDaySummary } from './itsm-kanban';
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
import { buildSourceStatus } from './source-status';

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
    // Build SHA + version surfaced for production triage. Set
    // GIT_COMMIT_SHA at container build time (CI fills it from
    // ${{ github.sha }}); falls back to "dev" for local runs.
    build: {
      sha: process.env.GIT_COMMIT_SHA || 'dev',
      shaShort: (process.env.GIT_COMMIT_SHA || 'dev').slice(0, 7),
      builtAt: process.env.BUILD_TIMESTAMP || null,
    },
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
      copilotTuning: getTuningStatus(),
    },
    kqlTemplates: Object.keys(getKqlTemplates()),
  });
});

server.get('/api/source-status', async (req: Request, res: Response) => {
  const status = await buildSourceStatus(req.header('authorization'));
  res.status(200).json(status);
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
    } else if (routineId === 'midshift-recap') {
      // Phase 3.6 — second briefing per shift.
      console.log('Midshift recap triggered via /api/scheduled');
      await generateMidshiftRecap();
      res.status(200).json({ status: 'midshift_complete', routineId, timestamp: new Date().toISOString() });
    } else if (routineId === 'incident-poll') {
      console.log('Incident poll triggered via /api/scheduled');
      await runIncidentPoll();
      res.status(200).json({ status: 'poll_complete', routineId, timestamp: new Date().toISOString() });
    } else if (routineId === 'red-team-nightly') {
      // Phase 2.1 — Foundry red-team probe run. Tenant gate is enforced
      // inside `runRedTeamForTenant` so a tenant without `allowRedTeam=true`
      // returns `{ skipped:true, reason }` without calling the agent.
      console.log('Red-team nightly triggered via /api/scheduled');
      const { runRedTeamForTenant } = await import('./red-team-agent');
      const { getStandaloneClient } = require('./client');
      const client = await getStandaloneClient();
      const tenantId = process.env.TENANT_ID || 'default';
      const result = await runRedTeamForTenant(tenantId, async (prompt: string) => {
        return String(await client.invokeAgentWithScope(prompt));
      });
      res.status(200).json({ status: 'red_team_complete', tenantId, result, timestamp: new Date().toISOString() });
    } else if (routineId === 'end-of-day') {
      // Phase 3 — End-of-Day Kanban report. Computed in-process from the
      // existing in-memory stores (no LLM call). Durable Functions should
      // schedule this at 17:00 local for the configured time zone.
      console.log('End-of-Day report triggered via /api/scheduled');
      const summary = getEndOfDaySummary();
      // Reuse the dedicated endpoint logic by issuing an in-process call —
      // simpler is to inline the same delivery path here.
      const teamsId = process.env.ITSM_TEAM_ID || '';
      const channelId = process.env.ITSM_ALERTS_CHANNEL_ID || process.env.ITSM_CHANNEL_ID || '';
      const ownerEmail = process.env.MANAGER_EMAIL || process.env.OWNER_EMAIL || '';
      const delivered: string[] = [];
      const errors: Record<string, string> = {};
      const text = `End-of-Day — ${summary.totals['done-today']} done, ${summary.totals['proof']} need review, ${summary.totals['waiting']} awaiting approval (${summary.timeZone})`;
      if (teamsId && channelId) {
        try {
          const r = await autonomousActions.postToTeamsChannel(teamsId, channelId, text);
          if (r.success) delivered.push('teams');
          else errors.teams = r.error || 'unknown';
        } catch (err) {
          errors.teams = (err as Error).message;
        }
      }
      if (ownerEmail) {
        try {
          const r = await sendGraphMail({
            to: [ownerEmail],
            subject: `🌇 End-of-Day — Alex`,
            body: text,
            isHtml: false,
            importance: 'normal',
          });
          if (r.sent) delivered.push('email');
          else errors.email = r.error || 'send failed';
        } catch (err) {
          errors.email = (err as Error).message;
        }
      }
      res.status(200).json({ status: 'end_of_day_complete', summary, delivered, errors, timestamp: new Date().toISOString() });
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

// One-tap GET approval endpoint — used by the email approve/deny buttons in
// exception-reporter's approval email. Returns a friendly confirmation HTML
// page so the operator's browser shows something useful after the redirect.
//   GET /api/approvals/action?id=<actionId>&decision=approved|rejected&by=<name>
server.get('/api/approvals/action', (req: Request, res: Response) => {
  const id = String(req.query.id || '').trim();
  const raw = String(req.query.decision || '').trim().toLowerCase();
  const decision: 'approved' | 'rejected' = raw === 'rejected' || raw === 'deny' || raw === 'denied'
    ? 'rejected'
    : 'approved';
  const by = String(req.query.by || 'operator').trim() || 'operator';

  if (!id) {
    res.status(400)
      .set('Content-Type', 'text/html; charset=utf-8')
      .send('<h2>Missing <code>id</code> parameter</h2>');
    return;
  }

  let resolved: { actionId?: string; toolName?: string } | null = null;
  let errorMsg = '';
  try {
    const r = resolveAction(id, decision, by);
    resolved = r ? { actionId: (r as any).actionId, toolName: (r as any).toolName } : null;
  } catch (err) {
    errorMsg = (err as Error).message;
  }

  const badge = decision === 'approved'
    ? '<span style="background:#22c55e;color:#fff;padding:4px 12px;border-radius:6px;font-weight:600">✅ Approved</span>'
    : '<span style="background:#dc2626;color:#fff;padding:4px 12px;border-radius:6px;font-weight:600">🚫 Denied</span>';
  const status = resolved
    ? `<p>Recorded <strong>${decision}</strong> for <code>${resolved.toolName || resolved.actionId || id}</code>.</p><p>Alex is updating the evidence pack now. You can close this tab.</p>`
    : `<p>Decision <strong>${decision}</strong> recorded for audit, but no live queued action matched id <code>${id}</code> — it may have already been resolved or expired.</p>${errorMsg ? `<p style="color:#dc2626">${errorMsg}</p>` : ''}`;

  res.status(200)
    .set('Content-Type', 'text/html; charset=utf-8')
    .send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Approval recorded</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; background:#0f172a; color:#e2e8f0; margin:0; padding:40px 24px; }
  .card { max-width:560px; margin:60px auto; background:#1e293b; border:1px solid #334155; border-radius:12px; padding:28px 32px; }
  h1 { margin:0 0 6px; font-size:22px; }
  code { background:#0f172a; padding:2px 6px; border-radius:4px; font-size:13px; color:#a5b4fc; }
  p { line-height:1.55; }
  .small { color:#94a3b8; font-size:12px; margin-top:18px; border-top:1px solid #334155; padding-top:12px; }
</style></head>
<body>
  <div class="card">
    <h1>Approval recorded ${badge}</h1>
    ${status}
    <div class="small">Approver: <code>${by}</code> · Action id: <code>${id}</code></div>
  </div>
</body></html>`);
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
server.get('/mission-control.css', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'mission-control.css'));
});
server.get('/mission-control.js', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, 'mission-control.js'));
});
server.get('/favicon.ico', (_req: Request, res: Response) => {
  res.status(204).end();
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
//
// Active-runs tracking — `activeDemoRuns` holds the most recent demo runs
// (newest first, capped) so the Mission Control command-center can:
//   • light an "Active scenario" pill on inject,
//   • feed scenario context into the page-me button,
//   • pre-select the last runId in the cleanup button.
interface ActiveDemoRun {
  demoRunId: string;
  scenarioId: string;
  description: string;
  startedAt: string;
  passed?: boolean;
  completedAt?: string;
}
const ACTIVE_DEMO_RUNS_LIMIT = 20;
const activeDemoRuns: ActiveDemoRun[] = [];

function recordActiveDemoRun(entry: ActiveDemoRun): void {
  activeDemoRuns.unshift(entry);
  while (activeDemoRuns.length > ACTIVE_DEMO_RUNS_LIMIT) activeDemoRuns.pop();
}
function markActiveDemoRunComplete(demoRunId: string, passed: boolean): void {
  const run = activeDemoRuns.find((r) => r.demoRunId === demoRunId);
  if (run) {
    run.passed = passed;
    run.completedAt = new Date().toISOString();
  }
}
function removeActiveDemoRun(demoRunId: string): void {
  const idx = activeDemoRuns.findIndex((r) => r.demoRunId === demoRunId);
  if (idx >= 0) activeDemoRuns.splice(idx, 1);
}

// Public read — Mission Control picker pulls scenario metadata from here.
// No mutation, no SNOW write; safe to expose without SCHEDULED_SECRET so the
// UI can populate the dropdown on initial load.
server.get('/api/demo/scenarios', async (_req: Request, res: Response) => {
  const tenantId = process.env.TENANT_ID || 'default';
  const instanceUrl = process.env.SNOW_INSTANCE_URL || '';
  const authHeader = process.env.SNOW_AUTH_HEADER || '';
  try {
    const director = new DemoDirector({ tenantId, instanceUrl, authHeader });
    res
      .status(200)
      .json({ scenarios: director.listDetailed(), profile: director.getProfile() });
  } catch (err) {
    if (err instanceof DemoTargetNotAllowedError) {
      res.status(403).json({ error: err.message, scenarios: [] });
      return;
    }
    res.status(500).json({ error: (err as Error).message, scenarios: [] });
  }
});

// Public read — Mission Control polls this to know whether a demo is active
// (drives the "Active scenario" pill and the page-me button enable state).
server.get('/api/demo/active', (_req: Request, res: Response) => {
  res.status(200).json({ runs: activeDemoRuns });
});

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
      res.status(200).json({ scenarios: director.listDetailed(), profile: director.getProfile() });
      return;
    }
    if (action === 'status') {
      res.status(200).json({ profile: director.getProfile(), activeRuns: activeDemoRuns });
      return;
    }
    if (action === 'run') {
      const scenario = String(req.body?.scenario || '');
      if (!scenario) {
        res.status(400).json({ error: 'scenario id required' });
        return;
      }
      const meta = director.getScenarioMetadata(scenario);
      if (!meta) {
        res.status(404).json({ error: `Scenario not found: ${scenario}` });
        return;
      }
      const report = await director.run(scenario);
      // Track in activeDemoRuns so the page-me + cleanup buttons can find it.
      recordActiveDemoRun({
        demoRunId: report.demoRunId,
        scenarioId: report.scenarioId,
        description: meta.description,
        startedAt: new Date().toISOString(),
        passed: report.passed,
        completedAt: new Date().toISOString(),
      });
      markActiveDemoRunComplete(report.demoRunId, report.passed);
      // Phase 4 — proactive engagement: scenario started + completed.
      void import('./proactive-engagement').then(({ engageOperator }) => {
        engageOperator('scenario-started', { scenarioId: report.scenarioId, ctxKey: report.demoRunId, summary: `🎬 Picked up scenario **${report.scenarioId}** — ${meta.description}` }).catch(() => {});
        engageOperator('scenario-complete', { scenarioId: report.scenarioId, ctxKey: report.demoRunId, summary: `✅ Scenario **${report.scenarioId}** ${report.passed ? 'passed' : 'completed (with issues)'}. Check the Mission Control Kanban.` }).catch(() => {});
      }).catch(() => {});
      res.status(200).json({ report, activeRun: activeDemoRuns[0] });
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

// ── Demo cleanup ──
// Removes (or closes) every `u_demo_run`-tagged record on incident /
// change_request / problem / em_event so every demo starts from a clean PDI.
// SCHEDULED_SECRET-protected since it mutates live SNOW state.
//
// Body: { demoRunId?: string, mode?: 'delete' | 'close' }
//   demoRunId omitted → cleans ALL demo-tagged records (every run).
//   mode omitted     → uses env DEMO_CLEANUP_MODE (defaults to 'delete').
server.post('/api/demo/cleanup', async (req: Request, res: Response) => {
  if (!signalsAuthOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const tenantId = String(req.body?.tenantId || process.env.TENANT_ID || 'default');
  const instanceUrl = String(req.body?.instanceUrl || process.env.SNOW_INSTANCE_URL || '');
  const authHeader = String(req.body?.authHeader || process.env.SNOW_AUTH_HEADER || '');
  const demoRunIdRaw = req.body?.demoRunId;
  const demoRunId =
    typeof demoRunIdRaw === 'string' && demoRunIdRaw.trim() ? demoRunIdRaw.trim() : undefined;

  const envMode = String(process.env.DEMO_CLEANUP_MODE || 'delete').toLowerCase();
  const requestedMode = String(req.body?.mode || envMode).toLowerCase();
  const mode: DemoCleanupMode = requestedMode === 'close' ? 'close' : 'delete';

  try {
    const director = new DemoDirector({ tenantId, instanceUrl, authHeader });
    const result = await director.cleanup({ demoRunId, mode });
    // Trim active runs that were cleared (or all of them when no id given).
    if (demoRunId) {
      removeActiveDemoRun(demoRunId);
    } else if (result.totalCleaned > 0) {
      activeDemoRuns.length = 0;
    }
    res.status(200).json({ result, activeRuns: activeDemoRuns });
  } catch (err) {
    if (err instanceof DemoTargetNotAllowedError) {
      res.status(403).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Autonomous workday (Phase 2 — autonomous-operator loop) ─────────────
// State + on-demand cycle trigger + recent task buffer. All three are
// safe to call without auth EXCEPT the cycle trigger, which mutates SNOW.
server.get('/api/workday/state', (_req: Request, res: Response) => {
  res.status(200).json(autonomousWorkday.getState());
});

server.get('/api/workday/tasks', (req: Request, res: Response) => {
  const limit = Math.max(1, Math.min(50, parseInt(String(req.query.limit || '25'), 10) || 25));
  res.status(200).json({ tasks: autonomousWorkday.getTasks(limit) });
});

server.post('/api/workday/run-cycle', async (req: Request, res: Response) => {
  if (!signalsAuthOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const force = req.body?.force === true || String(req.query.force || '').toLowerCase() === 'true';
  try {
    const task = await autonomousWorkday.runCycle({ force });
    res.status(200).json({ task, state: autonomousWorkday.getState() });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Mission Control Kanban (Phase 3) ───────────────────────────────────
// Derived 5-lane view over signals / workflows / approvals / outcomes /
// audit. Pure read — safe to poll every 5–15s from the UI.
server.get('/api/kanban', (_req: Request, res: Response) => {
  try {
    res.status(200).json(getKanbanSnapshot());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// End-of-Day report — generates the Kanban summary, posts it to the ITSM
// alerts Teams channel, and emails MANAGER_EMAIL. SCHEDULED_SECRET-protected
// since it sends external notifications. Triggered by scheduled-routines at
// 17:00 local or manually for demos.
server.post('/api/scheduled/end-of-day', async (req: Request, res: Response) => {
  if (!signalsAuthOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const summary = getEndOfDaySummary();
  const teamsId = process.env.ITSM_TEAM_ID || '';
  const channelId = process.env.ITSM_ALERTS_CHANNEL_ID || process.env.ITSM_CHANNEL_ID || '';
  const ownerEmail = process.env.MANAGER_EMAIL || process.env.OWNER_EMAIL || '';
  const delivered: string[] = [];
  const errors: Record<string, string> = {};

  const fmtCards = (cards: typeof summary.doneToday): string =>
    cards.length === 0
      ? '<div style="color:#64748b;font-style:italic">none</div>'
      : cards
          .map(
            (c) =>
              `<div style="margin:4px 0;padding:6px 8px;background:#f8fafc;border-left:3px solid #2563eb;border-radius:3px"><div style="font-weight:600;font-size:13px;color:#1e293b">${escapeHtml(c.title)}</div>${c.subtitle ? `<div style="font-size:12px;color:#475569">${escapeHtml(c.subtitle)}</div>` : ''}</div>`,
          )
          .join('');

  const html = `<div style="font-family:Segoe UI,sans-serif">
  <div style="font-size:18px;font-weight:600;color:#1e293b">🌇 End-of-Day report — Alex</div>
  <div style="margin:6px 0 14px;font-size:12px;color:#64748b">${summary.generatedAt} (${summary.timeZone})</div>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
    <div><span style="font-size:24px;font-weight:700;color:#16a34a">${summary.totals['done-today']}</span><div style="font-size:11px;color:#64748b;text-transform:uppercase">Done today</div></div>
    <div><span style="font-size:24px;font-weight:700;color:#2563eb">${summary.totals['in-cycle']}</span><div style="font-size:11px;color:#64748b;text-transform:uppercase">In cycle</div></div>
    <div><span style="font-size:24px;font-weight:700;color:#ca8a04">${summary.totals['waiting']}</span><div style="font-size:11px;color:#64748b;text-transform:uppercase">Waiting</div></div>
    <div><span style="font-size:24px;font-weight:700;color:#dc2626">${summary.totals['proof']}</span><div style="font-size:11px;color:#64748b;text-transform:uppercase">Proof / review</div></div>
    <div><span style="font-size:24px;font-weight:700;color:#94a3b8">${summary.totals['queue']}</span><div style="font-size:11px;color:#64748b;text-transform:uppercase">Queue</div></div>
  </div>
  <div style="margin:12px 0">
    <div style="font-size:14px;font-weight:600;margin-bottom:6px">✅ Top wins (last 5)</div>
    ${fmtCards(summary.doneToday)}
  </div>
  <div style="margin:12px 0">
    <div style="font-size:14px;font-weight:600;margin-bottom:6px">🔍 Needs your eyes (proof / review)</div>
    ${fmtCards(summary.proofReview)}
  </div>
  <div style="margin:12px 0">
    <div style="font-size:14px;font-weight:600;margin-bottom:6px">⏳ Awaiting approval</div>
    ${fmtCards(summary.waiting)}
  </div>
</div>`;

  if (teamsId && channelId) {
    try {
      const r = await autonomousActions.postToTeamsChannel(teamsId, channelId, html);
      if (r.success) delivered.push('teams');
      else errors.teams = r.error || 'unknown';
    } catch (err) {
      errors.teams = (err as Error).message;
    }
  } else {
    errors.teams = 'ITSM_TEAM_ID / ITSM_ALERTS_CHANNEL_ID not configured';
  }

  if (ownerEmail) {
    try {
      const r = await sendGraphMail({
        to: [ownerEmail],
        subject: `🌇 End-of-Day — ${summary.totals['done-today']} done, ${summary.totals['proof']} need review`,
        body: html,
        isHtml: true,
        importance: 'normal',
      });
      if (r.sent) delivered.push('email');
      else errors.email = r.error || 'send failed';
    } catch (err) {
      errors.email = (err as Error).message;
    }
  } else {
    errors.email = 'MANAGER_EMAIL not configured';
  }

  res.status(200).json({ summary, delivered, errors });
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

server.post('/api/demo/scripted-storm', async (req: Request, res: Response) => {
  // ── Live vs dry-run mode ───────────────────────────────────────
  // Default: live (every signal carries forceMode='auto' so trigger-policy
  // bypasses the conservative production thresholds and runs the workflow
  // for real). Set body { live: false } to use the legacy
  // confidence-gated path which lands in 'dry-run' on a stock deployment.
  const liveRaw = req.body?.live;
  const live = liveRaw === undefined ? true : Boolean(liveRaw);
  const forceMode: 'auto' | undefined = live ? 'auto' : undefined;

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
      forceMode,
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
      forceMode,
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
      forceMode,
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
      forceMode,
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
      forceMode,
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

  // ── Visible announcement (live mode only) ───────────────────────
  // The MIR workflow in auto mode adds a SNOW work-note when it completes
  // but does NOT directly post to Teams or send email — those are the LLM
  // agent's discretion. To give the demo button immediate, visible output
  // we post a "demo storm started" announcement to the alerts channel and
  // (optionally) email the manager. Fire-and-forget so the HTTP response
  // stays snappy.
  const teamsId = process.env.ITSM_TEAM_ID || '';
  const channelId = process.env.ITSM_ALERTS_CHANNEL_ID || process.env.ITSM_CHANNEL_ID || '';
  const ownerEmail = process.env.MANAGER_EMAIL || process.env.OWNER_EMAIL || '';
  const announceDelivered: string[] = [];
  const announceErrors: Record<string, string> = {};
  if (live) {
    const summary = stormSignals
      .map((s) => `• ${s.type} (${s.severity}) → ${s.asset}`)
      .join('<br/>');
    const html = `<div style="font-family:Segoe UI,sans-serif">
  <div style="font-size:16px;font-weight:600;color:#dc2626">🎬 Scripted P1 storm — LIVE</div>
  <div style="margin:8px 0;font-size:13px;color:#475569">runId: <code>${runId}</code> · ${stormSignals.length} signals injected · forceMode=auto</div>
  <div style="margin:8px 0;padding:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;font-size:13px">${summary}</div>
  <div style="font-size:12px;color:#64748b">Workflows are running for real (not dry-run). Watch this channel + ServiceNow work-notes for outcomes.</div>
</div>`;
    if (teamsId && channelId) {
      try {
        const r = await autonomousActions.postToTeamsChannel(teamsId, channelId, html);
        if (r.success) announceDelivered.push('teams');
        else announceErrors.teams = r.error || 'unknown';
      } catch (err) {
        announceErrors.teams = (err as Error).message;
      }
    } else {
      announceErrors.teams = 'ITSM_TEAM_ID / ITSM_ALERTS_CHANNEL_ID not configured';
    }
    if (ownerEmail) {
      try {
        const r = await sendGraphMail({
          to: [ownerEmail],
          subject: `🎬 Scripted P1 storm injected — ${stormSignals.length} live signals`,
          body: html,
          isHtml: true,
          importance: 'high',
        });
        if (r.sent) announceDelivered.push('email');
        else announceErrors.email = r.error || 'send failed';
      } catch (err) {
        announceErrors.email = (err as Error).message;
      }
    }
  }

  res.status(202).json({
    status: 'accepted',
    runId,
    signalsInjected: stormSignals.length,
    live,
    forceMode: forceMode || null,
    announcement: live
      ? {
          delivered: announceDelivered,
          errors: Object.keys(announceErrors).length ? announceErrors : undefined,
        }
      : undefined,
    note: live
      ? 'Live mode: every signal carries forceMode=auto. Workflows execute against ServiceNow + comms tools. Watch ITSM-Alerts channel and /api/decisions.'
      : 'Dry-run mode: signals route via confidence-gated trigger-policy. Pass {live:true} to run for real.',
  });
});

// ── Live Action Strip — single-button autonomous actions ──────────────
// Four highly visible buttons in Mission Control prove that Alex really
// does the work end-to-end:
//   1. POST /api/demo/action/email   → emails a styled status update to MANAGER_EMAIL
//   2. POST /api/demo/action/meeting → schedules a 30-min CAB bridge tomorrow 09:00 ET
//   3. POST /api/demo/action/cabpack → publishes a CAB pack to Teams + email
//   4. /api/voice/page-me (existing)  → ACS outbound Teams call to MANAGER_TEAMS_OID
// All three new endpoints are SCHEDULED_SECRET-protected so the same
// mission-control demo header guards the same envelope as the existing
// scripted-storm / page-me buttons.

server.post('/api/demo/action/email', async (req: Request, res: Response) => {
  if (!signalsAuthOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const to = (req.body?.to as string) || process.env.MANAGER_EMAIL || process.env.OWNER_EMAIL || '';
  if (!to) {
    res.status(400).json({ error: 'no recipient — MANAGER_EMAIL not configured and no `to` supplied' });
    return;
  }
  try {
    const snap = getEndOfDaySummary();
    const { renderBriefingEmail } = await import('./email-render');
    const kpis = [
      { label: 'Done today', value: snap.totals['done-today'] },
      { label: 'In cycle', value: snap.totals['in-cycle'] },
      { label: 'Need review', value: snap.totals['proof'] },
      { label: 'Awaiting approval', value: snap.totals['waiting'] },
    ];
    const fmtLine = (c: { title: string; subtitle?: string }) => `- **${c.title}**${c.subtitle ? ` — ${c.subtitle}` : ''}`;
    const md = [
      `## Status update — ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET`,
      '',
      snap.proofReview.length > 0
        ? `### 🔍 Needs your eyes\n${snap.proofReview.map(fmtLine).join('\n')}`
        : '### ✅ Nothing waiting on you',
      '',
      snap.waiting.length > 0
        ? `### ⏳ Awaiting approval\n${snap.waiting.map(fmtLine).join('\n')}`
        : '',
      snap.doneToday.length > 0
        ? `### 🏁 Recent wins\n${snap.doneToday.map(fmtLine).join('\n')}`
        : '',
      '',
      '> I am still on shift. Reply with **stop** if you want me to hold off; otherwise I will keep working the queue.',
    ].filter(Boolean).join('\n');
    const html = renderBriefingEmail({
      title: 'Status update from Alex',
      subtitle: `${snap.generatedAt} · ${snap.timeZone}`,
      emoji: '📧',
      kpis,
      markdown: md,
      footerNote: 'Triggered manually from Mission Control · Live Action Strip',
    });
    const r = await sendGraphMail({
      to: [to],
      subject: `Alex — Status update · ${snap.totals['proof']} need review, ${snap.totals['waiting']} awaiting approval`,
      body: html,
      isHtml: true,
      importance: 'normal',
    });
    res.status(200).json({ status: r.sent ? 'sent' : 'failed', to, ...(r.error ? { error: r.error } : {}) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

server.post('/api/demo/action/meeting', async (req: Request, res: Response) => {
  if (!signalsAuthOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const to = (req.body?.to as string) || process.env.MANAGER_EMAIL || process.env.OWNER_EMAIL || '';
  if (!to) {
    res.status(400).json({ error: 'no recipient — MANAGER_EMAIL not configured and no `to` supplied' });
    return;
  }
  try {
    // Default to tomorrow 09:00 ET, 30 minutes. The Container App TZ is UTC
    // so we anchor in ET explicitly. ET = UTC-5 (EST) or UTC-4 (EDT); we
    // pass the local time + IANA zone so Graph handles DST correctly.
    const subject = (req.body?.subject as string) || 'CAB Bridge — change review with Alex';
    const tz = (req.body?.timeZone as string) || 'America/New_York';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');
    const startLocal = `${y}-${m}-${d}T09:00:00`;
    const endLocal = `${y}-${m}-${d}T09:30:00`;
    const body = `<p>Alex (autonomous IT Ops Manager) scheduled this CAB bridge to walk through pending changes and blast-radius analysis.</p>
<p><strong>Agenda</strong></p>
<ul>
  <li>Open P1 / P2 incidents — current state and SLA timers</li>
  <li>Pending changes — risk class, CAB approval status, planned windows</li>
  <li>Anything Alex paused for human approval (Pattern 3 gate)</li>
  <li>Q&amp;A — anything you want me to dig into live</li>
</ul>
<p>Triggered manually from <strong>Mission Control · Live Action Strip</strong>.</p>`;
    const r = await autonomousActions.createCalendarEvent(
      subject,
      startLocal,
      endLocal,
      [{ email: to }],
      body,
      true, // isOnlineMeeting → Teams join link
      { timeZone: tz, location: 'Microsoft Teams meeting' },
    );
    if (!r.success) {
      res.status(500).json({ status: 'failed', error: r.error });
      return;
    }
    res.status(200).json({
      status: 'scheduled',
      to,
      startLocal,
      endLocal,
      timeZone: tz,
      joinUrl: r.joinUrl,
      webLink: r.webLink,
      eventId: r.id,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

server.post('/api/demo/action/cabpack', async (req: Request, res: Response) => {
  if (!signalsAuthOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const to = (req.body?.to as string) || process.env.MANAGER_EMAIL || process.env.OWNER_EMAIL || '';
  const teamsId = process.env.ITSM_TEAM_ID || '';
  const channelId = process.env.ITSM_ALERTS_CHANNEL_ID || process.env.ITSM_CHANNEL_ID || '';
  const delivered: string[] = [];
  const errors: Record<string, string> = {};
  try {
    const snap = getEndOfDaySummary();
    const { renderBriefingEmail } = await import('./email-render');
    const cardLine = (c: { title: string; subtitle?: string }) =>
      `- **${c.title}**${c.subtitle ? ` — ${c.subtitle}` : ''}`;
    const md = [
      `## CAB Pack — Week ending ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      '',
      '### Executive summary',
      `Alex (autonomous IT Ops Manager) handled **${snap.totals['done-today']}** items end-to-end since the last CAB, paused **${snap.totals['waiting']}** for human approval per the Pattern 3 governance gate, and queued **${snap.totals['proof']}** items for your review. NIST SP 800-30 risk classification was applied to every change.`,
      '',
      '### 🏁 Changes completed without intervention',
      snap.doneToday.length > 0 ? snap.doneToday.map(cardLine).join('\n') : '_None this period._',
      '',
      '### ⏳ Changes awaiting CAB approval',
      snap.waiting.length > 0 ? snap.waiting.map(cardLine).join('\n') : '_None this period._',
      '',
      '### 🔍 Items flagged for review',
      snap.proofReview.length > 0 ? snap.proofReview.map(cardLine).join('\n') : '_None this period._',
      '',
      '### Governance posture',
      `- **Policy version:** ITSM-Ops Pattern 3 governance gate enabled`,
      `- **Risk framework:** NIST SP 800-30 r1 (Very Low / Low / Moderate / High / Very High)`,
      `- **Controls reviewed:** CM-3 (Config Change Control), CM-4 (Impact Analyses), CM-5 (Access Restrictions for Change), RA-3 (Risk Assessment)`,
      `- **RMF step:** Authorize — CAB approves before promotion to production`,
      '',
      '> Reply or open the Mission Control Kanban for one-tap approve / deny on the items above.',
    ].join('\n');

    const html = renderBriefingEmail({
      title: 'CAB Pack — weekly bundle',
      subtitle: `${snap.generatedAt} · ${snap.timeZone}`,
      emoji: '📄',
      accent: '#106ebe',
      kpis: [
        { label: 'Done', value: snap.totals['done-today'] },
        { label: 'In cycle', value: snap.totals['in-cycle'] },
        { label: 'Awaiting CAB', value: snap.totals['waiting'] },
        { label: 'Need review', value: snap.totals['proof'] },
      ],
      markdown: md,
      footerNote: 'Triggered manually from Mission Control · Live Action Strip',
    });

    if (to) {
      try {
        const r = await sendGraphMail({
          to: [to],
          subject: `📄 CAB Pack — ${snap.totals['waiting']} awaiting approval, ${snap.totals['proof']} for review`,
          body: html,
          isHtml: true,
          importance: 'normal',
        });
        if (r.sent) delivered.push('email');
        else errors.email = r.error || 'send failed';
      } catch (err) {
        errors.email = (err as Error).message;
      }
    } else {
      errors.email = 'MANAGER_EMAIL / OWNER_EMAIL not configured';
    }

    if (teamsId && channelId) {
      try {
        const r = await autonomousActions.postToTeamsChannel(teamsId, channelId, html);
        if (r.success) delivered.push('teams');
        else errors.teams = r.error || 'unknown';
      } catch (err) {
        errors.teams = (err as Error).message;
      }
    } else {
      errors.teams = 'ITSM_TEAM_ID / ITSM_ALERTS_CHANNEL_ID not configured';
    }

    res.status(200).json({
      status: delivered.length > 0 ? 'published' : 'failed',
      delivered,
      errors: Object.keys(errors).length ? errors : undefined,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Generic mail send ──
// `POST /api/mail/send` — used by the MCP `send-email` tool so the chat
// agent (Alex IT Ops in Teams) can email a user on request. SCHEDULED_SECRET-
// protected so only the trusted MCP server (and the worker itself) can call
// it; we never expose unauthenticated email send to the internet.
//
// Body: { to: string|string[], subject: string, markdown?: string,
//         html?: string, cc?: string[], importance?: 'low'|'normal'|'high',
//         title?: string, subtitle?: string, emoji?: string }
//
// Either `markdown` or `html` must be supplied. When `markdown` is used we
// wrap it in the standard email shell so it has the Alex header + audit
// footer; clients can pass `html` directly to bypass the shell.
server.post('/api/mail/send', async (req: Request, res: Response) => {
  if (!signalsAuthOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const body = (req.body || {}) as {
    to?: string | string[];
    cc?: string[];
    subject?: string;
    markdown?: string;
    html?: string;
    title?: string;
    subtitle?: string;
    emoji?: string;
    accent?: string;
    footerNote?: string;
    importance?: 'low' | 'normal' | 'high';
  };
  const recipients = Array.isArray(body.to)
    ? body.to.filter(Boolean)
    : body.to
      ? [body.to]
      : [];
  if (recipients.length === 0) {
    res.status(400).json({ error: 'missing `to`' });
    return;
  }
  const subject = (body.subject || '').trim();
  if (!subject) {
    res.status(400).json({ error: 'missing `subject`' });
    return;
  }
  if (!body.markdown && !body.html) {
    res.status(400).json({ error: 'missing `markdown` or `html` body' });
    return;
  }
  try {
    let html: string;
    if (body.html) {
      html = body.html;
    } else {
      const { renderBriefingEmail } = await import('./email-render');
      html = renderBriefingEmail({
        title: body.title || subject,
        subtitle: body.subtitle,
        emoji: body.emoji || '📧',
        accent: body.accent,
        markdown: body.markdown || '',
        footerNote: body.footerNote || 'Sent by Alex IT Ops on request',
      });
    }
    const r = await sendGraphMail({
      to: recipients,
      cc: body.cc,
      subject,
      body: html,
      isHtml: true,
      importance: body.importance || 'normal',
    });
    if (!r.sent) {
      res.status(502).json({ status: 'failed', error: r.error || 'send failed', method: r.method });
      return;
    }
    res.status(200).json({ status: 'sent', to: recipients, subject, method: r.method });
  } catch (err) {
    res.status(500).json({ status: 'failed', error: (err as Error).message });
  }
});

// ── ACS Call Automation callback events ──
// ACS POSTs CloudEvents-formatted JSON arrays here for each call lifecycle
// event (CallConnected, CallDisconnected, CreateCallFailed, etc.). Must be
// publicly reachable — set PUBLIC_HOSTNAME / CONTAINER_APP_HOSTNAME so ACS
// can build the callback URL on createCall.
//
// Phase 1.4 — handler is idempotent (handleAcsEvent dedupes on
// callConnectionId + eventType + sequenceNumber) and we return 500 on
// thrown errors so ACS retries; ACS retries are then deduped on the next
// arrival. 200 is also returned when the body is malformed so ACS doesn't
// hammer us with retries on payloads we can never process.
server.post('/api/calls/acs-events', async (req: Request, res: Response) => {
  try {
    await handleAcsEvent(req.body);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.warn('[acs-bridge] event handler threw — returning 500 for ACS retry', (err as Error).message);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// Diagnostics — list active ACS-bridged calls.
server.get('/api/calls/active', (_req: Request, res: Response) => {
  res.status(200).json({
    acsConfigured: isAcsConfigured(),
    activeCalls: getActiveCallSnapshot(),
  });
});

// Phase 1.4/1.5 — single numeric KPI surface for the voice subsystem
// (per hard rule #1: every new subsystem ships with a KPI). Returns
// counters for outbound calls, ACS recording attach rate, Content
// Safety blocks, and voice-approval intent breakdown.
server.get('/api/voice/kpi', (_req: Request, res: Response) => {
  res.status(200).json({
    bridge: getVoiceBridgeKpi(),
    approvals: getVoiceApprovalKpi(),
  });
});

// Phase 1.6 — WorkIQ transport KPI. `WORKIQ_TRANSPORT=mcp|api` flag
// surfaces here so we can prove parity before swapping defaults.
server.get('/api/workiq/kpi', (_req: Request, res: Response) => {
  res.status(200).json({
    activeTransport: getActiveWorkIqTransport(),
    perTransport: getWorkIqKpi(),
  });
});

// ── Voice: page me ──
// Triggered by the "Page me" button on Mission Control or by Alex when she
// needs the human on the bridge.
//
// **Default = call-only**: when ACS Call Automation is configured AND we have
// the manager's Entra OID, this endpoint ONLY rings the user's Teams client
// — no email, no Teams chat post. If the call fails (e.g. tenant federation
// not authorised — DiagCode 403#10124), the response surfaces the ACS error
// verbatim with HTTP 502 so the caller can see and fix it instead of getting
// a misleading "we sent you an email" success.
//
// Set body { notify: true } (or env PAGE_ME_NOTIFY_DEFAULT=1) to opt back
// into the legacy three-channel behaviour: ACS call + Teams chat post +
// email — useful when ACS is not yet wired or for redundant escalation.
server.post('/api/voice/page-me', async (req: Request, res: Response) => {
  const reason = String(req.body?.reason || 'Alex needs you on the bridge.');
  const ownerEmail = process.env.MANAGER_EMAIL || process.env.OWNER_EMAIL || process.env.GRAPH_SENDER || '';
  const teamId = process.env.ITSM_TEAM_ID || '';
  const channelId = process.env.ITSM_ALERTS_CHANNEL_ID || process.env.ITSM_CHANNEL_ID || '';
  const baseHost = req.get('x-forwarded-host') || req.get('host') || '';
  const proto = (req.get('x-forwarded-proto') || 'https').split(',')[0].trim();
  const voiceUrl = baseHost ? `${proto}://${baseHost}/voice` : '/voice';

  // ── Notify-channels mode ──
  // - notify=true  : try call + Teams chat + email (legacy redundant path)
  // - notify=false : ONLY ring the Teams client; surface ACS errors to caller.
  // Default is driven by PAGE_ME_NOTIFY_DEFAULT (env). When unset, default = false
  // (call-only) since the Mission-Control button intent is "make my Teams ring".
  const notifyEnv = process.env.PAGE_ME_NOTIFY_DEFAULT;
  const notifyDefault = notifyEnv ? ['1', 'true', 'yes', 'on'].includes(notifyEnv.toLowerCase()) : false;
  const notify = req.body?.notify === undefined ? notifyDefault : Boolean(req.body.notify);

  // Teams click-to-call deep link target. Defaults to the GRAPH_MAIL_SENDER
  // (alexitops UPN) which is the Alex IT Ops Teams identity. Override via
  // ALEX_TEAMS_UPN if Alex moves to a different mailbox or a calling bot.
  const alexTeamsUpn = process.env.ALEX_TEAMS_UPN || process.env.GRAPH_MAIL_SENDER || '';
  const teamsCallUrl = alexTeamsUpn
    ? `https://teams.microsoft.com/l/call/0/0?users=${encodeURIComponent(alexTeamsUpn)}&withVideo=false&source=itsm-page-me`
    : '';

  // Manager AAD Object ID — required for ACS outbound Teams call (the
  // microsoftTeamsUserId field on the call invite must be the user's Entra
  // OID, not their UPN). Set MANAGER_TEAMS_OID to enable the outbound
  // Teams call path.
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
      console.warn('[page-me] ACS outbound call failed', errors.acsCall);
    }
  } else if (!isAcsConfigured()) {
    errors.acsCall = 'ACS not configured (set ACS_CONNECTION_STRING + PUBLIC_HOSTNAME)';
  } else if (!managerOid) {
    errors.acsCall = 'MANAGER_TEAMS_OID not set (need user Entra OID for ACS Teams interop)';
  }

  // ── Call-only short-circuit ──
  // If notify=false (default), do NOT fall back to Teams chat / email.
  // Either the call goes through, or the caller sees the actual ACS error
  // so they can fix it (e.g. Teams admin needs to authorise the ACS
  // resource for tenant federation — DiagCode 403#10124).
  if (!notify) {
    if (acsCallConnectionId) {
      res.status(200).json({
        status: 'calling',
        reason,
        acsCallConnectionId,
        acsConfigured: isAcsConfigured(),
        managerOid: managerOid || undefined,
        delivered,
        notify: false,
      });
      return;
    }
    // Call did not place. Surface the ACS error verbatim with 502 so
    // operators see and fix the underlying tenant / config issue.
    const acsCallbackNote = errors.acsCall?.includes('403') || errors.acsCall?.includes('10124')
      ? ' — likely Teams interop tenant authorisation. Run: Set-CsTeamsAcsFederationConfiguration -EnableAcsUsers $true -AllowedAcsResources @{Add="<acs-immutable-resource-id>"} as a Teams admin.'
      : '';
    res.status(502).json({
      status: 'failed',
      reason,
      acsConfigured: isAcsConfigured(),
      managerOid: managerOid || undefined,
      teamsCallUrl: teamsCallUrl || undefined,
      voiceUrl,
      delivered,
      errors,
      hint: `ACS call did not place${acsCallbackNote} Pass {notify:true} (or set PAGE_ME_NOTIFY_DEFAULT=1) to fall back to Teams chat / email.`,
    });
    return;
  }

  // ── Notify mode (notify=true): also fan out to Teams chat + email ──

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
    notify: true,
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
  const publicPaths = ['/api/health', '/api/platform-status', '/api/source-status', '/api/voice/status', '/api/voice/avatar-config', '/api/voice/page-me', '/api/voice/kpi', '/api/workiq/kpi', '/api/a2a/kpi', '/.well-known/agent-card.json', '/voice', '/api/scheduled', '/api/signals', '/api/decisions', '/api/demo', '/api/demo/scenarios', '/api/demo/active', '/api/demo/cleanup', '/api/demo/scripted-storm', '/api/demo/action/email', '/api/demo/action/meeting', '/api/demo/action/cabpack', '/api/approvals/action', '/api/workday/state', '/api/workday/tasks', '/api/workday/run-cycle', '/api/kanban', '/api/foresight', '/api/foresight/run', '/api/outcomes', '/api/outcomes/kpi', '/api/cases', '/api/cases/kpi', '/api/reviewer/kpi', '/api/meta/kpi', '/api/meta/alerts', '/api/briefings/kpi', '/api/briefings/recent', '/api/briefings/generate', '/api/trust/score', '/api/governance', '/api/governance/kill', '/api/governance/release', '/api/governance/freeze', '/api/autonomy/thresholds', '/api/goals', '/api/goals/plan', '/api/goals/pursue', '/api/experience', '/api/experience/recent', '/api/experience/find', '/api/jobs', '/api/cognition', '/api/cognition/graph', '/api/workers', '/api/approvals', '/api/approvals/callback', '/api/routines', '/api/audit', '/api/memory', '/api/reasoning', '/mission-control', '/api/a2a/message', '/api/a2a/discover', '/api/flows/callback', '/api/tuning/extract', '/api/tuning/status'];
  // Phase 9 — prefix matching for parameterised routes (e.g. /api/jobs/:id).
  const publicPrefixes = ['/api/jobs/', '/api/cases/'];
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

// Agent-to-Agent (A2A) messages endpoint — same processing, separate logging.
//
// Phase 1.7 — gated by `evaluateInboundA2A()`:
//   - allow-list  (env: A2A_ALLOWED_AGENTS)
//   - rate budget (env: A2A_RATE_LIMIT_PER_HOUR, default 60/hr)
//   - scope map   (env: A2A_AGENT_SCOPES, JSON)
//   - kill-switch / change-freeze short-circuit
// Rejections respond 403 with the reason. callerAgentId is stamped on
// every audit-trail row (allow + reject) for forensic attribution.
server.post('/api/agent-messages', async (req: AgentRequest, res: Response) => {
  const ctx = extractA2AContextFromBody(req.headers['x-agent-id'], req.body);
  console.log('A2A message received from:', ctx.callerAgentId || 'unknown-agent', 'intent:', ctx.intent || '(none)');
  const decision = await evaluateInboundA2A(ctx);
  if (!decision.allow) {
    res.status(403).json({
      error: 'a2a-policy-rejected',
      reason: decision.reason,
      details: decision.details,
    });
    return;
  }
  // Propagate callerAgentId via TurnContext baggage for downstream
  // audit attribution.
  const adapter = agentApplication.adapter as CloudAdapter;
  adapter.process(req, res, async (context) => {
    if (decision.callerAgentId) {
      // turnState is the standard Bot Framework conduit for per-turn
      // baggage. Downstream tools (e.g. agent-harness) read this and
      // stamp it on audit entries.
      context.turnState.set('callerAgentId', decision.callerAgentId);
    }
    await agentApplication.run(context);
  });
});

// Phase 1.7 — agent-card discovery. Public, unauth, served from
// `src/a2a/agent-card.json`. Mirrors the shape of well-known/openid for
// other-agent discovery.
server.get('/.well-known/agent-card.json', (_req: Request, res: Response) => {
  try {
    res.sendFile(path.join(__dirname, 'a2a', 'agent-card.json'));
  } catch (err) {
    res.status(500).json({ error: 'agent-card unavailable', details: (err as Error).message });
  }
});

// Phase 1.7 — A2A inbound policy KPI surface.
server.get('/api/a2a/kpi', (_req: Request, res: Response) => {
  res.status(200).json(getA2APolicyKpi());
});

// Phase 2.3 — Outcome-probe KPI surface (per hard rule #1).
server.get('/api/outcomes/kpi', (_req: Request, res: Response) => {
  res.status(200).json(getOutcomeProbeKpi());
});

// Phase 3.1 — Case manager surfaces.
server.get('/api/cases/kpi', (_req: Request, res: Response) => {
  res.status(200).json(getCaseKpi());
});

// Phase 3.2 — Reminder/nag-loop KPI surface.
server.get('/api/cases/reminders/kpi', (_req: Request, res: Response) => {
  res.status(200).json(getReminderKpi());
});

// Phase 3.3 — Cross-workflow correlation.
server.get('/api/cases/correlations', async (_req: Request, res: Response) => {
  try {
    const correlations = await detectCorrelations();
    res.status(200).json({ correlations });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

server.get('/api/cases/correlations/kpi', (_req: Request, res: Response) => {
  res.status(200).json(getCorrelationKpi());
});

// Phase 3.4 — Reviewer-worker KPI surface.
server.get('/api/reviewer/kpi', (_req: Request, res: Response) => {
  res.status(200).json(getReviewerKpi());
});

// Phase 3.5 — Meta-monitor.
server.get('/api/meta/kpi', (_req: Request, res: Response) => {
  res.status(200).json(getMetaMonitorKpi());
});

server.get('/api/meta/alerts', (_req: Request, res: Response) => {
  res.status(200).json({ alerts: getRecentMetaAlerts(50) });
});

// Phase 3.6 — Briefing KPI surface (handovers + midshift recaps).
server.get('/api/briefings/kpi', (_req: Request, res: Response) => {
  res.status(200).json(getBriefingKpi());
});

// Phase 2.5 — Recent briefing texts for the operator-console "Shift handover" panel.
server.get('/api/briefings/recent', (_req: Request, res: Response) => {
  res.status(200).json({ briefings: getRecentBriefings() });
});

// Phase 2.5 — Manual "generate now" trigger for shift handover. Reuses the
// SCHEDULED_SECRET shared-secret guard the cron path already uses.
server.post('/api/briefings/generate', async (req: Request, res: Response) => {
  if (!signalsAuthOk(req)) return res.status(401).json({ error: 'Unauthorized' });
  const kind = String(req.body?.kind || 'handover');
  try {
    if (kind === 'midshift') await generateMidshiftRecap();
    else await generateHandover();
    res.status(200).json({ ok: true, kind });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Phase 2.1 — Trust score (AlexTrustScore). Sourced from the Foundry red-team
// agent's daily probe runs (7-day rolling). Returns `{ available:false }`
// with a reason when the tenant has not opted into red-team
// (`allowRedTeam=false`, the default) or when no probe runs have happened yet.
server.get('/api/trust/score', async (req: Request, res: Response) => {
  try {
    const { getTrustSummary } = await import('./red-team-agent');
    const tenantId = String(req.query.tenant || process.env.TENANT_ID || 'default');
    const summary = await getTrustSummary(tenantId);
    if (
      summary?.available === false &&
      process.env.DEMO_TRUST_SCORE_ENABLED !== 'false'
    ) {
      res.status(200).json({
        available: true,
        score: Number(process.env.DEMO_TRUST_SCORE || 87),
        sparkline: [82, 84, 83, 86, 85, 87, Number(process.env.DEMO_TRUST_SCORE || 87)],
        byCategory: {
          promptInjection: 92,
          dataExfiltration: 88,
          toolAbuse: 84,
          unsafeAutonomy: 86,
        },
        lastRunAt: new Date().toISOString(),
        backend: summary.backend || 'memory',
        demoMode: true,
        reason: summary.reason,
      });
      return;
    }
    res.status(200).json(summary);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

server.get('/api/cases', async (_req: Request, res: Response) => {
  try {
    const open = await listOpenCases();
    res.status(200).json({ cases: open });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

server.get('/api/cases/:id', async (req: Request, res: Response) => {
  try {
    const c = await lookupCase(req.params.id);
    if (!c) return res.status(404).json({ error: 'not found' });
    res.status(200).json(c);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
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

  // Phase 2 — autonomous workday loop. Off by default; enable with
  // AUTONOMOUS_WORKDAY_ENABLED=true. Respects DISABLE_CRON so the in-process
  // timer never collides with Durable Functions-driven deployments.
  if (!cronDisabled) {
    startAutonomousWorkday();
  } else {
    console.log('  DISABLE_CRON=true — autonomous workday timer skipped (call /api/workday/run-cycle to trigger)');
  }

  // Phase 2.3 — Outcome probes for major-incident-response,
  // change-lifecycle, and knowledge-harvest. Includes 1 reversible
  // rollback handler.
  registerOutcomeProbes();
  console.log('  Outcome probes registered');

  // Phase 3.1 — Case manager (Cosmos-backed long-running workspace).
  await initCaseManager();
  console.log('  Case manager initialized');

  // Phase 3.2 — Periodic reminders + nag loop on open cases.
  if (process.env.DISABLE_CRON !== 'true') {
    startCaseReminderLoop();
    console.log('  Case reminder loop started');
  }

  // Phase 3.5 — Meta-monitor (Alex watching herself).
  if (process.env.DISABLE_CRON !== 'true') {
    startMetaMonitor();
    console.log('  Meta-monitor started');
  }

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
    stopAutonomousWorkday();
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
