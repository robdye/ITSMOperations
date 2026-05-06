// ITSM Operations — WorkIQ API client
//
// Phase 1.6 — REST/HTTP transport for WorkIQ that mirrors the MCP-stdio
// client surface in `workiq-client.ts`. Selected at runtime via the
// `WORKIQ_TRANSPORT` env var:
//   - `mcp`  (default) → stdio MCP client (legacy)
//   - `api`            → this client (HTTPS REST)
//
// The two clients implement the same `IWorkIqClient` shape, so callers
// can swap transports without changing call sites.
//
// Auth: bearer token from `DefaultAzureCredential` against the scope in
// `WORKIQ_API_SCOPE` (default
// `https://graph.microsoft.com/.default`). When `WORKIQ_API_TOKEN` is
// set we use it directly (test/CI overrides).

import { DefaultAzureCredential, type AccessToken } from '@azure/identity';

export interface IWorkIqClient {
  searchEmails(query: string): Promise<string>;
  getEmailsAboutIncident(incidentId: string): Promise<string>;
  getEmailsAboutChange(changeNumber: string): Promise<string>;
  getUpcomingMeetings(timeframe?: string): Promise<string>;
  findCabMeetings(): Promise<string>;
  getMeetingDetails(meetingSubject: string): Promise<string>;
  searchTeamsMessages(query: string): Promise<string>;
  getChannelActivity(channelName: string): Promise<string>;
  getItOpsChannelAlerts(): Promise<string>;
  lookupPerson(name: string): Promise<string>;
  getOrgChart(name: string): Promise<string>;
  findExpertFor(topic: string): Promise<string>;
  searchDocuments(query: string): Promise<string>;
  findRunbook(system: string): Promise<string>;
  extractActionItems(meetingSubject: string): Promise<string>;
  triageInbox(): Promise<string>;
  getMeetingCosts(timeframe?: string): Promise<string>;
  query(question: string): Promise<string>;
}

const DEFAULT_BASE = process.env.WORKIQ_API_BASE || 'https://workiq.microsoft.com/api/v1';
const DEFAULT_SCOPE = process.env.WORKIQ_API_SCOPE || 'https://graph.microsoft.com/.default';

let cachedCred: DefaultAzureCredential | null = null;
let cachedToken: AccessToken | null = null;

async function getBearer(): Promise<string> {
  if (process.env.WORKIQ_API_TOKEN) return process.env.WORKIQ_API_TOKEN;
  if (!cachedCred) cachedCred = new DefaultAzureCredential();
  // 60s margin so the token doesn't expire mid-flight.
  const now = Date.now();
  if (!cachedToken || cachedToken.expiresOnTimestamp - now < 60_000) {
    cachedToken = await cachedCred.getToken(DEFAULT_SCOPE);
    if (!cachedToken) throw new Error('Failed to acquire WorkIQ API token');
  }
  return cachedToken.token;
}

// ── KPI counters (Phase 1.6 — single numeric surface per hard rule #1) ──
//
// Tracks success/failure per transport so mission-control can prove the
// REST path is at parity with stdio MCP before we cut over.
export interface WorkIqTransportKpi {
  transport: 'mcp' | 'api';
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  lastError?: string;
  uptimeSec: number;
}

const kpiByTransport: Record<'mcp' | 'api', { attempts: number; successes: number; failures: number; lastError?: string; startedAt: number }> = {
  mcp: { attempts: 0, successes: 0, failures: 0, startedAt: Date.now() },
  api: { attempts: 0, successes: 0, failures: 0, startedAt: Date.now() },
};

export function recordWorkIqAttempt(transport: 'mcp' | 'api', ok: boolean, error?: string): void {
  const c = kpiByTransport[transport];
  c.attempts += 1;
  if (ok) c.successes += 1;
  else {
    c.failures += 1;
    if (error) c.lastError = error.slice(0, 200);
  }
}

export function getWorkIqKpi(): WorkIqTransportKpi[] {
  return (['mcp', 'api'] as const).map((t) => {
    const c = kpiByTransport[t];
    return {
      transport: t,
      attempts: c.attempts,
      successes: c.successes,
      failures: c.failures,
      successRate: c.attempts > 0 ? c.successes / c.attempts : 0,
      lastError: c.lastError,
      uptimeSec: Math.round((Date.now() - c.startedAt) / 1000),
    };
  });
}

async function postAsk(question: string): Promise<string> {
  const token = await getBearer();
  const url = `${DEFAULT_BASE.replace(/\/+$/, '')}/ask`;
  const start = Date.now();
  const ac = new AbortController();
  const timeoutMs = Number(process.env.WORKIQ_API_TIMEOUT_MS || 30_000);
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ question }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = `WorkIQ API ${res.status}: ${text.slice(0, 200)}`;
      recordWorkIqAttempt('api', false, err);
      throw new Error(err);
    }
    const json = (await res.json().catch(() => ({}))) as {
      answer?: string;
      response?: string;
      text?: string;
    };
    const answer = json.answer || json.response || json.text;
    if (!answer) {
      const err = 'WorkIQ API returned empty body';
      recordWorkIqAttempt('api', false, err);
      throw new Error(err);
    }
    recordWorkIqAttempt('api', true);
    return answer;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      const msg = `WorkIQ API timed out after ${timeoutMs}ms`;
      recordWorkIqAttempt('api', false, msg);
      throw new Error(msg);
    }
    if (!String((err as Error).message || '').startsWith('WorkIQ API')) {
      recordWorkIqAttempt('api', false, (err as Error).message);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    void start; // reserved for latency metric in a future patch
  }
}

export class WorkIqApiClient implements IWorkIqClient {
  // ── Email ──
  async searchEmails(query: string): Promise<string> {
    return postAsk(`Search my emails for: ${query}`);
  }
  async getEmailsAboutIncident(incidentId: string): Promise<string> {
    return postAsk(`Find all emails mentioning incident ${incidentId} or related discussions`);
  }
  async getEmailsAboutChange(changeNumber: string): Promise<string> {
    return postAsk(`Find all emails about change request ${changeNumber}`);
  }
  // ── Meetings & Calendar ──
  async getUpcomingMeetings(timeframe?: string): Promise<string> {
    return postAsk(`What meetings do I have ${timeframe || 'this week'}?`);
  }
  async findCabMeetings(): Promise<string> {
    return postAsk('Find any upcoming Change Advisory Board (CAB) meetings or change review meetings');
  }
  async getMeetingDetails(meetingSubject: string): Promise<string> {
    return postAsk(`Get details about the meeting: ${meetingSubject}`);
  }
  // ── Teams Messages ──
  async searchTeamsMessages(query: string): Promise<string> {
    return postAsk(`Search Teams messages for: ${query}`);
  }
  async getChannelActivity(channelName: string): Promise<string> {
    return postAsk(`Summarize recent activity in the ${channelName} Teams channel`);
  }
  async getItOpsChannelAlerts(): Promise<string> {
    return postAsk('Summarize recent messages in IT Operations, Incidents, or Service Desk Teams channels');
  }
  // ── People & Org ──
  async lookupPerson(name: string): Promise<string> {
    return postAsk(`Who is ${name}? Show their role, department, and contact info`);
  }
  async getOrgChart(name: string): Promise<string> {
    return postAsk(`Show the org chart for ${name}`);
  }
  async findExpertFor(topic: string): Promise<string> {
    return postAsk(`Who in the organization is an expert on ${topic}? Who has been involved in related discussions?`);
  }
  // ── Documents ──
  async searchDocuments(query: string): Promise<string> {
    return postAsk(`Find documents related to: ${query}`);
  }
  async findRunbook(system: string): Promise<string> {
    return postAsk(`Find runbooks, procedures, or documentation for ${system}`);
  }
  // ── Productivity Insights ──
  async extractActionItems(meetingSubject: string): Promise<string> {
    return postAsk(`Extract action items from the meeting: ${meetingSubject}`);
  }
  async triageInbox(): Promise<string> {
    return postAsk('Give me a quick triage of my inbox — what needs attention today?');
  }
  async getMeetingCosts(timeframe?: string): Promise<string> {
    return postAsk(`How much time did I spend in meetings ${timeframe || 'this week'}?`);
  }
  // ── General query ──
  async query(question: string): Promise<string> {
    return postAsk(question);
  }
}
