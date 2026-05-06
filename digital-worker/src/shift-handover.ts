// ITSM Operations Digital Worker — Shift Handover Briefing Scheduler
// Handover is now triggered externally by Azure Durable Functions timer triggers
// via HTTP POST to /api/scheduled with { routineId: 'shift-handover' }.
//
// Phase 3.6 — Two briefings per shift:
//   1) "handover"     — full handover at shift change.
//   2) "midshift"     — lighter midshift recap (default 4h after handover).

import { ItsmMcpClient } from './mcp-client';
import { getStandaloneClient } from './client';
import { sendEmail } from './email-service';
import { postToChannel } from './teams-channel';
import { listOpenCases } from './case-manager';
import { getRecentMetaAlerts } from './meta-monitor';

const mcp = new ItsmMcpClient();

const HANDOVER_PROMPT = `Generate a shift handover briefing for the incoming ITSM operations team. Based on the data below, create a structured briefing with:

1. **Critical Alerts** — Any P1/P2 incidents requiring immediate attention
2. **SLA Status** — Which SLAs are breached or at risk of breaching
3. **Change Window** — Any changes in progress or scheduled in the next 12 hours
4. **Problem Updates** — Known errors with active workarounds
5. **Escalation Status** — What's been escalated and to whom
6. **Overnight Summary** — Key events from the last 12 hours
7. **Action Items** — Top 5 priorities for the incoming shift

Format as a concise executive briefing. Use real ticket numbers, CI names, and timestamps.`;

export async function generateHandover(): Promise<void> {
  console.log('[Handover] Generating shift handover briefing...');
  try {
    // Gather data from all ITSM practices
    const [incidentData, slaData, changeData, problemData] = await Promise.all([
      mcp.getIncidents({ limit: 30 }).catch(() => []),
      mcp.getSlaDashboard().catch(() => null),
      mcp.getChangeBriefing().catch(() => null),
      mcp.getProblems().catch(() => null),
    ]);

    const context = `
CURRENT ITSM STATE:
Incidents: ${JSON.stringify(incidentData).substring(0, 3000)}
SLA Data: ${typeof slaData === 'string' ? slaData.substring(0, 1500) : JSON.stringify(slaData).substring(0, 1500)}
Change Status: ${typeof changeData === 'string' ? changeData.substring(0, 1500) : JSON.stringify(changeData).substring(0, 1500)}
Problems: ${typeof problemData === 'string' ? problemData.substring(0, 1500) : JSON.stringify(problemData).substring(0, 1500)}
`;

    const client = await getStandaloneClient();
    const briefing = await client.invokeAgentWithScope(HANDOVER_PROMPT + '\n\n' + context);

    // Send email to manager
    const managerEmail = process.env.MANAGER_EMAIL || '';
    if (managerEmail) {
      await sendEmail(managerEmail, `ITSM Shift Handover — ${new Date().toLocaleDateString()}`, `<pre style="font-family:Segoe UI,sans-serif">${briefing}</pre>`);
    }

    // Post to Teams channel
    await postToChannel(`📋 **Shift Handover Briefing** — ${new Date().toLocaleTimeString()}\n\n${briefing}`);

    console.log('[Handover] Briefing generated and distributed');
  } catch (err) {
    console.error('[Handover] Error:', err);
  }
}

export function startHandoverScheduler(): void {
  console.log('  ✓ Shift Handover: triggered externally via /api/scheduled');
}

export function stopHandoverScheduler(): void {
  console.log('  Shift Handover Scheduler: no in-process jobs to stop');
}

// ── Phase 3.6 — Midshift recap ──

const MIDSHIFT_PROMPT = `Generate a concise MIDSHIFT recap for the on-duty ITSM operations team. Keep it brief (10-15 lines max). Cover:

1. **What's new since handover** — incidents/changes opened/closed
2. **Open cases needing attention** — list by case id and state
3. **Reviewer/meta alerts** — anything Alex flagged about her own behaviour
4. **Recommended focus for the next 4 hours** — top 3 items

Be direct and operational. No fluff.`;

const briefingKpi = {
  handovers: 0,
  midshifts: 0,
  startedAt: Date.now(),
};

export function getBriefingKpi(): {
  handovers: number;
  midshifts: number;
  briefingsPerShift: number;
  uptimeSec: number;
} {
  const uptimeMs = Date.now() - briefingKpi.startedAt;
  const shifts = Math.max(1, uptimeMs / (8 * 3600 * 1000));
  return {
    handovers: briefingKpi.handovers,
    midshifts: briefingKpi.midshifts,
    briefingsPerShift: Math.round(((briefingKpi.handovers + briefingKpi.midshifts) / shifts) * 100) / 100,
    uptimeSec: Math.round(uptimeMs / 1000),
  };
}

export async function generateMidshiftRecap(): Promise<void> {
  console.log('[Handover] Generating midshift recap...');
  briefingKpi.midshifts += 1;
  try {
    const [openCases, alerts, incidentData] = await Promise.all([
      listOpenCases().catch(() => []),
      Promise.resolve(getRecentMetaAlerts(5)),
      mcp.getIncidents({ limit: 15 }).catch(() => []),
    ]);

    const context = `
MIDSHIFT CONTEXT:
Open cases: ${openCases.length}
Recent meta-alerts: ${alerts.length}
Recent alerts detail: ${JSON.stringify(alerts).substring(0, 1000)}
Open case summaries: ${JSON.stringify(openCases.slice(0, 10).map((c) => ({ id: c.id, state: c.state, owner: c.ownerWorkerId, subject: c.subjectRef }))).substring(0, 1500)}
Recent incidents: ${JSON.stringify(incidentData).substring(0, 1500)}
`;

    const client = await getStandaloneClient();
    const briefing = await client.invokeAgentWithScope(MIDSHIFT_PROMPT + '\n\n' + context);

    const managerEmail = process.env.MANAGER_EMAIL || '';
    if (managerEmail) {
      await sendEmail(managerEmail, `ITSM Midshift Recap — ${new Date().toLocaleString()}`, `<pre style="font-family:Segoe UI,sans-serif">${briefing}</pre>`);
    }
    await postToChannel(`☕ **Midshift Recap** — ${new Date().toLocaleTimeString()}\n\n${briefing}`);
    console.log('[Handover] Midshift recap distributed');
  } catch (err) {
    console.error('[Handover] Midshift error:', err);
  }
}

// Augment generateHandover counter without touching its impl by wrapping.
const _originalGenerate = generateHandover;
export async function generateHandoverCounted(): Promise<void> {
  briefingKpi.handovers += 1;
  return _originalGenerate();
}
