// ITSM Operations Digital Worker — ACS Call Automation <-> Foundry Realtime audio bridge
//
// Lets Alex place a real outbound voice call to a Microsoft Teams user (by
// AAD object id) and have a real-time conversation — the "page me" briefing
// UX, no browser tab, no Teams deep-link click required.
//
// Flow:
//   1. /api/voice/page-me POSTs -> initiateOutboundTeamsCall(aadOid)
//   2. ACS rings the user's Teams client (Teams Calls app pops a call card)
//   3. User answers; ACS POSTs CallConnected to /api/calls/acs-events
//   4. Bidirectional media streaming -> WebSocket lands on
//      /api/calls/acs-media  (PCM16 mono 24kHz)
//   5. Each ACS audio frame is forwarded upstream to the Azure OpenAI
//      Realtime WS as input_audio_buffer.append
//   6. response.audio.delta from Foundry -> pushed back to ACS as AudioData
//      envelopes — the user hears Alex speak in their Teams call.
//
// Sample rates aligned at 24 kHz on both sides. No resampling.
//
// Phase 1.4 hardening:
//   - ACS source identity persisted to Key Vault (replaces lazy in-memory cache)
//   - Realtime transcript stream is run through Content Safety analyzeOutput()
//     with fail-closed semantics — a flagged output ends the call immediately
//     and writes a verdict to the audit trail.
//   - ACS call recording + transcription is started on CallConnected and
//     attached to the originating SNOW worknote on CallDisconnected.
//   - /api/calls/acs-events handler is idempotent + retry-safe, keyed on
//     callConnectionId + eventType + sequenceNumber.
//
// Auth:
//   - ACS Call Automation: connection string from env (ACS_CONNECTION_STRING)
//   - Foundry Realtime: AAD bearer via DefaultAzureCredential (system MI)

import {
  CallAutomationClient,
  type CallInvite,
  type CreateCallOptions,
  type MediaStreamingOptions,
  type CallLocator,
} from '@azure/communication-call-automation';
import { CommunicationIdentityClient } from '@azure/communication-identity';
import type { CommunicationUserIdentifier } from '@azure/communication-common';
import WebSocket, { WebSocketServer } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'http';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { analyzeOutput } from '../content-safety';
import { trackSafetyBlock } from '../log-analytics';
import { logAuditEntry } from '../audit-trail';
import { addWorkNote, getSnowClientStatus } from '../snow-client';
import { processVoiceApproval } from './voiceApprovals';
import {
  connectVoiceLive,
  getSelectedTransport,
  type VoiceLiveConnection,
} from './voiceLiveTransport';

const ACS_CONNECTION_STRING = process.env.ACS_CONNECTION_STRING || '';
// ACS source user id — bootstrapped from env (back-compat) but the canonical
// store is Key Vault secret 'acs-source-user-id'. ensureSourceIdentity()
// loads from KV first, then env, and lazily provisions if both are missing,
// writing the new id back to KV for next restart.
const ACS_SOURCE_USER_ID_ENV = process.env.ACS_SOURCE_USER_ID || '';
const ACS_SOURCE_USER_ID_SECRET = 'acs-source-user-id';
let ACS_SOURCE_USER_ID = ACS_SOURCE_USER_ID_ENV;
let sourceIdentityLoaded = false;

// Public hostname the ACS service can reach. ACA exposes WEBSITE_HOSTNAME or
// CONTAINER_APP_HOSTNAME.
const PUBLIC_HOSTNAME =
  process.env.PUBLIC_HOSTNAME ||
  process.env.CONTAINER_APP_HOSTNAME ||
  process.env.WEBSITE_HOSTNAME ||
  '';

// Foundry / Voice Live Realtime endpoint. Same env vars the existing
// voiceProxy.ts uses so we don't fork the model deployment.
const VOICELIVE_ENDPOINT = process.env.VOICELIVE_ENDPOINT || '';
const VOICELIVE_MODEL = process.env.VOICELIVE_MODEL || 'gpt-realtime';

// Use the preview API + session shape known to work end-to-end with ACS
// bidirectional media streaming. The ITSMOperations browser /voice path uses
// the GA shape; we keep them on different paths.
const REALTIME_API_VERSION = '2025-04-01-preview';

// Phase 1.4 — call recording is enabled by default when ACS is configured.
// Operators can opt-out by setting ACS_CALL_RECORDING=0.
const RECORDING_ENABLED = process.env.ACS_CALL_RECORDING !== '0';

const credential = new DefaultAzureCredential();

let acsClient: CallAutomationClient | null = null;
let kvClient: SecretClient | null = null;

function isAcsLogEnabled(): boolean {
  return Boolean(ACS_CONNECTION_STRING);
}

function log(level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>): void {
  const line = `[acs-bridge] ${msg}`;
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  if (level === 'error') console.error(line + payload);
  else if (level === 'warn') console.warn(line + payload);
  else console.log(line + payload);
}

function getKeyVaultClient(): SecretClient | null {
  if (kvClient) return kvClient;
  const vaultName = process.env.KEY_VAULT_NAME;
  if (!vaultName) return null;
  try {
    kvClient = new SecretClient(`https://${vaultName}.vault.azure.net`, credential);
    return kvClient;
  } catch (err) {
    log('warn', 'Key Vault client init failed', { error: (err as Error).message });
    return null;
  }
}

/**
 * Lazily provision (or reuse) an ACS user identity that we use as the source
 * for outbound calls. ACS Call Automation -> Teams interop requires a valid
 * `sourceIdentity` (CommunicationUserIdentifier); without one, Teams
 * flight-proxy returns 403#10391 (Forbidden) on createCall.
 *
 * Lookup order:
 *   1. Key Vault secret 'acs-source-user-id'
 *   2. Env var ACS_SOURCE_USER_ID (back-compat for existing deployments)
 *   3. Lazily provision a new user id; write it to Key Vault if available.
 */
async function ensureSourceIdentity(): Promise<CommunicationUserIdentifier> {
  if (sourceIdentityLoaded && ACS_SOURCE_USER_ID) {
    return { communicationUserId: ACS_SOURCE_USER_ID };
  }

  // 1. Key Vault first (canonical store).
  const kv = getKeyVaultClient();
  if (kv && !ACS_SOURCE_USER_ID) {
    try {
      const secret = await kv.getSecret(ACS_SOURCE_USER_ID_SECRET);
      if (secret.value) {
        ACS_SOURCE_USER_ID = secret.value;
        sourceIdentityLoaded = true;
        log('info', 'ACS source identity loaded from Key Vault', {
          communicationUserId: ACS_SOURCE_USER_ID,
        });
        return { communicationUserId: ACS_SOURCE_USER_ID };
      }
    } catch (err: any) {
      // 404 is expected on first run — fall through to provisioning.
      if (err?.statusCode !== 404 && err?.code !== 'SecretNotFound') {
        log('warn', 'Key Vault read failed for acs-source-user-id', {
          error: err?.message || String(err),
        });
      }
    }
  }

  // 2. Env (back-compat).
  if (ACS_SOURCE_USER_ID) {
    sourceIdentityLoaded = true;
    log('info', 'ACS source identity loaded from env (legacy)', {
      communicationUserId: ACS_SOURCE_USER_ID,
      note: 'Move this value to Key Vault secret acs-source-user-id and remove the app setting.',
    });
    // Best-effort: write it to KV so next deployment can drop the env var.
    if (kv) {
      try {
        await kv.setSecret(ACS_SOURCE_USER_ID_SECRET, ACS_SOURCE_USER_ID);
        log('info', 'ACS source identity written to Key Vault', {
          secret: ACS_SOURCE_USER_ID_SECRET,
        });
      } catch (err) {
        log('warn', 'Key Vault write failed — keeping env value', {
          error: (err as Error).message,
        });
      }
    }
    return { communicationUserId: ACS_SOURCE_USER_ID };
  }

  // 3. Lazily provision and persist.
  const idClient = new CommunicationIdentityClient(ACS_CONNECTION_STRING);
  const user = await idClient.createUser();
  ACS_SOURCE_USER_ID = user.communicationUserId;
  sourceIdentityLoaded = true;
  log('info', 'ACS source identity provisioned', {
    communicationUserId: ACS_SOURCE_USER_ID,
  });
  if (kv) {
    try {
      await kv.setSecret(ACS_SOURCE_USER_ID_SECRET, ACS_SOURCE_USER_ID);
      log('info', 'ACS source identity persisted to Key Vault', {
        secret: ACS_SOURCE_USER_ID_SECRET,
      });
    } catch (err) {
      log('warn', 'Key Vault write failed — id is in-memory only this session', {
        error: (err as Error).message,
      });
    }
  } else {
    log('warn', 'KEY_VAULT_NAME not set — ACS source identity is in-memory only', {
      hint: 'Set KEY_VAULT_NAME and grant the worker MI Key Vault Secrets Officer.',
    });
  }
  return user;
}

async function getAcsClient(): Promise<CallAutomationClient> {
  if (acsClient) return acsClient;
  if (!ACS_CONNECTION_STRING) {
    throw new Error('ACS_CONNECTION_STRING app setting not configured');
  }
  const sourceIdentity = await ensureSourceIdentity();
  acsClient = new CallAutomationClient(ACS_CONNECTION_STRING, { sourceIdentity });
  return acsClient;
}

// Per-call state shared between the events webhook and the media WebSocket.
interface CallState {
  callConnectionId: string;
  targetTeamsOid: string;
  requestedBy?: string;
  instructions: string;
  voice: string;
  startedAt: number;
  // Phase 1.4 — recording + transcript state.
  recordingId?: string;
  recordingUrl?: string;
  transcript: string[];
  // Originating SNOW record (incident sys_id, table) for worknote attachment.
  snowTable?: 'incident' | 'change_request' | 'problem';
  snowSysId?: string;
  correlationId?: string;
  reasoningTraceId?: string;
  // Set when Content Safety blocks output. The bridge tears down the call.
  blockedReason?: string;
}
const activeCalls = new Map<string, CallState>();

// Idempotency cache for /api/calls/acs-events. Key:
//   `${callConnectionId}::${eventType}::${sequenceNumber}`
// TTL: 1h. Bounded size: 5_000 entries. Used by handleAcsEvent() to drop
// retries from ACS without double-processing them.
const ACS_EVENT_TTL_MS = 60 * 60 * 1000;
const ACS_EVENT_MAX_KEYS = 5_000;
const acsEventSeen = new Map<string, number>();
function markEventSeen(key: string): boolean {
  const now = Date.now();
  // Expire stale entries lazily.
  if (acsEventSeen.size > ACS_EVENT_MAX_KEYS) {
    for (const [k, ts] of acsEventSeen) {
      if (now - ts > ACS_EVENT_TTL_MS) acsEventSeen.delete(k);
      if (acsEventSeen.size <= ACS_EVENT_MAX_KEYS) break;
    }
  }
  if (acsEventSeen.has(key)) return false;
  acsEventSeen.set(key, now);
  return true;
}

// ── KPI counters (Phase 1.4 — single numeric surface per hard rule #1) ──
//
// Counts since process start. Surfaced via getVoiceBridgeKpi() and the
// /api/voice/kpi endpoint for the mission-control voice tile.
//
// Phase A — turn-latency rolling window for the active transport. Median +
// p95 in ms, computed from the most recent N final-transcript intervals
// (user audio committed → first agent audio frame). Captured in both the
// realtime and voicelive paths so the demo PR can publish the comparison.
const LATENCY_WINDOW_SIZE = 64;
const bridgeKpi = {
  callsInitiated: 0,
  callsConnected: 0,
  recordingsStarted: 0,
  recordingsAttachedToSnow: 0,
  contentSafetyChecks: 0,
  contentSafetyBlocks: 0,
  startedAt: Date.now(),
  // Phase A — turn-latency samples per transport (ring buffer).
  turnLatencyMsRealtime: [] as number[],
  turnLatencyMsVoiceLive: [] as number[],
};

function recordTurnLatency(transport: 'realtime' | 'voicelive', ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return;
  const arr =
    transport === 'voicelive'
      ? bridgeKpi.turnLatencyMsVoiceLive
      : bridgeKpi.turnLatencyMsRealtime;
  arr.push(ms);
  if (arr.length > LATENCY_WINDOW_SIZE) arr.shift();
}

function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

function median(samples: readonly number[]): number {
  return percentile(samples, 50);
}

export function getVoiceBridgeKpi(): {
  callsInitiated: number;
  callsConnected: number;
  recordingsStarted: number;
  recordingsAttachedToSnow: number;
  recordingAttachRate: number;
  contentSafetyChecks: number;
  contentSafetyBlocks: number;
  contentSafetyBlockRate: number;
  uptimeSec: number;
  // Phase A — turn-latency comparison (median + p95 ms) per transport.
  transport: 'realtime' | 'voicelive';
  turnLatencyRealtime: { samples: number; medianMs: number; p95Ms: number };
  turnLatencyVoiceLive: { samples: number; medianMs: number; p95Ms: number };
} {
  const recordingAttachRate =
    bridgeKpi.callsConnected > 0
      ? bridgeKpi.recordingsAttachedToSnow / bridgeKpi.callsConnected
      : 0;
  const contentSafetyBlockRate =
    bridgeKpi.contentSafetyChecks > 0
      ? bridgeKpi.contentSafetyBlocks / bridgeKpi.contentSafetyChecks
      : 0;
  return {
    callsInitiated: bridgeKpi.callsInitiated,
    callsConnected: bridgeKpi.callsConnected,
    recordingsStarted: bridgeKpi.recordingsStarted,
    recordingsAttachedToSnow: bridgeKpi.recordingsAttachedToSnow,
    recordingAttachRate,
    contentSafetyChecks: bridgeKpi.contentSafetyChecks,
    contentSafetyBlocks: bridgeKpi.contentSafetyBlocks,
    contentSafetyBlockRate,
    uptimeSec: Math.round((Date.now() - bridgeKpi.startedAt) / 1000),
    transport: getSelectedTransport(),
    turnLatencyRealtime: {
      samples: bridgeKpi.turnLatencyMsRealtime.length,
      medianMs: median(bridgeKpi.turnLatencyMsRealtime),
      p95Ms: percentile(bridgeKpi.turnLatencyMsRealtime, 95),
    },
    turnLatencyVoiceLive: {
      samples: bridgeKpi.turnLatencyMsVoiceLive.length,
      medianMs: median(bridgeKpi.turnLatencyMsVoiceLive),
      p95Ms: percentile(bridgeKpi.turnLatencyMsVoiceLive, 95),
    },
  };
}

// ── Internal hooks for unit tests only ─────────────────────────────────────
// Phase A — exposes the latency-statistics primitives so we can unit-test
// the median / p95 KPI surface in isolation without spinning up an ACS call.
/** @internal */
export const __test = {
  recordTurnLatency,
  percentile,
  median,
  resetLatency: () => {
    bridgeKpi.turnLatencyMsRealtime.length = 0;
    bridgeKpi.turnLatencyMsVoiceLive.length = 0;
  },
};

const DEFAULT_INSTRUCTIONS =
  "You are Alex — the autonomous IT Operations Manager for this organisation. " +
  "You initiated this Teams call yourself, unprompted, because something on the operational picture needs the human now. " +
  "Open the call by: " +
  "1) A short, warm greeting (one sentence) that explicitly acknowledges YOU called THEM, not the other way round. " +
  "2) Tell them why in 1–2 sentences, citing real ticket numbers / CIs / SLA risk if known. " +
  "3) Ask what they want to do next — approve, defer, or hand off. " +
  "Style: friendly, concise, action-oriented colleague. Speak naturally — no markdown, no bullet read-outs, no emoji.";

/** Place an outbound voice call to a Microsoft Teams user. */
export async function initiateOutboundTeamsCall(opts: {
  teamsUserAadOid: string;
  requestedBy?: string;
  reason?: string;
  instructions?: string;
  voice?: string;
  /** Optional SNOW record this call is tied to — recording / transcript will
   * be attached to its worknote on disconnect. */
  snowTable?: 'incident' | 'change_request' | 'problem';
  snowSysId?: string;
  correlationId?: string;
  reasoningTraceId?: string;
}): Promise<{ callConnectionId: string; serverCallId?: string }> {
  if (!PUBLIC_HOSTNAME) {
    throw new Error(
      'PUBLIC_HOSTNAME (or CONTAINER_APP_HOSTNAME / WEBSITE_HOSTNAME) not set — ACS cannot reach callbacks',
    );
  }
  const client = await getAcsClient();
  const callbackUri = `https://${PUBLIC_HOSTNAME}/api/calls/acs-events`;
  const transportUri = `wss://${PUBLIC_HOSTNAME}/api/calls/acs-media`;

  // Foundry Realtime wants AAD; ACS Cognitive Services link wants the AOAI host
  const cognitiveServicesEndpoint = (VOICELIVE_ENDPOINT || '').replace(/\/$/, '');

  const invite: CallInvite = {
    targetParticipant: { microsoftTeamsUserId: opts.teamsUserAadOid },
    sourceDisplayName: opts.requestedBy
      ? `Alex (for ${opts.requestedBy})`
      : 'Alex — IT Operations Manager',
  };

  const mediaStreamingOptions: MediaStreamingOptions = {
    transportUrl: transportUri,
    transportType: 'websocket',
    contentType: 'audio',
    audioChannelType: 'mixed',
    startMediaStreaming: true,
    enableBidirectional: true,
    audioFormat: 'Pcm24KMono',
  };

  const createOptions: CreateCallOptions = {
    callIntelligenceOptions: cognitiveServicesEndpoint
      ? { cognitiveServicesEndpoint }
      : undefined,
    mediaStreamingOptions,
  };

  log('info', 'createCall — outbound to Teams user', {
    target: opts.teamsUserAadOid,
    callbackUri,
    transportUri,
    sourceDisplayName: invite.sourceDisplayName,
  });

  let result;
  try {
    result = await client.createCall(invite, callbackUri, createOptions);
  } catch (err: unknown) {
    const e = err as {
      message?: string;
      statusCode?: number;
      code?: string;
      request?: { requestId?: string };
      response?: { bodyAsText?: string };
      details?: unknown;
    };
    log('error', 'createCall failed', {
      target: opts.teamsUserAadOid,
      message: e?.message,
      statusCode: e?.statusCode,
      code: e?.code,
      requestId: e?.request?.requestId,
      body: e?.response?.bodyAsText || e?.details,
    });
    throw err;
  }

  const callConnectionId = result.callConnectionProperties?.callConnectionId || '';
  const serverCallId = result.callConnectionProperties?.serverCallId;

  const reasonLine = opts.reason ? `Reason for the call: ${opts.reason}.` : '';
  const instructions = opts.instructions || `${DEFAULT_INSTRUCTIONS}\n\n${reasonLine}`.trim();

  activeCalls.set(callConnectionId, {
    callConnectionId,
    targetTeamsOid: opts.teamsUserAadOid,
    requestedBy: opts.requestedBy,
    instructions,
    voice: opts.voice || 'verse',
    startedAt: Date.now(),
    transcript: [],
    snowTable: opts.snowTable,
    snowSysId: opts.snowSysId,
    correlationId: opts.correlationId,
    reasoningTraceId: opts.reasoningTraceId,
  });

  bridgeKpi.callsInitiated += 1;
  log('info', 'outbound call placed', { callConnectionId, target: opts.teamsUserAadOid });
  return { callConnectionId, serverCallId };
}

/**
 * ACS callback events arrive here as Cloud Events JSON arrays.
 *
 * Phase 1.4 — idempotent + retry-safe. Each event is fingerprinted as
 * `${callConnectionId}::${eventType}::${sequenceNumber}`. Duplicate
 * fingerprints (ACS does retry on 5xx) are dropped before any side effect.
 *
 * Side effects driven from here:
 *   - CallConnected   → start ACS call recording (when enabled)
 *   - CallDisconnected → stop recording, attach recording URL + final
 *                        transcript to the originating SNOW worknote.
 */
export async function handleAcsEvent(body: unknown): Promise<void> {
  const events = Array.isArray(body) ? body : [body];
  for (const evRaw of events) {
    const ev = evRaw as {
      type?: string;
      data?: {
        callConnectionId?: string;
        recordingId?: string;
        recordingChunks?: Array<{ documentId?: string; contentLocation?: string }>;
        sequenceNumber?: number;
        resultInformation?: { code?: number; subCode?: number; message?: string };
      };
      sequenceNumber?: number;
      id?: string;
    };
    const type = ev.type || '(unknown)';
    const callConnectionId = ev.data?.callConnectionId;
    const resultInformation = ev.data?.resultInformation;
    const sequenceNumber =
      ev.data?.sequenceNumber ?? ev.sequenceNumber ?? 0;

    // Idempotency key — drop ACS retries.
    const dedupeKey = `${callConnectionId || 'no-cc'}::${type}::${sequenceNumber}::${ev.id || ''}`;
    if (!markEventSeen(dedupeKey)) {
      log('info', 'duplicate ACS event dropped', { dedupeKey });
      continue;
    }

    log('info', 'callback event', {
      type,
      callConnectionId,
      sequenceNumber,
      resultInformation,
    });

    try {
      if (type.endsWith('CallConnected') && callConnectionId) {
        await onCallConnected(callConnectionId);
      } else if (type.endsWith('CallDisconnected') && callConnectionId) {
        await onCallDisconnected(callConnectionId, resultInformation);
      } else if (
        (type.endsWith('RecordingStateChanged') || type.endsWith('RecordingFileStatusUpdated')) &&
        callConnectionId
      ) {
        const state = activeCalls.get(callConnectionId);
        if (state && ev.data?.recordingChunks?.[0]?.contentLocation) {
          state.recordingUrl = ev.data.recordingChunks[0].contentLocation;
          log('info', 'recording chunk available', {
            callConnectionId,
            recordingUrl: state.recordingUrl,
          });
        }
      } else if (type.endsWith('CreateCallFailed') || type.endsWith('AddParticipantFailed')) {
        log('warn', 'call failed', { type, callConnectionId, resultInformation });
      }
    } catch (err) {
      log('error', 'ACS event handler threw', {
        type,
        callConnectionId,
        error: (err as Error).message,
      });
      // Re-throw 500 so ACS retries; caller (/api/calls/acs-events) decides.
      throw err;
    }
  }
}

async function onCallConnected(callConnectionId: string): Promise<void> {
  log('info', 'call connected — Alex speaking', { callConnectionId });
  bridgeKpi.callsConnected += 1;
  if (!RECORDING_ENABLED) return;
  const state = activeCalls.get(callConnectionId);
  if (!state) return;

  try {
    const client = await getAcsClient();
    const callConn = client.getCallConnection(callConnectionId);
    const props = await callConn.getCallConnectionProperties();
    const serverCallId = props.serverCallId;
    if (!serverCallId) {
      log('warn', 'cannot start recording — no serverCallId', { callConnectionId });
      return;
    }
    const recordingClient = client.getCallRecording();
    const callLocator: CallLocator = { id: serverCallId, kind: 'serverCallLocator' };
    const recording = await recordingClient.start({
      callLocator,
      recordingContent: 'audio',
      recordingChannel: 'mixed',
      recordingFormat: 'mp3',
    });
    state.recordingId = recording.recordingId;
    bridgeKpi.recordingsStarted += 1;
    log('info', 'recording started', {
      callConnectionId,
      recordingId: state.recordingId,
    });
  } catch (err) {
    log('warn', 'recording start failed (continuing without recording)', {
      callConnectionId,
      error: (err as Error).message,
    });
  }
}

async function onCallDisconnected(
  callConnectionId: string,
  resultInformation: unknown,
): Promise<void> {
  const state = activeCalls.get(callConnectionId);
  const durationSec = state ? Math.round((Date.now() - state.startedAt) / 1000) : 0;
  log('info', 'call ended', { callConnectionId, durationSec, resultInformation });

  if (!state) return;

  // Stop recording (best-effort).
  if (state.recordingId) {
    try {
      const client = await getAcsClient();
      await client.getCallRecording().stop(state.recordingId);
      log('info', 'recording stopped', {
        callConnectionId,
        recordingId: state.recordingId,
      });
    } catch (err) {
      log('warn', 'recording stop failed', {
        callConnectionId,
        recordingId: state.recordingId,
        error: (err as Error).message,
      });
    }
  }

  // Attach recording + transcript to SNOW worknote when this call was
  // tied to a SNOW record.
  if (state.snowTable && state.snowSysId && getSnowClientStatus().enabled) {
    const transcript = state.transcript.join('\n').trim();
    const lines = [
      `Alex completed a voice call with the manager (duration ${durationSec}s).`,
      state.recordingUrl
        ? `Recording: ${state.recordingUrl}`
        : state.recordingId
          ? `Recording id: ${state.recordingId} (URL pending RecordingFileStatusUpdated event)`
          : 'Recording: (not enabled or unavailable)',
      transcript ? `Transcript:\n${transcript.slice(0, 4000)}` : 'Transcript: (none captured)',
      state.blockedReason ? `Content Safety: ${state.blockedReason}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    try {
      await addWorkNote(state.snowTable, state.snowSysId, lines, {
        correlationId: state.correlationId || callConnectionId,
        reasoningTraceId: state.reasoningTraceId,
      });
      bridgeKpi.recordingsAttachedToSnow += 1;
      log('info', 'worknote attached', {
        callConnectionId,
        snowTable: state.snowTable,
        snowSysId: state.snowSysId,
      });
    } catch (err) {
      log('warn', 'worknote attach failed', {
        callConnectionId,
        error: (err as Error).message,
      });
    }
  }

  activeCalls.delete(callConnectionId);
}

/**
 * Attach a WebSocket server to the existing HTTP server for ACS media
 * streaming. ACS connects to wss://<host>/api/calls/acs-media — we read PCM
 * frames and forward to Foundry Realtime, then pipe response.audio.delta back
 * to ACS.
 */
export function attachAcsMediaWebSocket(httpServer: HttpServer): void {
  if (!isAcsLogEnabled()) {
    log('info', 'ACS bridge disabled (ACS_CONNECTION_STRING not set)');
    return;
  }
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (!req.url || !req.url.startsWith('/api/calls/acs-media')) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleAcsMediaSocket(ws).catch((err: unknown) => {
        log('error', 'media socket handler crashed', { error: String(err) });
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      });
    });
  });

  log('info', 'media WebSocket attached', { path: '/api/calls/acs-media' });
}

async function handleAcsMediaSocket(acsWs: WebSocket): Promise<void> {
  // Phase A.2 — transport switch. Default `realtime` keeps the existing
  // OpenAI Realtime upstream untouched; `voicelive` routes to the new
  // Foundry Voice Live preview transport with diarisation + interruption.
  if (getSelectedTransport() === 'voicelive') {
    return handleAcsMediaSocketVoiceLive(acsWs);
  }

  log('info', 'ACS media WS opened (transport=realtime)');

  let callConnectionId: string | undefined;
  let realtimeWs: WebSocket | null = null;
  let realtimeReady = false;
  const pendingAudio: string[] = [];

  // Phase A KPI — turn-latency tracking (matches the voicelive path so the
  // demo PR can publish a like-for-like median + p95 comparison).
  let lastUserAudioAt: number | null = null;
  let agentTurnStartedAt: number | null = null;

  // --- Open upstream Foundry Realtime WS ---
  try {
    const tokenResp = await credential.getToken('https://cognitiveservices.azure.com/.default');
    if (!tokenResp?.token) throw new Error('No AAD token for Foundry Realtime');

    const aoaiHost = (VOICELIVE_ENDPOINT || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!aoaiHost) throw new Error('VOICELIVE_ENDPOINT not configured for Realtime WS');
    const realtimeUrl = `wss://${aoaiHost}/openai/realtime?deployment=${encodeURIComponent(
      VOICELIVE_MODEL,
    )}&api-version=${REALTIME_API_VERSION}`;

    log('info', 'Foundry Realtime WS connecting', { url: realtimeUrl });
    realtimeWs = new WebSocket(realtimeUrl, {
      headers: { Authorization: `Bearer ${tokenResp.token}` },
    });

    realtimeWs.on('open', () => {
      log('info', 'Foundry Realtime WS open');
      const state = callConnectionId ? activeCalls.get(callConnectionId) : undefined;
      const sessionUpdate = {
        type: 'session.update',
        session: {
          modalities: ['audio', 'text'],
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          voice: state?.voice || 'verse',
          instructions: state?.instructions || DEFAULT_INSTRUCTIONS,
          turn_detection: { type: 'server_vad' },
          // Phase 1.5 — enable user-side transcription so voiceApprovals
          // can match approve/deny/hold utterances. Whisper-1 is the
          // safe default on the preview Realtime API.
          input_audio_transcription: { model: 'whisper-1' },
        },
      };
      realtimeWs?.send(JSON.stringify(sessionUpdate));
      realtimeReady = true;
      // Drain any audio that arrived before the upstream was ready
      while (pendingAudio.length) {
        const audio = pendingAudio.shift()!;
        realtimeWs?.send(JSON.stringify({ type: 'input_audio_buffer.append', audio }));
      }
      // Greet first
      realtimeWs?.send(
        JSON.stringify({ type: 'response.create', response: { modalities: ['audio', 'text'] } }),
      );
    });

    let audioDeltaCount = 0;
    realtimeWs.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'response.audio.delta' && typeof msg.delta === 'string') {
          audioDeltaCount++;
          if (audioDeltaCount === 1 || audioDeltaCount % 50 === 0) {
            log('info', 'Foundry -> ACS audio delta', {
              count: audioDeltaCount,
              bytes: msg.delta.length,
            });
          }
          // Phase A KPI — first agent audio frame after a user turn.
          if (lastUserAudioAt !== null && agentTurnStartedAt === null) {
            agentTurnStartedAt = Date.now();
            recordTurnLatency('realtime', agentTurnStartedAt - lastUserAudioAt);
            lastUserAudioAt = null;
          }
          // Send audio back into the ACS call
          const envelope = {
            kind: 'AudioData',
            audioData: { data: msg.delta },
          };
          if (acsWs.readyState === WebSocket.OPEN) acsWs.send(JSON.stringify(envelope));
        } else if (msg.type === 'input_audio_buffer.speech_started') {
          // Barge-in: tell ACS to stop playback
          if (acsWs.readyState === WebSocket.OPEN) {
            acsWs.send(JSON.stringify({ kind: 'StopAudio', stopAudio: {} }));
          }
        } else if (msg.type === 'error') {
          log('error', 'Foundry Realtime server error', { error: msg.error });
        } else if (msg.type === 'response.audio_transcript.done') {
          // Phase 1.4 — every completed Alex utterance goes through Content
          // Safety analyzeOutput(). Fail-closed: a flagged response ends
          // the call, hangs up the upstream Realtime WS, and stamps the
          // verdict into the audit-trail. The transcript is also persisted
          // on CallState so it can be attached to the SNOW worknote on
          // disconnect.
          const transcript = typeof msg.transcript === 'string' ? msg.transcript : '';
          const state = callConnectionId ? activeCalls.get(callConnectionId) : undefined;
          if (state && transcript) {
            state.transcript.push(`Alex: ${transcript}`);
          }
          log('info', 'Foundry Realtime event', {
            type: msg.type,
            transcript: transcript.slice(0, 200),
          });
          if (transcript.trim().length > 0) {
            bridgeKpi.contentSafetyChecks += 1;
            // Run synchronously through the existing Content Safety hook.
            analyzeOutput(transcript)
              .then(async (verdict) => {
                // Always log the verdict to the audit trail.
                await logAuditEntry({
                  workerId: 'voice-bridge',
                  workerName: 'ACS Voice Bridge',
                  toolName: 'content-safety.analyzeOutput',
                  riskLevel: 'notify',
                  triggeredBy: callConnectionId || 'voice',
                  triggerType: 'delegation',
                  parameters: JSON.stringify({
                    callConnectionId,
                    transcriptLength: transcript.length,
                    categories: verdict.categories,
                  }),
                  resultSummary: verdict.blocked
                    ? `BLOCKED: ${verdict.reason || 'flagged'}`
                    : 'safe',
                  requiredConfirmation: false,
                  durationMs: 0,
                }).catch(() => {});

                if (verdict.blocked) {
                  bridgeKpi.contentSafetyBlocks += 1;
                  trackSafetyBlock(verdict.reason || 'realtime-output', 'output');
                  log('warn', 'Content Safety blocked transcript — terminating call', {
                    callConnectionId,
                    reason: verdict.reason,
                  });
                  if (state) {
                    state.blockedReason = verdict.reason || 'content-safety-blocked';
                  }
                  // Stop output and tear down the WS pair.
                  try {
                    if (acsWs.readyState === WebSocket.OPEN) {
                      acsWs.send(JSON.stringify({ kind: 'StopAudio', stopAudio: {} }));
                      acsWs.close();
                    }
                  } catch {
                    /* ignore */
                  }
                  try {
                    realtimeWs?.close();
                  } catch {
                    /* ignore */
                  }
                }
              })
              .catch((err: Error) => {
                // Fail closed on Content Safety errors (matches analyzeOutput's
                // own behaviour for auth/config errors). Tear the call down.
                log('error', 'Content Safety check threw — failing closed', {
                  callConnectionId,
                  error: err.message,
                });
                try {
                  if (acsWs.readyState === WebSocket.OPEN) acsWs.close();
                } catch {
                  /* ignore */
                }
                try {
                  realtimeWs?.close();
                } catch {
                  /* ignore */
                }
              });
          }
        } else if (
          msg.type === 'session.created' ||
          msg.type === 'session.updated' ||
          msg.type === 'response.created' ||
          msg.type === 'response.done' ||
          msg.type === 'response.cancelled' ||
          msg.type === 'response.audio.done'
        ) {
          log('info', 'Foundry Realtime event', {
            type: msg.type,
            status: msg.response?.status,
            statusDetails: msg.response?.status_details,
          });
        } else if (msg.type === 'conversation.item.input_audio_transcription.completed') {
          // Phase 1.5 — user-side transcription. Try to match the
          // utterance to an approve/deny/hold intent and resolve a
          // pending action. The bridge plays the confirmation back via
          // a Realtime `response.create` with custom instructions.
          const userUtterance = typeof msg.transcript === 'string' ? msg.transcript : '';
          const state = callConnectionId ? activeCalls.get(callConnectionId) : undefined;
          if (state && userUtterance) {
            state.transcript.push(`User: ${userUtterance}`);
          }
          if (userUtterance.trim().length > 0 && state) {
            processVoiceApproval(userUtterance, {
              callConnectionId,
              aadOid: state.targetTeamsOid,
              displayName: undefined,
            })
              .then((result) => {
                log('info', 'voice approval intent', {
                  callConnectionId,
                  intent: result.intent,
                  confidence: result.confidence,
                  resolved: result.resolvedAction?.id,
                });
                // Speak the confirmation back. The Realtime preview API
                // accepts a `response.create` with an instructions
                // override, which the model will speak using TTS.
                if (result.confirmation && realtimeWs?.readyState === WebSocket.OPEN) {
                  realtimeWs.send(
                    JSON.stringify({
                      type: 'response.create',
                      response: {
                        modalities: ['audio', 'text'],
                        instructions: result.confirmation,
                      },
                    }),
                  );
                }
              })
              .catch((err: Error) => {
                log('warn', 'voice approval failed', {
                  callConnectionId,
                  error: err.message,
                });
              });
          }
        }
      } catch {
        /* ignore parse errors on binary frames */
      }
    });

    realtimeWs.on('close', () => {
      log('info', 'Foundry Realtime WS closed');
      try {
        acsWs.close();
      } catch {
        /* ignore */
      }
    });
    realtimeWs.on('error', (err: Error) => {
      log('error', 'Foundry Realtime WS error', { error: String(err) });
    });
  } catch (err: unknown) {
    log('error', 'failed to open Foundry Realtime WS', { error: String(err) });
    try {
      acsWs.close();
    } catch {
      /* ignore */
    }
    return;
  }

  // --- Read ACS frames ---
  acsWs.on('message', (data: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(data.toString()) as {
        kind?: string;
        audioData?: { data?: string };
        audioMetadata?: { mediaSubscriptionId?: string };
      };
      if (msg.kind === 'AudioData' && msg.audioData?.data) {
        // Phase A KPI — last user audio frame timestamp; reset agent flag.
        lastUserAudioAt = Date.now();
        agentTurnStartedAt = null;
        if (realtimeReady && realtimeWs?.readyState === WebSocket.OPEN) {
          realtimeWs.send(
            JSON.stringify({ type: 'input_audio_buffer.append', audio: msg.audioData.data }),
          );
        } else {
          pendingAudio.push(msg.audioData.data);
        }
      } else if (msg.kind === 'AudioMetadata' && msg.audioMetadata?.mediaSubscriptionId) {
        callConnectionId = msg.audioMetadata.mediaSubscriptionId;
        log('info', 'ACS media metadata', { mediaSubscriptionId: callConnectionId });
      }
    } catch {
      /* ignore non-JSON */
    }
  });

  acsWs.on('close', () => {
    log('info', 'ACS media WS closed');
    try {
      realtimeWs?.close();
    } catch {
      /* ignore */
    }
  });
  acsWs.on('error', (err: Error) => {
    log('warn', 'ACS media WS error', { error: String(err) });
  });
}

// ── Phase A.2 — Voice Live transport handler ──────────────────────────────
//
// Same external surface as `handleAcsMediaSocket` (above): consumes ACS
// `AudioData` frames and pushes back `AudioData` / `StopAudio` envelopes.
// Differs in:
//   - Upstream is Microsoft Foundry **Voice Live preview** (region-pinned WS
//     endpoint via `voiceLiveTransport.ts`), not OpenAI Realtime.
//   - Diarisation labels are surfaced in the persisted call transcript.
//   - Barge-in flips through `conn.cancelResponse()` when interruption is on.
//
// Selected when env `VOICELIVE_TRANSPORT=voicelive`. Hard-rule compliant:
// audio still passes through `analyzeOutput()` (Content Safety, Phase 1.4
// hook), recording + outbound dial-out still go through ACS.
async function handleAcsMediaSocketVoiceLive(acsWs: WebSocket): Promise<void> {
  log('info', 'ACS media WS opened (transport=voicelive)');

  let callConnectionId: string | undefined;
  let conn: VoiceLiveConnection | null = null;
  const pendingAudio: string[] = [];

  // Phase A KPI — track time from last user-audio frame to the first agent
  // audio frame of the response. Reset on every user transcript-final event.
  let lastUserAudioAt: number | null = null;
  let agentTurnStartedAt: number | null = null;

  // The session config is parameterised by the active call's instructions
  // when one is bound to this WS. Until AudioMetadata arrives we use the
  // shared DEFAULT_INSTRUCTIONS.
  const initialInstructions = DEFAULT_INSTRUCTIONS;

  try {
    conn = await connectVoiceLive({
      session: {
        instructions: initialInstructions,
        tools: [],
      },
      onAudio: (base64Pcm16) => {
        // First agent audio frame after a user turn — latch the latency.
        if (lastUserAudioAt !== null && agentTurnStartedAt === null) {
          agentTurnStartedAt = Date.now();
          recordTurnLatency('voicelive', agentTurnStartedAt - lastUserAudioAt);
          lastUserAudioAt = null;
        }
        const envelope = { kind: 'AudioData', audioData: { data: base64Pcm16 } };
        if (acsWs.readyState === WebSocket.OPEN) {
          acsWs.send(JSON.stringify(envelope));
        }
      },
      onTranscript: async (evt) => {
        const state = callConnectionId ? activeCalls.get(callConnectionId) : undefined;
        // Persist diarised transcript so it can be attached to the SNOW
        // worknote on disconnect (mirrors the realtime-path behaviour).
        if (state && evt.isFinal && evt.text.trim().length > 0) {
          const speakerName = evt.speaker === 'agent' ? 'Alex' : 'User';
          const label = evt.diarizationLabel ? ` [${evt.diarizationLabel}]` : '';
          state.transcript.push(`${speakerName}${label}: ${evt.text}`);
        }

        // Hard rule: every Alex utterance goes through Content Safety
        // before it leaves the bridge. Voice Live transcript events are
        // emitted by the same upstream that produced the audio, so we
        // gate on the FINAL event only and tear the call down on a block.
        if (evt.speaker === 'agent' && evt.isFinal && evt.text.trim().length > 0) {
          bridgeKpi.contentSafetyChecks += 1;
          try {
            const verdict = await analyzeOutput(evt.text);
            await logAuditEntry({
              workerId: 'voice-bridge',
              workerName: 'ACS Voice Bridge (Voice Live)',
              toolName: 'content-safety.analyzeOutput',
              riskLevel: 'notify',
              triggeredBy: callConnectionId || 'voice',
              triggerType: 'delegation',
              parameters: JSON.stringify({
                callConnectionId,
                transcriptLength: evt.text.length,
                categories: verdict.categories,
                speakerLabel: evt.diarizationLabel,
                transport: 'voicelive',
              }),
              resultSummary: verdict.blocked
                ? `BLOCKED: ${verdict.reason || 'flagged'}`
                : 'safe',
              requiredConfirmation: false,
              durationMs: 0,
            }).catch(() => {});

            if (verdict.blocked) {
              bridgeKpi.contentSafetyBlocks += 1;
              trackSafetyBlock(verdict.reason || 'voicelive-output', 'output');
              log('warn', 'Content Safety blocked transcript — terminating call', {
                callConnectionId,
                reason: verdict.reason,
                transport: 'voicelive',
              });
              if (state) {
                state.blockedReason = verdict.reason || 'content-safety-blocked';
              }
              try {
                if (acsWs.readyState === WebSocket.OPEN) {
                  acsWs.send(JSON.stringify({ kind: 'StopAudio', stopAudio: {} }));
                  acsWs.close();
                }
              } catch {
                /* ignore */
              }
              try {
                conn?.close();
              } catch {
                /* ignore */
              }
            }
          } catch (err) {
            log('error', 'Content Safety check threw — failing closed', {
              callConnectionId,
              error: (err as Error).message,
              transport: 'voicelive',
            });
            try {
              if (acsWs.readyState === WebSocket.OPEN) acsWs.close();
            } catch {
              /* ignore */
            }
            try {
              conn?.close();
            } catch {
              /* ignore */
            }
          }
        }

        // User-side approvals — delegate to the existing voiceApprovals
        // module. Voice Live's diarised user transcripts feed it the same
        // way the realtime path does.
        if (evt.speaker === 'user' && evt.isFinal && evt.text.trim().length > 0 && state) {
          processVoiceApproval(evt.text, {
            callConnectionId,
            aadOid: state.targetTeamsOid,
            displayName: undefined,
          })
            .then((result) => {
              log('info', 'voice approval intent (voicelive)', {
                callConnectionId,
                intent: result.intent,
                confidence: result.confidence,
                resolved: result.resolvedAction?.id,
              });
              if (result.confirmation) {
                conn?.send({
                  type: 'response.create',
                  response: {
                    modalities: ['audio', 'text'],
                    instructions: result.confirmation,
                  },
                });
              }
            })
            .catch((err: Error) => {
              log('warn', 'voice approval failed (voicelive)', {
                callConnectionId,
                error: err.message,
              });
            });
        }
      },
      onToolCall: ({ callId, name, argumentsJson }) => {
        // Phase A.1 scope: tool dispatch from the in-call channel is not
        // wired. We log so it is visible in CI smoke + leave the inbound
        // call connected; manager-facing tools are exposed through the DA
        // surface, not the ACS voice channel.
        log('info', 'voicelive tool call (not dispatched)', {
          callConnectionId,
          callId,
          name,
          argLen: argumentsJson.length,
        });
      },
      onError: (err) => {
        log('error', 'voicelive ws error', { error: err.message, callConnectionId });
      },
      onClose: (code, reason) => {
        log('info', 'voicelive ws closed', { code, reason, callConnectionId });
        try {
          if (acsWs.readyState === WebSocket.OPEN) acsWs.close();
        } catch {
          /* ignore */
        }
      },
    });

    // Greet first — same shape as the realtime path so the manager hears
    // the opening utterance immediately on call connect.
    conn.send({
      type: 'response.create',
      response: { modalities: ['audio', 'text'] },
    });

    // Drain anything that arrived before the upstream WS finished opening.
    while (pendingAudio.length) {
      const audio = pendingAudio.shift()!;
      conn.appendAudio(audio);
    }
  } catch (err) {
    log('error', 'failed to open Voice Live transport', { error: String(err) });
    try {
      acsWs.close();
    } catch {
      /* ignore */
    }
    return;
  }

  // Read ACS frames → forward into Voice Live.
  acsWs.on('message', (data: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(data.toString()) as {
        kind?: string;
        audioData?: { data?: string };
        audioMetadata?: { mediaSubscriptionId?: string };
      };
      if (msg.kind === 'AudioData' && msg.audioData?.data) {
        // Phase A KPI — last user audio frame timestamp; agent turn flag
        // reset so the next agent frame is treated as a fresh response.
        lastUserAudioAt = Date.now();
        agentTurnStartedAt = null;
        if (conn) {
          conn.appendAudio(msg.audioData.data);
        } else {
          pendingAudio.push(msg.audioData.data);
        }
      } else if (msg.kind === 'AudioMetadata' && msg.audioMetadata?.mediaSubscriptionId) {
        callConnectionId = msg.audioMetadata.mediaSubscriptionId;
        log('info', 'ACS media metadata (voicelive)', {
          mediaSubscriptionId: callConnectionId,
        });
      }
    } catch {
      /* ignore non-JSON */
    }
  });

  acsWs.on('close', () => {
    log('info', 'ACS media WS closed (voicelive)');
    try {
      conn?.close();
    } catch {
      /* ignore */
    }
  });
  acsWs.on('error', (err: Error) => {
    log('warn', 'ACS media WS error (voicelive)', { error: String(err) });
  });
}

/** True when ACS is configured (connection string present + public hostname). */
export function isAcsConfigured(): boolean {
  return Boolean(ACS_CONNECTION_STRING && PUBLIC_HOSTNAME);
}

/** Snapshot of active server-side bridged calls (for diagnostics). */
export function getActiveCallSnapshot(): Array<{
  callConnectionId: string;
  targetTeamsOid: string;
  requestedBy?: string;
  voice: string;
  startedAt: number;
  ageSec: number;
}> {
  const now = Date.now();
  return Array.from(activeCalls.values()).map((c) => ({
    callConnectionId: c.callConnectionId,
    targetTeamsOid: c.targetTeamsOid,
    requestedBy: c.requestedBy,
    voice: c.voice,
    startedAt: c.startedAt,
    ageSec: Math.round((now - c.startedAt) / 1000),
  }));
}
