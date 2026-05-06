// ITSM Operations — Microsoft Foundry Voice Live preview transport (Phase A.1)
//
// Mirrors the WS interface used by `voice/voiceProxy.ts` and the inline
// Realtime path in `voice/acsBridge.ts`, but points at the Foundry **Voice
// Live preview** WS endpoint instead of OpenAI Realtime.
//
// Why a separate file:
//   - voiceProxy.ts and acsBridge.ts use the OpenAI Realtime WS shape
//     (session.update with `audio.input/output`, server_vad, etc.).
//   - Voice Live preview adds first-class **diarisation labels** (per-speaker
//     transcript), **interruption handling** (turn cancellation), and a
//     region-pinned endpoint shape `wss://{region}.api.voicelive.com/...`.
//   - Both paths use AAD bearer (DefaultAzureCredential) with the
//     `https://cognitiveservices.azure.com/.default` scope, so callers can
//     swap transports without changing the auth model or the audio format.
//
// Selected by `VOICELIVE_TRANSPORT=realtime|voicelive` (default `realtime`).
// When `voicelive` is selected, callers (currently `acsBridge.ts`) call
// `connectVoiceLive(...)` instead of opening a raw WS to the Realtime
// endpoint. Audio in/out remains PCM16 24 kHz on both sides.
//
// References (preview):
//   https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-overview
//   https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-quickstart
//
// Phase-A acceptance criteria covered by this module:
//   [x] Foundry Voice Live preview WS endpoint
//   [x] AAD bearer via DefaultAzureCredential
//   [x] PCM16 24 kHz preserved both sides
//   [x] Diarisation labels surfaced in transcripts (`speaker` field)
//   [x] Interruption + voice + region driven from env
//   [x] Same WS surface as the existing Realtime transport so acsBridge can
//       swap without touching its event-loop wiring.

import { WebSocket } from 'ws';
import { DefaultAzureCredential } from '@azure/identity';

// ── Env / config ───────────────────────────────────────────────────────────

/**
 * Transport selector. `realtime` = OpenAI Realtime WS (the existing path).
 * `voicelive` = Foundry Voice Live preview path (this module).
 */
export type VoiceTransport = 'realtime' | 'voicelive';

export function getSelectedTransport(): VoiceTransport {
  const raw = (process.env.VOICELIVE_TRANSPORT || 'realtime').trim().toLowerCase();
  return raw === 'voicelive' ? 'voicelive' : 'realtime';
}

const VOICELIVE_REGION = (process.env.VOICELIVE_REGION || '').trim();
const VOICELIVE_ENDPOINT = (process.env.VOICELIVE_ENDPOINT || '').trim();
const VOICELIVE_MODEL = process.env.VOICELIVE_MODEL || 'gpt-realtime';
const VOICELIVE_VOICE_ID = process.env.VOICELIVE_VOICE_ID || 'en-US-Ava:DragonHDLatestNeural';
const VOICELIVE_DIARIZATION = ((process.env.VOICELIVE_DIARIZATION || 'on').toLowerCase() !== 'off');
const VOICELIVE_INTERRUPTION = ((process.env.VOICELIVE_INTERRUPTION || 'on').toLowerCase() !== 'off');

// PCM16 24 kHz — must match acsBridge / voiceProxy so callers can hand audio
// straight through without resampling.
const AUDIO_SAMPLE_RATE_HZ = 24_000;
const AUDIO_FORMAT_PCM16 = 'audio/pcm';

// ── Public types ───────────────────────────────────────────────────────────

export interface VoiceLiveSessionConfig {
  /** Base instructions / persona prompt the model should follow. */
  instructions: string;
  /** OpenAI-style tool list (passed straight through). */
  tools?: unknown[];
  /** Override voice id (otherwise uses VOICELIVE_VOICE_ID). */
  voice?: string;
  /** Optional correlation id surfaced in logs. */
  correlationId?: string;
}

/**
 * Lightweight transcript event — diarisation-aware. Surfaced to callers via
 * `onTranscript` so existing pipelines (Content Safety, audit trail, SNOW
 * worknote attach) can consume diarised text without parsing raw WS frames.
 */
export interface VoiceLiveTranscriptEvent {
  /** 'agent' = Alex, 'user' = the called Teams user. Diarisation only flips
   *  these for `voicelive` transport; on `realtime` transport `speaker` is
   *  set from the message role (assistant→agent, user→user). */
  speaker: 'agent' | 'user';
  /** Diarisation label as returned by Voice Live (e.g. 'speaker_0',
   *  'speaker_1'). Empty when diarisation is disabled. */
  diarizationLabel: string;
  /** Whether this is a final transcript (true) or partial/delta (false). */
  isFinal: boolean;
  /** Transcript text. */
  text: string;
}

export interface VoiceLiveConnection {
  /** Underlying WebSocket — exposed so callers can manage lifecycle. */
  ws: WebSocket;
  /** Send a raw JSON event (forwarded to the Voice Live session). */
  send: (event: Record<string, unknown>) => void;
  /** Forward a chunk of PCM16 24 kHz audio (base64-encoded) from the caller. */
  appendAudio: (base64Pcm16: string) => void;
  /** Commit the current input buffer (turn boundary). */
  commitAudio: () => void;
  /** Cancel the current model response — used for barge-in / interruption. */
  cancelResponse: () => void;
  /** Close the WS cleanly. */
  close: (code?: number, reason?: string) => void;
}

export interface ConnectVoiceLiveOptions {
  session: VoiceLiveSessionConfig;
  /** Called with every diarised transcript event. */
  onTranscript?: (evt: VoiceLiveTranscriptEvent) => void;
  /** Called with every audio frame (base64 PCM16 24 kHz) emitted by the
   *  model. Callers (acsBridge) forward this straight to the ACS media
   *  channel. */
  onAudio?: (base64Pcm16: string) => void;
  /** Called for tool-call requests so the caller can dispatch via its own
   *  tool table and reply with `function_call_output`. */
  onToolCall?: (call: { callId: string; name: string; argumentsJson: string }) => void;
  /** Called on every WS error (transient or fatal). */
  onError?: (err: Error) => void;
  /** Called once when the WS closes. */
  onClose?: (code: number, reason: string) => void;
  /** Optional explicit token; otherwise we acquire one via
   *  DefaultAzureCredential. Useful for tests. */
  bearerToken?: string;
}

// ── URL builder ────────────────────────────────────────────────────────────

/**
 * Build the Voice Live preview WS URL.
 *   - If `VOICELIVE_REGION` is set: `wss://{region}.api.voicelive.com/v1/realtime?model={model}`.
 *   - Else fall back to `VOICELIVE_ENDPOINT` (Foundry project endpoint) and
 *     append `/openai/v1/realtime?model={model}` — same shape as the Realtime
 *     GA path, kept so single-region demos work without filling in a region.
 *
 * Both shapes accept the same AAD bearer.
 */
export function buildVoiceLiveUrl(model: string = VOICELIVE_MODEL): string {
  if (VOICELIVE_REGION) {
    const region = VOICELIVE_REGION.replace(/[^a-z0-9-]/gi, '');
    if (!region) throw new Error('VOICELIVE_REGION is set but invalid');
    return `wss://${region}.api.voicelive.com/v1/realtime?model=${encodeURIComponent(model)}`;
  }
  if (!VOICELIVE_ENDPOINT) {
    throw new Error(
      'Voice Live transport selected but neither VOICELIVE_REGION nor VOICELIVE_ENDPOINT is set',
    );
  }
  const url = new URL(VOICELIVE_ENDPOINT);
  return `wss://${url.host}/openai/v1/realtime?model=${encodeURIComponent(model)}`;
}

// ── Session config ─────────────────────────────────────────────────────────

/**
 * Build the `session.update` payload for Voice Live preview.
 *
 * Voice Live extends the Realtime session shape with:
 *   - `voice.diarization`: turn-by-turn speaker tagging.
 *   - `turn_detection.interrupt_response`: barge-in handling.
 *   - `voice.id`: HD/Dragon voice ids (e.g. `en-US-Ava:DragonHDLatestNeural`).
 *
 * We send the same PCM16 24 kHz format on both input and output so callers
 * can pipe audio straight through without resampling.
 */
function buildSessionUpdate(cfg: VoiceLiveSessionConfig): Record<string, unknown> {
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: cfg.instructions,
      output_modalities: ['audio'],
      tools: cfg.tools ?? [],
      tool_choice: 'auto',
      audio: {
        input: {
          format: { type: AUDIO_FORMAT_PCM16, rate: AUDIO_SAMPLE_RATE_HZ },
          transcription: { model: 'whisper-1' },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
            // Voice Live preview extension — barge-in.
            ...(VOICELIVE_INTERRUPTION ? { interrupt_response: true } : {}),
          },
          // Voice Live preview extension — diarisation labels.
          ...(VOICELIVE_DIARIZATION ? { diarization: { enabled: true } } : {}),
        },
        output: {
          format: { type: AUDIO_FORMAT_PCM16, rate: AUDIO_SAMPLE_RATE_HZ },
          voice: {
            id: cfg.voice ?? VOICELIVE_VOICE_ID,
          },
        },
      },
    },
  };
}

// ── Bearer ─────────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const cred = new DefaultAzureCredential();
  const token = await cred.getToken('https://cognitiveservices.azure.com/.default');
  if (!token?.token) {
    throw new Error('Failed to acquire AAD bearer for Voice Live (cognitiveservices scope)');
  }
  return token.token;
}

// ── Diarisation event mapping ──────────────────────────────────────────────

interface RawTranscriptEvent {
  type?: string;
  transcript?: string;
  delta?: string;
  speaker?: string;
  role?: string;
  // Voice Live preview surfaces diarisation under either `speaker_label` or
  // a nested `diarization.speaker`. We accept both.
  speaker_label?: string;
  diarization?: { speaker?: string };
}

function mapTranscriptEvent(raw: RawTranscriptEvent): VoiceLiveTranscriptEvent | null {
  const t = raw.type || '';
  const isFinal =
    t === 'response.audio_transcript.done' ||
    t === 'conversation.item.input_audio_transcription.completed';
  const isDelta = t === 'response.audio_transcript.delta';
  if (!isFinal && !isDelta) return null;

  const text = (raw.transcript || raw.delta || '').toString();
  if (!text) return null;

  const diarLabel =
    (raw.speaker_label || raw.diarization?.speaker || raw.speaker || '').toString();

  // Map speaker:
  //   - explicit role wins (assistant → agent, user → user).
  //   - otherwise infer from event type: input_audio_transcription = user side,
  //     audio_transcript = model output.
  let speaker: 'agent' | 'user';
  if (raw.role === 'assistant') speaker = 'agent';
  else if (raw.role === 'user') speaker = 'user';
  else if (t.startsWith('response.audio_transcript')) speaker = 'agent';
  else speaker = 'user';

  return {
    speaker,
    diarizationLabel: diarLabel,
    isFinal,
    text,
  };
}

// ── Public connector ───────────────────────────────────────────────────────

/**
 * Open a Voice Live preview session.
 *
 * Lifecycle:
 *   1. Acquire AAD bearer (or use `bearerToken`).
 *   2. Open WS to the preview endpoint.
 *   3. On `open`, send `session.update` with PCM16 24 kHz, voice, diarisation,
 *      interruption settings.
 *   4. Forward transcript events through `onTranscript`.
 *   5. Forward audio frames through `onAudio`.
 *   6. Forward tool calls through `onToolCall`.
 *
 * Callers retain control of the WS via the returned `VoiceLiveConnection`
 * (mirrors the surface acsBridge already uses for the Realtime path).
 */
export async function connectVoiceLive(
  opts: ConnectVoiceLiveOptions,
): Promise<VoiceLiveConnection> {
  const url = buildVoiceLiveUrl();
  const token = opts.bearerToken ?? (await getAccessToken());

  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });

  const send = (event: Record<string, unknown>): void => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  };

  const appendAudio = (base64Pcm16: string): void => {
    send({ type: 'input_audio_buffer.append', audio: base64Pcm16 });
  };

  const commitAudio = (): void => {
    send({ type: 'input_audio_buffer.commit' });
  };

  const cancelResponse = (): void => {
    // Used for barge-in. Voice Live honours `response.cancel` while audio is
    // streaming and stops the current TTS within ~50ms.
    send({ type: 'response.cancel' });
  };

  const close = (code?: number, reason?: string): void => {
    try {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close(code, reason);
      }
    } catch {
      /* swallow — close is best-effort */
    }
  };

  ws.on('open', () => {
    try {
      send(buildSessionUpdate(opts.session));
    } catch (err) {
      opts.onError?.(err as Error);
    }
  });

  ws.on('message', (data) => {
    let raw: any;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      return; // ignore non-JSON frames (binary audio is base64-encoded inside JSON anyway)
    }

    // 1. Audio frames — forward straight through.
    if (raw.type === 'response.output_audio.delta' || raw.type === 'response.audio.delta') {
      const audio = raw.delta || raw.audio;
      if (typeof audio === 'string' && audio.length > 0) {
        opts.onAudio?.(audio);
      }
      return;
    }

    // 2. Tool-call requests.
    if (raw.type === 'response.function_call_arguments.done') {
      const callId = String(raw.call_id || '');
      const name = String(raw.name || '');
      const argumentsJson = String(raw.arguments || '{}');
      if (callId && name) {
        try {
          opts.onToolCall?.({ callId, name, argumentsJson });
        } catch (err) {
          opts.onError?.(err as Error);
        }
      }
      return;
    }

    // 3. Transcript events (diarised).
    const transcript = mapTranscriptEvent(raw as RawTranscriptEvent);
    if (transcript) {
      try {
        opts.onTranscript?.(transcript);
      } catch (err) {
        opts.onError?.(err as Error);
      }
      return;
    }

    // 4. Errors surfaced from the service.
    if (raw.type === 'error') {
      const msg = raw?.error?.message || 'voice live error';
      opts.onError?.(new Error(String(msg)));
      return;
    }
  });

  ws.on('error', (err) => {
    opts.onError?.(err as Error);
  });

  ws.on('close', (code, reason) => {
    opts.onClose?.(Number(code) || 0, reason?.toString() || '');
  });

  return { ws, send, appendAudio, commitAudio, cancelResponse, close };
}

// ── Test helpers (no exports of internals to runtime callers) ──────────────

/** @internal — for unit tests only. */
export const __test = {
  buildSessionUpdate,
  mapTranscriptEvent,
  buildVoiceLiveUrl,
  AUDIO_SAMPLE_RATE_HZ,
};
