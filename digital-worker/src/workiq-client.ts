// ITSM Operations Digital Worker — WorkIQ MCP Client
// Connects to Microsoft WorkIQ MCP server for M365 data: emails, meetings, Teams, people, org charts

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let mcpClient: Client | null = null;
let connecting = false;

async function getClient(): Promise<Client> {
  if (mcpClient) return mcpClient;
  if (connecting) {
    // Wait for in-flight connection
    while (connecting) await new Promise(r => setTimeout(r, 200));
    if (mcpClient) return mcpClient;
  }

  connecting = true;
  try {
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@microsoft/workiq@latest', 'mcp'],
      env: {
        ...process.env,
        ...(process.env.WORKIQ_TENANT_ID ? { WORKIQ_TENANT_ID: process.env.WORKIQ_TENANT_ID } : {}),
      },
    });

    const client = new Client({ name: 'itsm-digital-worker', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
    mcpClient = client;
    console.log('[WorkIQ] MCP client connected');
    return client;
  } catch (err) {
    console.error('[WorkIQ] Failed to connect:', err);
    throw err;
  } finally {
    connecting = false;
  }
}

async function callWorkIq(question: string): Promise<string> {
  const client = await getClient();
  const result = await client.callTool({ name: 'ask_work_iq', arguments: { question } });
  const content = result.content as Array<{ type: string; text?: string }>;
  if (content && content.length > 0 && content[0].text) {
    return content[0].text;
  }
  return JSON.stringify(result);
}

export class WorkIqClient {
  // ── Email ──
  async searchEmails(query: string): Promise<string> {
    return callWorkIq(`Search my emails for: ${query}`);
  }

  async getEmailsAboutIncident(incidentId: string): Promise<string> {
    return callWorkIq(`Find all emails mentioning incident ${incidentId} or related discussions`);
  }

  async getEmailsAboutChange(changeNumber: string): Promise<string> {
    return callWorkIq(`Find all emails about change request ${changeNumber}`);
  }

  // ── Meetings & Calendar ──
  async getUpcomingMeetings(timeframe?: string): Promise<string> {
    return callWorkIq(`What meetings do I have ${timeframe || 'this week'}?`);
  }

  async findCabMeetings(): Promise<string> {
    return callWorkIq('Find any upcoming Change Advisory Board (CAB) meetings or change review meetings');
  }

  async getMeetingDetails(meetingSubject: string): Promise<string> {
    return callWorkIq(`Get details about the meeting: ${meetingSubject}`);
  }

  // ── Teams Messages ──
  async searchTeamsMessages(query: string): Promise<string> {
    return callWorkIq(`Search Teams messages for: ${query}`);
  }

  async getChannelActivity(channelName: string): Promise<string> {
    return callWorkIq(`Summarize recent activity in the ${channelName} Teams channel`);
  }

  async getItOpsChannelAlerts(): Promise<string> {
    return callWorkIq('Summarize recent messages in IT Operations, Incidents, or Service Desk Teams channels');
  }

  // ── People & Org ──
  async lookupPerson(name: string): Promise<string> {
    return callWorkIq(`Who is ${name}? Show their role, department, and contact info`);
  }

  async getOrgChart(name: string): Promise<string> {
    return callWorkIq(`Show the org chart for ${name}`);
  }

  async findExpertFor(topic: string): Promise<string> {
    return callWorkIq(`Who in the organization is an expert on ${topic}? Who has been involved in related discussions?`);
  }

  // ── Documents ──
  async searchDocuments(query: string): Promise<string> {
    return callWorkIq(`Find documents related to: ${query}`);
  }

  async findRunbook(system: string): Promise<string> {
    return callWorkIq(`Find runbooks, procedures, or documentation for ${system}`);
  }

  // ── Productivity Insights ──
  async extractActionItems(meetingSubject: string): Promise<string> {
    return callWorkIq(`Extract action items from the meeting: ${meetingSubject}`);
  }

  async triageInbox(): Promise<string> {
    return callWorkIq('Give me a quick triage of my inbox — what needs attention today?');
  }

  async getMeetingCosts(timeframe?: string): Promise<string> {
    return callWorkIq(`How much time did I spend in meetings ${timeframe || 'this week'}?`);
  }

  // ── General query ──
  async query(question: string): Promise<string> {
    return callWorkIq(question);
  }
}
