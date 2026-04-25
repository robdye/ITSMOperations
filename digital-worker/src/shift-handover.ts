// ITSM Operations Digital Worker — Shift Handover Briefing Scheduler
// Handover is now triggered externally by Azure Durable Functions timer triggers
// via HTTP POST to /api/scheduled with { routineId: 'shift-handover' }.

import { ItsmMcpClient } from './mcp-client';
import { getStandaloneClient } from './client';
import { sendEmail } from './email-service';
import { postToChannel } from './teams-channel';

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
