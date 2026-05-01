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

// Re-export for downstream wrappers (m365-tools.ts) that need the attendee shape.
export type { CalendarAttendee };

// ── Service ──

export class AutonomousActions {
  private msalApp: ConfidentialClientApplication | null = null;

  private getConfig() {
    return {
      clientId: process.env.GRAPH_APP_ID || process.env.clientId || '',
      clientSecret: process.env.GRAPH_APP_SECRET || process.env.clientSecret || '',
      tenantId: process.env.GRAPH_TENANT_ID || process.env.tenantId || '',
      // Organiser mailbox for calendar events, online meetings, and SharePoint actions.
      // Falls back to the dedicated Graph sender (Alex's mailbox) when ITSM_USER_EMAIL is unset.
      userEmail:
        process.env.ITSM_USER_EMAIL ||
        process.env.GRAPH_MAIL_SENDER ||
        process.env.AGENT_EMAIL ||
        '',
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
   *
   * Microsoft Graph application permissions cannot post to a live (non-migration)
   * channel — the only app-only path is `Teamwork.Migrate.All` which requires the
   * team to be in import mode. For live posting we therefore prefer an
   * Incoming Webhook (Workflow URL) when `ITSM_TEAMS_WEBHOOK` is configured,
   * and only fall back to the Graph endpoint when no webhook is available.
   */
  async postToTeamsChannel(
    teamId: string,
    channelId: string,
    message: string,
    cardPayload?: Record<string, unknown>
  ): Promise<ActionResult> {
    const webhook = process.env.ITSM_TEAMS_WEBHOOK || '';
    if (webhook) {
      try {
        const payload = cardPayload
          ? {
              type: 'message',
              attachments: [
                {
                  contentType: 'application/vnd.microsoft.card.adaptive',
                  contentUrl: null,
                  content: cardPayload,
                },
              ],
            }
          : { text: message };
        const r = await fetch(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (r.ok) {
          return { success: true, id: 'webhook' };
        }
        const txt = await r.text();
        return { success: false, error: `Webhook ${r.status}: ${txt.slice(0, 200)}` };
      } catch (err: unknown) {
        return { success: false, error: `Webhook error: ${(err as Error).message}` };
      }
    }
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
   * Create a calendar event with optional Teams online meeting (CAB meetings,
   * DR drills, incident bridges, RCA reviews, etc.).
   *
   * Returns the Graph event id, the Teams join URL (if online), and the web link
   * to the event in Outlook so callers can surface them to the user.
   *
   * Requires Graph application permission `Calendars.ReadWrite` on the
   * organiser mailbox (default: GRAPH_MAIL_SENDER / Alex's mailbox).
   */
  async createCalendarEvent(
    subject: string,
    start: string,
    end: string,
    attendees: CalendarAttendee[],
    body: string,
    isOnlineMeeting: boolean = false,
    options: { timeZone?: string; location?: string; organizerEmail?: string } = {}
  ): Promise<ActionResult & { joinUrl?: string; webLink?: string }> {
    try {
      const cfg = this.getConfig();
      const organiser = options.organizerEmail || cfg.userEmail;
      if (!organiser) {
        return {
          success: false,
          error: 'Organiser mailbox not configured (ITSM_USER_EMAIL / GRAPH_MAIL_SENDER)',
        };
      }

      const tz = options.timeZone || 'UTC';
      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organiser)}/events`;
      const event: Record<string, unknown> = {
        subject,
        body: { contentType: 'HTML' as const, content: body },
        start: { dateTime: start, timeZone: tz },
        end: { dateTime: end, timeZone: tz },
        attendees: attendees.map((a) => ({
          emailAddress: { address: a.email, name: a.name || a.email },
          type: 'required' as const,
        })),
        isOnlineMeeting,
        onlineMeetingProvider: isOnlineMeeting ? ('teamsForBusiness' as const) : undefined,
      };
      if (options.location) {
        event.location = { displayName: options.location };
      }

      const res = await this.graphRequest('POST', url, event);
      if (res.ok) {
        const data = res.data as Record<string, unknown>;
        const id = data?.id as string | undefined;
        const onlineMeeting = data?.onlineMeeting as { joinUrl?: string } | undefined;
        const webLink = data?.webLink as string | undefined;
        return { success: true, id, joinUrl: onlineMeeting?.joinUrl, webLink };
      }
      return { success: false, error: `Graph API ${res.status}: ${JSON.stringify(res.data)}` };
    } catch (err: unknown) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Suggest meeting times that work for the organiser and attendees.
   * Wraps Graph `/users/{id}/findMeetingTimes`.
   *
   * Requires Graph application permission `Calendars.Read` on the organiser
   * mailbox plus read access to attendee free/busy.
   */
  async findMeetingTimes(
    attendees: CalendarAttendee[],
    durationMinutes: number = 30,
    options: {
      organizerEmail?: string;
      windowStart?: string;
      windowEnd?: string;
      maxCandidates?: number;
    } = {}
  ): Promise<
    | { success: true; suggestions: Array<{ start: string; end: string; confidence?: number }> }
    | { success: false; error: string }
  > {
    try {
      const cfg = this.getConfig();
      const organiser = options.organizerEmail || cfg.userEmail;
      if (!organiser) {
        return {
          success: false,
          error: 'Organiser mailbox not configured (ITSM_USER_EMAIL / GRAPH_MAIL_SENDER)',
        };
      }

      const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organiser)}/findMeetingTimes`;
      const isoDuration = `PT${Math.max(15, Math.min(480, durationMinutes))}M`;
      const body: Record<string, unknown> = {
        attendees: attendees.map((a) => ({
          emailAddress: { address: a.email, name: a.name || a.email },
          type: 'required',
        })),
        meetingDuration: isoDuration,
        maxCandidates: Math.max(1, Math.min(20, options.maxCandidates ?? 5)),
        isOrganizerOptional: false,
        returnSuggestionReasons: true,
        minimumAttendeePercentage: 100,
      };
      if (options.windowStart && options.windowEnd) {
        body.timeConstraint = {
          activityDomain: 'work',
          timeSlots: [
            {
              start: { dateTime: options.windowStart, timeZone: 'UTC' },
              end: { dateTime: options.windowEnd, timeZone: 'UTC' },
            },
          ],
        };
      }

      const res = await this.graphRequest('POST', url, body);
      if (!res.ok) {
        return { success: false, error: `Graph API ${res.status}: ${JSON.stringify(res.data)}` };
      }
      const data = res.data as { meetingTimeSuggestions?: Array<Record<string, unknown>> };
      const suggestions = (data.meetingTimeSuggestions || []).map((s) => {
        const slot = s.meetingTimeSlot as { start?: { dateTime?: string }; end?: { dateTime?: string } } | undefined;
        return {
          start: slot?.start?.dateTime || '',
          end: slot?.end?.dateTime || '',
          confidence: typeof s.confidence === 'number' ? (s.confidence as number) : undefined,
        };
      }).filter((s) => s.start && s.end);
      return { success: true, suggestions };
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
