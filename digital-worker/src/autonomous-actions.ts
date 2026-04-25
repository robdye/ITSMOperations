// ITSM Operations — Autonomous Actions
// Write actions that agents can trigger for Teams posts, calendar events, SharePoint docs.
// Uses Microsoft Graph API (same credential pattern as email-service).
//
// Requires @azure/msal-node — npm install @azure/msal-node

import { ConfidentialClientApplication } from '@azure/msal-node';

// ── Types ──

export interface ActionResult {
  success: boolean;
  id?: string;
  error?: string;
}

interface CalendarAttendee {
  email: string;
  name?: string;
}

// ── Service ──

export class AutonomousActions {
  private msalApp: ConfidentialClientApplication | null = null;

  private getConfig() {
    return {
      clientId: process.env.GRAPH_APP_ID || process.env.clientId || '',
      clientSecret: process.env.GRAPH_APP_SECRET || process.env.clientSecret || '',
      tenantId: process.env.GRAPH_TENANT_ID || process.env.tenantId || '',
      userEmail: process.env.ITSM_USER_EMAIL || '',
    };
  }

  private getMsalApp(): ConfidentialClientApplication {
    if (this.msalApp) return this.msalApp;
    const cfg = this.getConfig();
    if (!cfg.clientId || !cfg.clientSecret || !cfg.tenantId) {
      throw new Error('Graph API credentials not configured. Set GRAPH_APP_ID, GRAPH_APP_SECRET, GRAPH_TENANT_ID.');
    }
    this.msalApp = new ConfidentialClientApplication({
      auth: {
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      },
    });
    return this.msalApp;
  }

  private async getAccessToken(scopes: string[] = ['https://graph.microsoft.com/.default']): Promise<string> {
    const app = this.getMsalApp();
    const result = await app.acquireTokenByClientCredential({ scopes });
    if (!result?.accessToken) {
      throw new Error('Failed to acquire Graph API access token');
    }
    return result.accessToken;
  }

  private async graphRequest(
    method: string,
    url: string,
    body?: Record<string, unknown>
  ): Promise<{ ok: boolean; status: number; data: unknown }> {
    const token = await this.getAccessToken();
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(url, options);
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { ok: res.ok, status: res.status, data };
  }

  /**
   * Post a message (or Adaptive Card) to a Teams channel.
   */
  async postToTeamsChannel(
    teamId: string,
    channelId: string,
    message: string,
    cardPayload?: Record<string, unknown>
  ): Promise<ActionResult> {
    try {
      const url = `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages`;
      const body: Record<string, unknown> = cardPayload
        ? {
            body: { contentType: 'html', content: message },
            attachments: [
              {
                id: '1',
                contentType: 'application/vnd.microsoft.card.adaptive',
                content: JSON.stringify(cardPayload),
              },
            ],
          }
        : { body: { contentType: 'html', content: message } };

      const res = await this.graphRequest('POST', url, body);
      if (res.ok) {
        const id = (res.data as Record<string, string>)?.id;
        return { success: true, id };
      }
      return { success: false, error: `Graph API ${res.status}: ${JSON.stringify(res.data)}` };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Create a calendar event (CAB meetings, DR drills, etc.).
   */
  async createCalendarEvent(
    subject: string,
    start: string,
    end: string,
    attendees: CalendarAttendee[],
    body: string,
    isOnlineMeeting: boolean = false
  ): Promise<ActionResult> {
    try {
      const cfg = this.getConfig();
      if (!cfg.userEmail) return { success: false, error: 'ITSM_USER_EMAIL not configured' };

      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.userEmail)}/events`;
      const event = {
        subject,
        body: { contentType: 'HTML' as const, content: body },
        start: { dateTime: start, timeZone: 'UTC' },
        end: { dateTime: end, timeZone: 'UTC' },
        attendees: attendees.map((a) => ({
          emailAddress: { address: a.email, name: a.name || a.email },
          type: 'required' as const,
        })),
        isOnlineMeeting,
        onlineMeetingProvider: isOnlineMeeting ? ('teamsForBusiness' as const) : undefined,
      };

      const res = await this.graphRequest('POST', url, event as unknown as Record<string, unknown>);
      if (res.ok) {
        const id = (res.data as Record<string, string>)?.id;
        return { success: true, id };
      }
      return { success: false, error: `Graph API ${res.status}: ${JSON.stringify(res.data)}` };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Create a SharePoint page in a site.
   */
  async createSharePointPage(
    siteId: string,
    title: string,
    content: string
  ): Promise<ActionResult> {
    try {
      const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/pages`;
      const page = {
        name: `${title.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-')}.aspx`,
        title,
        'pageLayout': 'article',
        'publishingState': { level: 'draft' },
        'canvasLayout': {
          horizontalSections: [
            {
              columns: [
                {
                  width: 12,
                  webparts: [
                    {
                      type: 'textWebPart',
                      data: { innerHtml: content },
                    },
                  ],
                },
              ],
            },
          ],
        },
      };

      const res = await this.graphRequest('POST', url, page);
      if (res.ok) {
        const id = (res.data as Record<string, string>)?.id;
        return { success: true, id };
      }
      return { success: false, error: `Graph API ${res.status}: ${JSON.stringify(res.data)}` };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Upload a file to a SharePoint document library.
   */
  async uploadToSharePoint(
    siteId: string,
    folderPath: string,
    fileName: string,
    content: string
  ): Promise<ActionResult> {
    try {
      const encodedPath = encodeURIComponent(`${folderPath}/${fileName}`).replace(/%2F/g, '/');
      const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodedPath}:/content`;
      const token = await this.getAccessToken();

      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
        },
        body: content,
      });

      if (res.ok) {
        const data = (await res.json()) as Record<string, string>;
        return { success: true, id: data?.id };
      }
      const errorText = await res.text();
      return { success: false, error: `Graph API ${res.status}: ${errorText}` };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Create a Teams channel for a Major Incident bridge.
   */
  async createTeamsIncidentBridge(
    incidentId: string,
    severity: string,
    title: string
  ): Promise<ActionResult> {
    try {
      const teamId = process.env.ITSM_TEAM_ID;
      if (!teamId) return { success: false, error: 'ITSM_TEAM_ID not configured' };

      const url = `https://graph.microsoft.com/v1.0/teams/${teamId}/channels`;
      const channel = {
        displayName: `🚨 ${severity} ${incidentId} — ${title}`,
        description: `Major Incident Bridge for ${incidentId}. Severity: ${severity}. Created by ITSM Operations Digital Worker.`,
        membershipType: 'standard',
      };

      const res = await this.graphRequest('POST', url, channel);
      if (res.ok) {
        const id = (res.data as Record<string, string>)?.id;
        return { success: true, id };
      }
      return { success: false, error: `Graph API ${res.status}: ${JSON.stringify(res.data)}` };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Send an Adaptive Card to a Teams channel (CAB voting, approvals, etc.).
   */
  async sendAdaptiveCard(
    channelId: string,
    card: Record<string, unknown>
  ): Promise<ActionResult> {
    try {
      const teamId = process.env.ITSM_TEAM_ID;
      if (!teamId) return { success: false, error: 'ITSM_TEAM_ID not configured' };

      return this.postToTeamsChannel(teamId, channelId, '', card);
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }
}

export const autonomousActions = new AutonomousActions();
