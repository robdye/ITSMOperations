// ITSM Operations Digital Worker — WorkIQ MCP Client
// Connects to Microsoft WorkIQ MCP server for M365 data: emails, meetings, Teams, people, org charts

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  WorkIqApiClient,
  recordWorkIqAttempt,
  type IWorkIqClient,
} from './workiq-api-client';

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

/**
 * The upstream @microsoft/workiq MCP package appends an EULA acceptance
 * banner to every response, e.g.:
 *   "---\n**Important:** Continued usage of this tool constitutes acceptance
 *    of the End User License Agreement (EULA) found at https://github.com/...
 *    You must accept the EULA before continuing."
 * That noise leaks into Alex's voice transcripts and makes her tell users
 * they need to accept a EULA. Strip it out before returning.
 */
function stripWorkIqBanner(text: string): string {
  if (!text) return text;
  // Remove the trailing horizontal-rule + EULA paragraph block, however
  // far back the rule sits.
  return text
    .replace(/\n*-{3,}\s*\n+\*\*Important:\*\*[\s\S]*$/i, '')
    .replace(/\n*\*\*Important:\*\*[^\n]*EULA[\s\S]*$/i, '')
    .replace(/\n*Continued usage of this tool constitutes[\s\S]*$/i, '')
    .replace(/\n*You must accept the EULA[\s\S]*$/i, '')
    .trim();
}

async function callWorkIq(question: string): Promise<string> {
  try {
    const client = await getClient();
    const result = await client.callTool({ name: 'ask_work_iq', arguments: { question } });
    const content = result.content as Array<{ type: string; text?: string }>;
    if (content && content.length > 0 && content[0].text) {
      recordWorkIqAttempt('mcp', true);
      return stripWorkIqBanner(content[0].text);
    }
    recordWorkIqAttempt('mcp', true);
    return stripWorkIqBanner(JSON.stringify(result));
  } catch (err) {
    recordWorkIqAttempt('mcp', false, (err as Error).message);
    throw err;
  }
}

export class WorkIqClient implements IWorkIqClient {
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

// ── Transport selector ──
//
// Phase 1.6 — `WORKIQ_TRANSPORT=mcp|api` (default `mcp`). Returns a
// process-singleton implementing `IWorkIqClient`. Callers should not
// `new WorkIqClient()` directly — go through `getWorkIqClient()` so the
// transport flag is honoured and KPIs land on the right counter.
let activeClient: IWorkIqClient | null = null;

export function getWorkIqClient(): IWorkIqClient {
  if (activeClient) return activeClient;
  const transport = (process.env.WORKIQ_TRANSPORT || 'mcp').toLowerCase();
  if (transport === 'api') {
    activeClient = new WorkIqApiClient();
  } else {
    activeClient = new WorkIqClient();
  }
  return activeClient;
}

export function getActiveWorkIqTransport(): 'mcp' | 'api' {
  return (process.env.WORKIQ_TRANSPORT || 'mcp').toLowerCase() === 'api' ? 'api' : 'mcp';
}
