// ITSM Operations — Workflow completion notifier
//
// Customer requirement: "when RCAs or any tasks happen it should send me
// an email or teams messages". Fires after a high-touch workflow reaches a
// terminal state (completed or failed) so the operator gets a real-time
// pulse without having to watch Mission Control.
//
// Notifications go to BOTH channels (best-effort, never blocks the engine):
//   - Teams 1:1 card via engageOperator('scenario-complete', ctx)
//   - Styled email via renderBriefingEmail + sendGraphMail to MANAGER_EMAIL
//
// Gated on a curated allow-list so we don't spam on every synthetic
// cognition-tag workflow.

import type { Signal } from './signal-router';
import type { WorkflowResult } from './workflow-engine';
// engageOperator + renderBriefingEmail + sendGraphMail are imported
// lazily inside notifyOnCompletion() so that this module's top-level
// import graph stays tiny. Pulling them in eagerly would drag in
// proactive-engagement → agent → worker-registry → worker-definitions,
// which breaks vi.mock('../worker-definitions') in workflow-engine tests.

/** Workflows the operator wants to know about when they finish. */
const NOTIFY_ON_COMPLETE = new Set<string>([
  'reasoning-rca',
  'major-incident-response',
  'major-incident-response-dag',
  'change-lifecycle',
  'vulnerability-to-change',
  'incident-to-problem',
  'knowledge-harvest',
  'sla-breach-escalation',
]);

const FRIENDLY_NAMES: Record<string, string> = {
  'reasoning-rca': 'Root Cause Analysis',
  'major-incident-response': 'Major Incident Response',
  'major-incident-response-dag': 'Major Incident Response',
  'change-lifecycle': 'Change Lifecycle',
  'vulnerability-to-change': 'Vulnerability → Change',
  'incident-to-problem': 'Incident → Problem',
  'knowledge-harvest': 'Knowledge Harvest',
  'sla-breach-escalation': 'SLA Breach Escalation',
};

export interface CompletionContext {
  workflowId: string;
  executionId: string;
  signal?: Signal;
  result: WorkflowResult;
  outcomeLabel?: string;
}

/**
 * Fire Teams + email notifications when a high-touch workflow finishes.
 * Safe to call in any path — silently no-ops for workflows not in the
 * allow-list and swallows all errors so it can never crash the engine.
 */
export async function notifyOnCompletion(ctx: CompletionContext): Promise<void> {
  if (!NOTIFY_ON_COMPLETE.has(ctx.workflowId)) return;

  const friendly = FRIENDLY_NAMES[ctx.workflowId] || ctx.workflowId;
  const passed = ctx.result.status === 'completed';
  const outcomeEmoji = passed ? '✅' : '⚠️';
  const outcomeWord = passed ? 'completed' : 'finished with issues';
  const assetLine = ctx.signal?.asset ? `\n- **Asset:** ${ctx.signal.asset}` : '';
  const sevLine = ctx.signal?.severity ? `\n- **Severity:** ${ctx.signal.severity}` : '';
  const sourceLine = ctx.signal?.source ? `\n- **Source:** ${ctx.signal.source}` : '';
  const outcomeLine = ctx.outcomeLabel ? `\n- **Outcome verification:** ${ctx.outcomeLabel}` : '';
  const finalLine = ctx.result.finalOutput
    ? `\n\n**What happened**\n\n${truncate(ctx.result.finalOutput, 800)}`
    : '';

  const summary =
    `${outcomeEmoji} ${friendly} ${outcomeWord} for ${ctx.signal?.asset || ctx.signal?.id || ctx.executionId}. ` +
    `Open Mission Control to see the full trace.`;

  // ── Teams card (best-effort) ──
  try {
    const { engageOperator } = await import('./proactive-engagement');
    await engageOperator('scenario-complete', {
      scenarioId: ctx.workflowId,
      ctxKey: ctx.executionId,
      summary,
    });
  } catch (err) {
    console.warn('[CompletionNotifier] Teams engage failed:', (err as Error).message);
  }

  // ── Email (best-effort) ──
  const to = process.env.MANAGER_EMAIL || process.env.OWNER_EMAIL || '';
  if (!to) return;
  const host = (process.env.PUBLIC_HOSTNAME || '').replace(/\/$/, '');
  const ctaButtons: Array<{ label: string; url: string; accent?: string }> = [];
  if (host) {
    ctaButtons.push({
      label: '🧭 Open Mission Control',
      url: `https://${host}/mission-control.html`,
      accent: '#0078d4',
    });
    if (ctx.signal?.id) {
      ctaButtons.push({
        label: '📜 View trace',
        url: `https://${host}/mission-control.html#executions`,
        accent: '#107c10',
      });
    }
  }

  const md = `### ${friendly} ${outcomeWord}

- **Workflow:** \`${ctx.workflowId}\`
- **Execution id:** \`${ctx.executionId}\`${sourceLine}${assetLine}${sevLine}${outcomeLine}${finalLine}

> ${passed
    ? 'No action required from you — Alex has logged the evidence pack and updated the source-of-truth systems.'
    : 'Alex hit an issue and needs your attention. Open the trace for the full step-by-step.'}`;

  try {
    const { renderBriefingEmail } = await import('./email-render');
    const { sendEmail: sendGraphMail } = await import('./graph-mail');
    const html = renderBriefingEmail({
      title: `${friendly} ${outcomeWord}`,
      subtitle: ctx.signal?.id ? `Triggered by ${ctx.signal.source}: ${ctx.signal.id}` : undefined,
      emoji: outcomeEmoji,
      accent: passed ? '#107c10' : '#d83b01',
      markdown: md,
      ctaButtons,
      footerNote: `Auto-notify · ${friendly} · ${new Date().toISOString()}`,
    });
    await sendGraphMail({
      to: [to],
      subject: `${outcomeEmoji} ${friendly} ${outcomeWord} — ${ctx.signal?.asset || ctx.signal?.id || ctx.executionId}`,
      body: html,
      isHtml: true,
      importance: passed ? 'normal' : 'high',
    });
  } catch (err) {
    console.warn('[CompletionNotifier] email send failed:', (err as Error).message);
  }
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
