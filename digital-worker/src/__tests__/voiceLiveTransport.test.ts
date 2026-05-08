// Phase 4 — voiceLiveTransport smoke tests.
//
// Exercises the env-driven URL builder and the transport selector.
// Module-load constants (VOICELIVE_REGION etc.) are captured at import
// time, so we use vi.resetModules + dynamic imports to drive different
// env permutations.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('voiceLiveTransport: getSelectedTransport', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.VOICELIVE_TRANSPORT;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults to "realtime" when VOICELIVE_TRANSPORT is unset', async () => {
    const { getSelectedTransport } = await import('../voice/voiceLiveTransport');
    expect(getSelectedTransport()).toBe('realtime');
  });

  it('returns "voicelive" when VOICELIVE_TRANSPORT=voicelive', async () => {
    process.env.VOICELIVE_TRANSPORT = 'voicelive';
    const { getSelectedTransport } = await import('../voice/voiceLiveTransport');
    expect(getSelectedTransport()).toBe('voicelive');
  });

  it('falls back to realtime for any unknown value', async () => {
    process.env.VOICELIVE_TRANSPORT = 'something-else';
    const { getSelectedTransport } = await import('../voice/voiceLiveTransport');
    expect(getSelectedTransport()).toBe('realtime');
  });
});

describe('voiceLiveTransport: buildVoiceLiveUrl', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.VOICELIVE_REGION;
    delete process.env.VOICELIVE_ENDPOINT;
    delete process.env.VOICELIVE_MODEL;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('builds a region-style WSS URL when VOICELIVE_REGION is set', async () => {
    process.env.VOICELIVE_REGION = 'eastus2';
    const { buildVoiceLiveUrl } = await import('../voice/voiceLiveTransport');
    const url = buildVoiceLiveUrl('gpt-realtime');
    expect(url).toBe('wss://eastus2.api.voicelive.com/v1/realtime?model=gpt-realtime');
  });

  it('falls back to VOICELIVE_ENDPOINT when no region is set', async () => {
    process.env.VOICELIVE_ENDPOINT = 'https://my-foundry.cognitiveservices.azure.com/';
    const { buildVoiceLiveUrl } = await import('../voice/voiceLiveTransport');
    const url = buildVoiceLiveUrl('gpt-realtime');
    expect(url).toContain('wss://my-foundry.cognitiveservices.azure.com');
    expect(url).toContain('/openai/v1/realtime');
    expect(url).toContain('model=gpt-realtime');
  });

  it('throws when neither region nor endpoint is set', async () => {
    const { buildVoiceLiveUrl } = await import('../voice/voiceLiveTransport');
    expect(() => buildVoiceLiveUrl()).toThrow(/VOICELIVE_REGION nor VOICELIVE_ENDPOINT/);
  });

  it('rejects an invalid region containing only special characters', async () => {
    process.env.VOICELIVE_REGION = '!!!';
    const { buildVoiceLiveUrl } = await import('../voice/voiceLiveTransport');
    expect(() => buildVoiceLiveUrl()).toThrow(/invalid/);
  });

  it('uses the default model when none is provided', async () => {
    process.env.VOICELIVE_REGION = 'eastus2';
    process.env.VOICELIVE_MODEL = 'gpt-4o-realtime-preview';
    const { buildVoiceLiveUrl } = await import('../voice/voiceLiveTransport');
    const url = buildVoiceLiveUrl();
    expect(url).toContain('model=gpt-4o-realtime-preview');
  });
});

describe('voiceLiveTransport: __test internals', () => {
  it('exposes the documented test helpers', async () => {
    process.env.VOICELIVE_REGION = 'eastus2';
    vi.resetModules();
    const { __test } = await import('../voice/voiceLiveTransport');
    expect(typeof __test.buildSessionUpdate).toBe('function');
    expect(typeof __test.mapTranscriptEvent).toBe('function');
    expect(typeof __test.buildVoiceLiveUrl).toBe('function');
    expect(__test.AUDIO_SAMPLE_RATE_HZ).toBe(24_000);
  });

  it('builds a session.update with PCM16 input/output formats', async () => {
    process.env.VOICELIVE_REGION = 'eastus2';
    vi.resetModules();
    const { __test } = await import('../voice/voiceLiveTransport');
    const update = __test.buildSessionUpdate({
      instructions: 'You are Alex.',
      voice: 'en-US-Ava:DragonHDLatestNeural',
    }) as {
      type: string;
      session: {
        audio: {
          input: { format: { type: string; rate: number } };
          output: { format: { type: string; rate: number }; voice: { id: string } };
        };
      };
    };
    expect(update.type).toBe('session.update');
    expect(update.session.audio.input.format.type).toBe('audio/pcm');
    expect(update.session.audio.input.format.rate).toBe(24_000);
    expect(update.session.audio.output.format.rate).toBe(24_000);
    expect(update.session.audio.output.voice.id).toBe('en-US-Ava:DragonHDLatestNeural');
  });
});
