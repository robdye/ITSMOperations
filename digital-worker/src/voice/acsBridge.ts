// ITSM Operations Digital Worker — ACS Call Automation <-> Foundry Realtime audio bridge
//
// Pattern ported from Cassidy (cassidy/src/voice/acsBridge.ts). Lets Alex
// place a real outbound voice call to a Microsoft Teams user (by AAD object
// id) and have a real-time conversation — same UX as Cassidy's "page me"
// briefing, no browser tab, no Teams deep-link click required.
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
// Auth:
//   - ACS Call Automation: connection string from env (ACS_CONNECTION_STRING)
//   - Foundry Realtime: AAD bearer via DefaultAzureCredential (system MI)

import {
  CallAutomationClient,
  type CallInvite,
  type CreateCallOptions,
  type MediaStreamingOptions,
} from '@azure/communication-call-automation';
import { CommunicationIdentityClient } from '@azure/communication-identity';
import type { CommunicationUserIdentifier } from '@azure/communication-common';
import WebSocket, { WebSocketServer } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'http';
import { DefaultAzureCredential } from '@azure/identity';

const ACS_CONNECTION_STRING = process.env.ACS_CONNECTION_STRING || '';
// Optional: a pre-provisioned ACS user id to use as the source identity for
// outbound calls. If unset, we lazily provision one and cache it in-memory.
// Persisting it to an app setting (ACS_SOURCE_USER_ID) is recommended so it
// survives restarts.
let ACS_SOURCE_USER_ID = process.env.ACS_SOURCE_USER_ID || '';

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

// Match Cassidy's preview API + session shape — known to work end-to-end with
// ACS bidirectional media streaming. ITSMOperations browser /voice path uses
// the GA shape; we keep them on different paths.
const REALTIME_API_VERSION = '2025-04-01-preview';

const credential = new DefaultAzureCredential();

let acsClient: CallAutomationClient | null = null;

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

/**
 * Lazily provision (or reuse) an ACS user identity that we use as the source
 * for outbound calls. ACS Call Automation -> Teams interop requires a valid
 * `sourceIdentity` (CommunicationUserIdentifier); without one, Teams
 * flight-proxy returns 403#10391 (Forbidden) on createCall.
 */
async function ensureSourceIdentity(): Promise<CommunicationUserIdentifier> {
  if (ACS_SOURCE_USER_ID) {
    return { communicationUserId: ACS_SOURCE_USER_ID };
  }
  const idClient = new CommunicationIdentityClient(ACS_CONNECTION_STRING);
  const user = await idClient.createUser();
  ACS_SOURCE_USER_ID = user.communicationUserId;
  log('info', 'ACS source identity provisioned', {
    communicationUserId: ACS_SOURCE_USER_ID,
    note: 'Set ACS_SOURCE_USER_ID app setting to persist across restarts',
  });
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
}
const activeCalls = new Map<string, CallState>();

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
  });

  log('info', 'outbound call placed', { callConnectionId, target: opts.teamsUserAadOid });
  return { callConnectionId, serverCallId };
}

/** ACS callback events arrive here as Cloud Events JSON arrays. */
export function handleAcsEvent(body: unknown): void {
  const events = Array.isArray(body) ? body : [body];
  for (const evRaw of events) {
    const ev = evRaw as {
      type?: string;
      data?: {
        callConnectionId?: string;
        resultInformation?: { code?: number; subCode?: number; message?: string };
      };
    };
    const type = ev.type || '(unknown)';
    const callConnectionId = ev.data?.callConnectionId;
    const resultInformation = ev.data?.resultInformation;
    log('info', 'callback event', {
      type,
      callConnectionId,
      resultInformation,
    });

    if (type.endsWith('CallConnected') && callConnectionId) {
      log('info', 'call connected — Alex speaking', { callConnectionId });
    } else if (type.endsWith('CallDisconnected') && callConnectionId) {
      const state = activeCalls.get(callConnectionId);
      const durationSec = state ? Math.round((Date.now() - state.startedAt) / 1000) : 0;
      activeCalls.delete(callConnectionId);
      log('info', 'call ended', { callConnectionId, durationSec, resultInformation });
    } else if (type.endsWith('CreateCallFailed') || type.endsWith('AddParticipantFailed')) {
      log('warn', 'call failed', { type, callConnectionId, resultInformation });
    }
  }
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
  log('info', 'ACS media WS opened');

  let callConnectionId: string | undefined;
  let realtimeWs: WebSocket | null = null;
  let realtimeReady = false;
  const pendingAudio: string[] = [];

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
        } else if (
          msg.type === 'session.created' ||
          msg.type === 'session.updated' ||
          msg.type === 'response.created' ||
          msg.type === 'response.done' ||
          msg.type === 'response.cancelled' ||
          msg.type === 'response.audio.done' ||
          msg.type === 'response.audio_transcript.done'
        ) {
          log('info', 'Foundry Realtime event', {
            type: msg.type,
            transcript: msg.transcript ? String(msg.transcript).slice(0, 200) : undefined,
            status: msg.response?.status,
            statusDetails: msg.response?.status_details,
          });
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
