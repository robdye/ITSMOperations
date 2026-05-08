# Voice path

Alex's voice path lets an operator approve a CAB action, escalate an
incident, or get the morning briefing while their hands are off the
keyboard. There are two voice transports behind a single bridge — the
existing OpenAI **Realtime** WS and the Foundry **Voice Live** preview
WS — and a deterministic intent classifier on top so spoken approvals
make it back through the audit trail with a confidence score.

## Components

```
                ACS Call (PSTN / Teams)
                          │
                          ▼
         ┌─────────────────────────────────┐
         │ acsBridge.ts                    │
         │ - inbound audio → PCM16 24 kHz  │
         │ - outbound TTS → ACS frames     │
         └────────┬────────────────────────┘
                  │
        ┌─────────▼──────────┐         ┌─────────────────┐
        │ voiceLiveTransport │ ◀──────▶│ voiceProxy      │
        │ (Voice Live WS)    │         │ (Realtime WS)   │
        └─────────┬──────────┘         └────────┬────────┘
                  │                             │
                  └──────── one of two ─────────┘
                              ▼
                   transcript event stream
                              │
                              ▼
                 ┌───────────────────────────┐
                 │ voiceApprovals.ts         │
                 │ - classifyVoiceIntent     │
                 │ - approve / deny / hold / │
                 │   unknown + confidence    │
                 └─────────┬─────────────────┘
                           │
                           ▼
                       audit + KPI
```

Modules:

- [`acsBridge.ts`](../digital-worker/src/voice/acsBridge.ts) — Azure
  Communication Services WS bridge.
- [`voiceLiveTransport.ts`](../digital-worker/src/voice/voiceLiveTransport.ts)
  — Voice Live preview WS connector.
- [`voiceProxy.ts`](../digital-worker/src/voice/voiceProxy.ts) — OpenAI
  Realtime WS proxy.
- [`voiceApprovals.ts`](../digital-worker/src/voice/voiceApprovals.ts)
  — intent classifier + audit emission.

## Transport selection

`getSelectedTransport()` reads `process.env.VOICELIVE_TRANSPORT`. The
default is `realtime`. Setting it to `voicelive` swaps to the Foundry
preview path. Any other value falls back to `realtime`.

`buildVoiceLiveUrl(model)` builds the WSS endpoint two ways:

1. If `VOICELIVE_REGION` is set, it builds
   `wss://{region}.api.voicelive.com/v1/realtime?model={model}`. The
   region is sanitised against `[^a-z0-9-]` and rejected if it
   resolves to an empty string.
2. Else if `VOICELIVE_ENDPOINT` is set, it parses the host and builds
   `wss://{host}/openai/v1/realtime?model={model}`.
3. Else it throws — Voice Live can't run without one of those.

## Session config

The Voice Live `session.update` payload mirrors the Realtime contract
plus three preview extensions:

- `voice.diarization.enabled` — turn-by-turn speaker tagging. Driven
  by `VOICELIVE_DIARIZATION` (default `on`).
- `turn_detection.interrupt_response` — barge-in handling. Driven by
  `VOICELIVE_INTERRUPTION` (default `on`).
- `voice.id` — HD / Dragon voice ids (e.g.
  `en-US-Ava:DragonHDLatestNeural`). Driven by `VOICELIVE_VOICE_ID`.

Audio is locked at PCM16 24 kHz on both input and output so callers
don't have to resample between ACS and Voice Live.

## Intent classifier

`classifyVoiceIntent(utterance)` is a deterministic regex-based
classifier. It returns `{ intent, confidence }` where `intent ∈
{ approve | deny | hold | unknown }` and `confidence ∈ [0, 1]`.

### Approve phrases (sample)

`approve`, `approved`, `proceed`, `go ahead`, `confirm`, `confirmed`,
`affirmative`, `looks good`, `signed off`, `ship it`.

### Deny phrases

`reject`, `rejected`, `deny`, `denied`, `decline`, `cancel`, `abort`,
`stop`, `kill it`, `negative`, `no go`.

### Hold phrases

`hold`, `wait`, `pause`, `defer`, `park`, `not yet`, `give me a
minute`, `check back`.

### Negation handling

A leading negation (`don't`, `do not`, `never`, `cannot`, `won't`)
**flips the verdict to `unknown`** rather than auto-flipping to deny.
This is the safe default — it forces a re-prompt when the audio is
ambiguous (`"no, don't approve that"` is more likely a dropped frame
than a deny). The one exception: if a deny phrase is also present
(`don't proceed, cancel it`) we resolve to deny.

### Confidence levels

| Path | Confidence |
| --- | --- |
| Negation + deny phrase present | 0.7 |
| Negation, no deny phrase | 0.0 (caller should re-prompt) |
| Deny phrase | 0.85 |
| Hold phrase | 0.8 |
| Approve phrase | 0.85 |
| No phrase match | 0.0 |

The bridge requires `confidence ≥ 0.7` before acting on an approval,
and emits the intent + confidence on every audit row regardless.

## NIST 800-53 risk mapping

- IA-2 (identification and authentication of users): the operator's
  voice sample is correlated with their AAD object id via
  `processVoiceApproval(utterance, ctx)` where `ctx.aadOid` is set
  from the ACS call hand-off.
- AU-2 / AU-3: every utterance — including `unknown` — emits an
  `auditTrail` entry so the call recording is matched to a structured
  decision.
- AC-3: voice approvals can only act on items already in the user's
  pending queue (looked up via `userId` or `aadOid`).
- SC-13: PCM16 24 kHz is end-to-end inside the ACS / Voice Live
  control plane, so the audio never lands in long-term storage in the
  clear.

## KPI surface

`getVoiceApprovalKpi()` returns:

```ts
{
  utterancesProcessed: number;
  resolved: number;
  resolutionRate: number;        // resolved / utterancesProcessed
  byIntent: { approve: number; deny: number; hold: number; unknown: number };
  uptimeSec: number;
}
```

Mission Control's **Voice Queue** panel polls `/api/voice/kpi` every
5 seconds.

## Operator runbook

- **Switch to Voice Live**: set `VOICELIVE_TRANSPORT=voicelive` and
  one of `VOICELIVE_REGION` (preferred) or `VOICELIVE_ENDPOINT`.
  Restart the digital-worker container.
- **Switch back**: unset `VOICELIVE_TRANSPORT`. Restart.
- **Disable barge-in / diarisation**: set
  `VOICELIVE_INTERRUPTION=off` or `VOICELIVE_DIARIZATION=off`. Each
  is independent.
- **Tune confidence threshold**: not exposed via env — change the
  threshold in `processVoiceApproval` (search for `confidence < 0.7`).
- **Investigate a missed approval**: filter the audit table for
  `WorkerId == 'voice-approvals'` over the call window. Each row
  carries the original utterance, classifier verdict, and confidence
  so you can replay the classification offline.

## Tests

- 7 smoke tests in
  [`__tests__/voiceApprovals.test.ts`](../digital-worker/src/__tests__/voiceApprovals.test.ts)
  covering all 4 intent paths, negation, empty / nonsense input, and
  confidence range invariants.
- 9 smoke tests in
  [`__tests__/voiceLiveTransport.test.ts`](../digital-worker/src/__tests__/voiceLiveTransport.test.ts)
  covering `getSelectedTransport`, `buildVoiceLiveUrl` for both region
  and endpoint paths, invalid region rejection, default model, and the
  PCM16 24 kHz session-update payload.
- The full call-flow (ACS bridge ↔ transport ↔ approvals) is covered
  by the Playwright integration suite in `digital-worker/tests/`.
