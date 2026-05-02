// ITSM Operations — LLM-as-Judge for Outcome Verifier (Phase 9.2)
//
// Replaces the default status->label probe with a structured grader that
// reads the workflow result, the originating signal, and any rollback
// evidence, then returns a calibrated outcome label with rationale and
// per-dimension scores. This lets the autonomy-tuner learn from *quality*
// of resolution, not just terminal status (e.g. an incident workflow that
// completed=true but did not actually restore service is now correctly
// graded `partial` or `failure`).
//
// Uses LLM-as-judge per artefact. For ITSM the dimensions are:
//   - serviceRestored:  was the asserted outcome actually achieved?
//   - rootCauseClear:   was a probable cause identified?
//   - communicationDone: were stakeholders informed?
//   - rollbackSafe:     if rolled back, was the rollback evidence clean?
//
// Falls back to the default status-only probe whenever the model is
// unavailable, the call throws, or the response cannot be parsed. Never
// silently mislabels.

import { Agent, run } from '@openai/agents';
import type { VerifierProbe, VerifierProbeResult, VerifierContext } from './outcome-verifier';
import type { OutcomeLabel } from './outcome-verifier';

const JUDGE_MODEL = process.env.OUTCOME_JUDGE_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

const JUDGE_INSTRUCTIONS = `
You are a senior ITSM engineering judge. Read the workflow result and the
originating signal. Decide whether the workflow actually achieved its
intended ITSM outcome.

Output STRICT JSON only, no prose, with this shape:
{
  "label": "success" | "partial" | "failure" | "inconclusive",
  "score": <number 0..1>,
  "dimensions": {
    "serviceRestored": <0..1>,
    "rootCauseClear": <0..1>,
    "communicationDone": <0..1>,
    "rollbackSafe": <0..1>
  },
  "rationale": "<one or two sentences explaining the label>"
}

Rules:
- If the workflow status is 'failed' OR 'cancelled', label cannot be 'success'.
- If service is clearly restored AND there is no evidence of rework needed, label = 'success'.
- If only partial mitigation is documented (e.g. workaround applied), label = 'partial'.
- If the workflow status is 'completed' but the result text indicates lingering issues, label = 'partial' or 'failure'.
- If you cannot tell from the evidence, label = 'inconclusive' with a low score.
`;

export interface LLMJudgeOptions {
  /** Override the model id. Defaults to OUTCOME_JUDGE_MODEL or OPENAI_MODEL. */
  model?: string;
  /** Override the timeout (ms). Default 8s — judge must not stall the loop. */
  timeoutMs?: number;
}

interface JudgeResponse {
  label: OutcomeLabel;
  score?: number;
  dimensions?: Record<string, number>;
  rationale?: string;
}

function safeStringify(value: unknown, maxLen = 4000): string {
  try {
    const s = JSON.stringify(value, null, 2);
    return s.length > maxLen ? s.slice(0, maxLen) + '...<truncated>' : s;
  } catch {
    return String(value);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`judge timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

function parseJudgeResponse(raw: string): JudgeResponse | null {
  // Models sometimes wrap JSON in fences — be tolerant.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as JudgeResponse;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!['success', 'partial', 'failure', 'inconclusive'].includes(parsed.label)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build a probe that asks an OpenAI judge to grade the workflow outcome.
 * Returns a function compatible with `registerProbe(workflowId, probe)`.
 */
export function buildLLMJudgeProbe(opts: LLMJudgeOptions = {}): VerifierProbe {
  const model = opts.model || JUDGE_MODEL;
  const timeoutMs = opts.timeoutMs ?? 8000;

  return async (ctx: VerifierContext): Promise<VerifierProbeResult> => {
    const evidence = {
      signal: ctx.signal
        ? {
            id: ctx.signal.id,
            type: ctx.signal.type,
            severity: ctx.signal.severity,
            asset: ctx.signal.asset,
            payload: ctx.signal.payload,
          }
        : null,
      workflow: {
        id: ctx.workflowId,
        executionId: ctx.executionId,
        status: ctx.workflowResult?.status,
        steps: (ctx.workflowResult as any)?.steps?.slice?.(-12) ?? [],
        outputs: (ctx.workflowResult as any)?.outputs ?? {},
        error: (ctx.workflowResult as any)?.error,
      },
    };

    try {
      const judge = new Agent({
        name: 'ITSM Outcome Judge',
        instructions: JUDGE_INSTRUCTIONS,
        model,
      });
      const userPrompt = `Grade this ITSM workflow outcome.\n\nEVIDENCE:\n${safeStringify(evidence)}\n\nReturn JSON only.`;
      const result = await withTimeout(run(judge, userPrompt), timeoutMs);
      const text = (result as any)?.finalOutput ?? (result as any)?.output_text ?? '';
      const judged = parseJudgeResponse(typeof text === 'string' ? text : JSON.stringify(text));
      if (!judged) {
        return {
          label: 'inconclusive',
          notes: 'judge: unparseable response, falling back',
          metrics: { judgeOk: 0 },
        };
      }
      return {
        label: judged.label,
        notes: `judge[${model}]: ${judged.rationale ?? ''}`,
        metrics: {
          judgeOk: 1,
          judgeScore: typeof judged.score === 'number' ? judged.score : 0,
          ...(judged.dimensions ?? {}),
        },
      };
    } catch (err: any) {
      return {
        label: 'inconclusive',
        notes: `judge error: ${err?.message ?? 'unknown'} — using inconclusive`,
        metrics: { judgeOk: 0 },
      };
    }
  };
}

/**
 * True when LLM judge can be used. Currently checks for an OpenAI key on env.
 * Treat as defensive — call the probe inside a try/catch even when this is
 * true, since model failures can still happen at runtime.
 */
export function llmJudgeAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY);
}
