// ITSM Operations Digital Worker — Incident Monitor
// Polls ServiceNow every 5 minutes for new P1/P2 incidents, SLA breaches,
// change-incident correlations, and recurring incident patterns.

import { ItsmMcpClient } from './mcp-client';
import { getStandaloneClient } from './client';
import { postToChannel } from './teams-channel';

const mcp = new ItsmMcpClient();
const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
const seenIncidents = new Set<string>();
const seenBreaches = new Set<string>();
const incidentCiCounts = new Map<string, number>(); // Track recurring CIs

async function pollIncidents(): Promise<void> {
  try {
    const incidents = await mcp.getIncidents({ limit: 50 }) as any[];
    if (!Array.isArray(incidents)) return;

    for (const inc of incidents) {
      const num = inc.number || '';
      const priority = inc.priority || '';

      // Alert on new P1/P2 incidents
      if ((priority.includes('1') || priority.includes('2')) && !seenIncidents.has(num)) {
        seenIncidents.add(num);
        const ciName = inc.cmdb_ci?.display_value || inc.cmdb_ci || 'N/A';

        // Check for change-incident correlation
        let correlationMsg = '';
        if (ciName !== 'N/A') {
          try {
            const changes = await mcp.callTool('get-change-requests', { limit: 5 }) as any[];
            if (Array.isArray(changes)) {
              const recentChanges = changes.filter((cr: any) => {
                const crCi = cr.cmdb_ci?.display_value || cr.cmdb_ci || '';
                return crCi === ciName && cr.state === 'Closed';
              });
              if (recentChanges.length > 0) {
                correlationMsg = `\n⚠️ **Change Correlation**: ${recentChanges[0].number} was recently closed on this CI. Investigate for causation.`;
              }
            }
          } catch { /* skip */ }
        }

        // Track recurring CIs
        if (ciName !== 'N/A') {
          const count = (incidentCiCounts.get(ciName) || 0) + 1;
          incidentCiCounts.set(ciName, count);
          if (count >= 3 && count % 3 === 0) {
            correlationMsg += `\n🔁 **Recurring Pattern**: ${count} incidents on ${ciName}. Consider creating a Problem record.`;
          }
        }

        // Auto-triage suggestion
        const category = inc.category || 'Uncategorized';
        const triageMsg = `\n🏷️ **Auto-Triage**: Category: ${category} | Suggested: Escalate to ${inc.assignment_group || 'Service Desk'}`;

        await postToChannel(
          `🚨 **NEW ${priority.includes('1') ? 'P1' : 'P2'} INCIDENT** — ${num}\n` +
          `**${inc.short_description || 'No description'}**\n` +
          `CI: ${ciName} | Category: ${category} | Opened: ${inc.opened_at || 'now'}\n` +
          triageMsg + correlationMsg
        );
      }
    }
  } catch (err) {
    console.error('[IncidentMonitor] Poll error:', err);
  }
}

async function pollSlaBreach(): Promise<void> {
  try {
    const slaResult = await mcp.getSlaDashboard() as any;
    // The dashboard returns structured content; try to extract breach data
    const slaText = typeof slaResult === 'string' ? slaResult : JSON.stringify(slaResult);

    // Check if there are breaches we haven't alerted on
    // This is a simplified check - in production, parse the structured response
    if (slaText.includes('Breached') && !seenBreaches.has(new Date().toISOString().split('T')[0])) {
      seenBreaches.add(new Date().toISOString().split('T')[0]);
      await postToChannel(
        `⏰ **SLA BREACH ALERT** — One or more SLAs have breached.\n` +
        `Use "Show me the SLA dashboard" for details. Escalate affected tickets immediately.`
      );
    }
  } catch (err) {
    console.error('[SLAMonitor] Poll error:', err);
  }
}

export function startIncidentMonitor(): void {
  console.log(`  ✓ Incident Monitor: polling every ${POLL_INTERVAL / 1000}s for P1/P2 incidents, SLA breaches, and correlations`);

  // Initial poll after 30s
  setTimeout(async () => {
    await pollIncidents();
    await pollSlaBreach();
  }, 30000);

  // Regular polling
  setInterval(async () => {
    await pollIncidents();
    await pollSlaBreach();
  }, POLL_INTERVAL);
}
