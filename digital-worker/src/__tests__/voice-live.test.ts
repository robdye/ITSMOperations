import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── voiceLiveTransport pure-function helpers ────────────────────────────────
// These tests don't open a WebSocket — they hit the `__test` exports of the
// transport module so we can verify session config, transcript mapping, and
// URL construction in isolation.

describe('voiceLiveTransport.getSelectedTransport()', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to 'realtime' when VOICELIVE_TRANSPORT is unset", async () => {
    vi.stubEnv('VOICELIVE_TRANSPORT', '');
    const mod = await import('../voice/voiceLiveTransport.js');
    expect(mod.getSelectedTransport()).toBe('realtime');
  });

  it("returns 'voicelive' when VOICELIVE_TRANSPORT=voicelive", async () => {
    vi.stubEnv('VOICELIVE_TRANSPORT', 'voicelive');
    const mod = await import('../voice/voiceLiveTransport.js');
    expect(mod.getSelectedTransport()).toBe('voicelive');
  });

  it("falls back to 'realtime' on unknown values", async () => {
    vi.stubEnv('VOICELIVE_TRANSPORT', 'something-else');
    const mod = await import('../voice/voiceLiveTransport.js');
    expect(mod.getSelectedTransport()).toBe('realtime');
  });
});

describe('voiceLiveTransport.__test.buildSessionUpdate', () => {
  it('emits PCM16 24 kHz input + output and includes diarisation + interruption by default', async () => {
    const mod = await import('../voice/voiceLiveTransport.js');
    const { buildSessionUpdate, AUDIO_SAMPLE_RATE_HZ } = mod.__test;
    const update = buildSessionUpdate({ instructions: 'You are a friendly colleague.' }) as any;
    expect(update.type).toBe('session.update');
    expect(update.session.audio.input.format.rate).toBe(AUDIO_SAMPLE_RATE_HZ);
    expect(update.session.audio.output.format.rate).toBe(AUDIO_SAMPLE_RATE_HZ);
    // Diarisation block exists
    expect(update.session.audio.input.diarization).toBeDefined();
    // Barge-in flag on the VAD turn-detection block
    expect(update.session.audio.input.turn_detection.interrupt_response).toBe(true);
  });

  it('passes through caller-provided voice id', async () => {
    const mod = await import('../voice/voiceLiveTransport.js');
    const update = mod.__test.buildSessionUpdate({
      instructions: '',
      voice: 'en-US-Custom:DragonHDLatestNeural',
    }) as any;
    expect(update.session.audio.output.voice.id).toBe('en-US-Custom:DragonHDLatestNeural');
  });
});

describe('voiceLiveTransport.__test.mapTranscriptEvent', () => {
  it('maps assistant audio_transcript.delta → agent partial', async () => {
    const mod = await import('../voice/voiceLiveTransport.js');
    const ev = mod.__test.mapTranscriptEvent({
      type: 'response.audio_transcript.delta',
      delta: 'Hello there',
      role: 'assistant',
    });
    expect(ev).not.toBeNull();
    expect(ev!.speaker).toBe('agent');
    expect(ev!.isFinal).toBe(false);
    expect(ev!.text).toBe('Hello there');
  });

  it('maps user input_audio_transcription.completed → user final', async () => {
    const mod = await import('../voice/voiceLiveTransport.js');
    const ev = mod.__test.mapTranscriptEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Approve INC1',
    });
    expect(ev).not.toBeNull();
    expect(ev!.speaker).toBe('user');
    expect(ev!.isFinal).toBe(true);
    expect(ev!.text).toBe('Approve INC1');
  });

  it('surfaces the diarisation label from speaker_label', async () => {
    const mod = await import('../voice/voiceLiveTransport.js');
    const ev = mod.__test.mapTranscriptEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Hi',
      speaker_label: 'speaker_2',
    });
    expect(ev!.diarizationLabel).toBe('speaker_2');
  });

  it('surfaces the diarisation label from nested diarization.speaker', async () => {
    const mod = await import('../voice/voiceLiveTransport.js');
    const ev = mod.__test.mapTranscriptEvent({
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Hi',
      diarization: { speaker: 'speaker_3' },
    });
    expect(ev!.diarizationLabel).toBe('speaker_3');
  });

  it('returns null on unknown event types', async () => {
    const mod = await import('../voice/voiceLiveTransport.js');
    const ev = mod.__test.mapTranscriptEvent({ type: 'response.created' });
    expect(ev).toBeNull();
  });
});

describe('voiceLiveTransport.__test.buildVoiceLiveUrl', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('builds the region-pinned WS URL when VOICELIVE_REGION is set', async () => {
    vi.stubEnv('VOICELIVE_REGION', 'eastus');
    vi.stubEnv('VOICELIVE_ENDPOINT', '');
    const mod = await import('../voice/voiceLiveTransport.js');
    const url = mod.__test.buildVoiceLiveUrl('gpt-realtime');
    expect(url).toBe('wss://eastus.api.voicelive.com/v1/realtime?model=gpt-realtime');
  });

  it('falls back to VOICELIVE_ENDPOINT host when no region is set', async () => {
    vi.stubEnv('VOICELIVE_REGION', '');
    vi.stubEnv('VOICELIVE_ENDPOINT', 'https://my-foundry-project.eastus.api.cognitive.microsoft.com');
    const mod = await import('../voice/voiceLiveTransport.js');
    const url = mod.__test.buildVoiceLiveUrl('gpt-realtime');
    expect(url).toBe('wss://my-foundry-project.eastus.api.cognitive.microsoft.com/openai/v1/realtime?model=gpt-realtime');
  });

  it('throws when neither region nor endpoint is set', async () => {
    vi.stubEnv('VOICELIVE_REGION', '');
    vi.stubEnv('VOICELIVE_ENDPOINT', '');
    const mod = await import('../voice/voiceLiveTransport.js');
    expect(() => mod.__test.buildVoiceLiveUrl('gpt-realtime')).toThrow(
      /VOICELIVE_REGION nor VOICELIVE_ENDPOINT/i,
    );
  });

  it('rejects regions with invalid characters', async () => {
    // After stripping `[^a-z0-9-]`, any region that becomes empty is rejected.
    vi.stubEnv('VOICELIVE_REGION', '!!!');
    vi.stubEnv('VOICELIVE_ENDPOINT', '');
    const mod = await import('../voice/voiceLiveTransport.js');
    expect(() => mod.__test.buildVoiceLiveUrl('gpt-realtime')).toThrow(/invalid/i);
  });
});

// ── acsBridge latency helpers (Phase A KPI capture) ─────────────────────────

describe('acsBridge.__test latency helpers', () => {
  beforeEach(async () => {
    const mod = await import('../voice/acsBridge.js');
    mod.__test.resetLatency();
  });

  it('percentile returns 0 on empty input', async () => {
    const mod = await import('../voice/acsBridge.js');
    expect(mod.__test.percentile([], 50)).toBe(0);
    expect(mod.__test.percentile([], 95)).toBe(0);
  });

  it('median returns the middle sample of a sorted set', async () => {
    const mod = await import('../voice/acsBridge.js');
    expect(mod.__test.median([100, 200, 300])).toBe(200);
  });

  it('percentile(95) approximates the 95th percentile on a uniform set', async () => {
    const mod = await import('../voice/acsBridge.js');
    const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const p95 = mod.__test.percentile(samples, 95);
    expect(p95).toBeGreaterThanOrEqual(95);
    expect(p95).toBeLessThanOrEqual(100);
  });

  it('recordTurnLatency feeds the correct ring buffer per transport', async () => {
    const mod = await import('../voice/acsBridge.js');
    mod.__test.recordTurnLatency('realtime', 100);
    mod.__test.recordTurnLatency('realtime', 200);
    mod.__test.recordTurnLatency('voicelive', 50);
    const kpi = mod.getVoiceBridgeKpi();
    expect(kpi.turnLatencyRealtime.samples).toBe(2);
    expect(kpi.turnLatencyRealtime.medianMs).toBeGreaterThan(0);
    expect(kpi.turnLatencyVoiceLive.samples).toBe(1);
    expect(kpi.turnLatencyVoiceLive.medianMs).toBe(50);
  });

  it('recordTurnLatency rejects non-positive and non-finite values', async () => {
    const mod = await import('../voice/acsBridge.js');
    mod.__test.recordTurnLatency('realtime', 0);
    mod.__test.recordTurnLatency('realtime', -5);
    mod.__test.recordTurnLatency('realtime', Number.NaN);
    mod.__test.recordTurnLatency('realtime', Number.POSITIVE_INFINITY);
    const kpi = mod.getVoiceBridgeKpi();
    expect(kpi.turnLatencyRealtime.samples).toBe(0);
  });

  it('recordTurnLatency caps the ring buffer at the configured window size', async () => {
    const mod = await import('../voice/acsBridge.js');
    // Push 200 samples to exceed the 64-sample window.
    for (let i = 1; i <= 200; i++) mod.__test.recordTurnLatency('realtime', i);
    const kpi = mod.getVoiceBridgeKpi();
    expect(kpi.turnLatencyRealtime.samples).toBeLessThanOrEqual(64);
    // The retained window should hold the most recent 64 samples (137..200).
    expect(kpi.turnLatencyRealtime.medianMs).toBeGreaterThan(160);
  });
});
