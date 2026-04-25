// ITSM Operations Digital Worker — Email service via Microsoft Graph
// Uses a dedicated standard app registration with Mail.Send permission.
// Environment: GRAPH_APP_ID, GRAPH_APP_SECRET, GRAPH_TENANT_ID, AGENT_EMAIL / MANAGER_EMAIL
// Falls back to env vars: clientId, clientSecret, tenantId if GRAPH_ vars not set.

import { configDotenv } from 'dotenv';
configDotenv();

// ── Types ──

export interface EmailOptions {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  bodyType?: 'HTML' | 'Text';
  importance?: 'low' | 'normal' | 'high';
  attachments?: Array<{ name: string; contentBytes: string; contentType: string }>;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ── Internal helpers ──

const GRAPH_APP_ID = process.env.GRAPH_APP_ID || process.env.clientId || '';
const GRAPH_APP_SECRET = process.env.GRAPH_APP_SECRET || process.env.clientSecret || '';
const GRAPH_TENANT_ID = process.env.GRAPH_TENANT_ID || process.env.MicrosoftAppTenantId || process.env.tenantId || '';
const SENDER_EMAIL = process.env.AGENT_EMAIL || process.env.MANAGER_EMAIL || process.env.ITSM_USER_EMAIL || '';

if (!GRAPH_APP_ID || !GRAPH_APP_SECRET) console.warn('[Email] GRAPH_APP_ID or GRAPH_APP_SECRET not set — email sending will fail.');

let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getGraphToken(): Promise<string> {
  const now = Date.now();
  if (_tokenCache && now < _tokenCache.expiresAt - 60000) return _tokenCache.token;

  const body = `client_id=${GRAPH_APP_ID}&client_secret=${encodeURIComponent(GRAPH_APP_SECRET)}&scope=https%3A%2F%2Fgraph.microsoft.com%2F.default&grant_type=client_credentials`;
  const res = await fetch(`https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token failed: ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  _tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in * 1000) };
  return data.access_token;
}

// ── Legacy simple send (preserved for backward compat) ──

export async function sendEmail(to: string, subject: string, htmlBody: string): Promise<void> {
  try {
    const token = await getGraphToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${SENDER_EMAIL}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: htmlBody },
          toRecipients: [{ emailAddress: { address: to } }],
        },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[Email] Send failed: ${res.status} — ${err.substring(0, 200)}`);
    } else {
      console.log(`[Email] Sent: "${subject}" to ${to}`);
    }
  } catch (err) {
    console.error('[Email] Error:', (err as Error).message);
  }
}

// ── Full-featured EmailService class ──

export class EmailService {
  /**
   * Send an email via Microsoft Graph API with full options.
   */
  async sendEmailAdvanced(options: EmailOptions): Promise<EmailResult> {
    if (!SENDER_EMAIL) {
      return { success: false, error: 'Sender email not configured (AGENT_EMAIL or MANAGER_EMAIL)' };
    }

    const toRecipients = options.to.map((addr) => ({ emailAddress: { address: addr } }));
    const ccRecipients = (options.cc || []).map((addr) => ({ emailAddress: { address: addr } }));
    const attachments = (options.attachments || []).map((a) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.name,
      contentBytes: a.contentBytes,
      contentType: a.contentType,
    }));

    const message: Record<string, unknown> = {
      subject: options.subject,
      body: { contentType: options.bodyType || 'HTML', content: options.body },
      toRecipients,
      importance: options.importance || 'normal',
    };
    if (ccRecipients.length > 0) message.ccRecipients = ccRecipients;
    if (attachments.length > 0) message.attachments = attachments;

    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER_EMAIL)}/sendMail`;

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const token = await getGraphToken();
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, saveToSentItems: true }),
        });
        if (res.ok || res.status === 202) {
          const messageId = res.headers.get('x-ms-request-id') || undefined;
          return { success: true, messageId };
        }
        const errorBody = await res.text();
        if (attempt < MAX_RETRIES && (res.status === 429 || res.status >= 500)) {
          const retryAfter = Number(res.headers.get('Retry-After') || '2');
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        }
        return { success: false, error: `Graph API ${res.status}: ${errorBody}` };
      } catch (err: unknown) {
        if (attempt < MAX_RETRIES) continue;
        return { success: false, error: `Network error: ${(err as Error).message}` };
      }
    }
    return { success: false, error: 'Max retries exceeded' };
  }

  /**
   * Send a formatted incident notification email.
   */
  async sendIncidentNotification(
    incidentId: string,
    severity: string,
    summary: string,
    recipients: string[]
  ): Promise<EmailResult> {
    const severityColor = severity === 'P1' ? '#dc3545' : severity === 'P2' ? '#fd7e14' : '#ffc107';
    const body = `
      <div style="font-family:Segoe UI,sans-serif;">
        <div style="background:${severityColor};color:white;padding:12px 16px;border-radius:4px 4px 0 0;">
          <strong>🚨 ${severity} Incident — ${incidentId}</strong>
        </div>
        <div style="border:1px solid #ddd;padding:16px;border-radius:0 0 4px 4px;">
          <p>${summary}</p>
          <p style="color:#666;font-size:12px;">Sent by ITSM Operations Digital Worker at ${new Date().toISOString()}</p>
        </div>
      </div>`;
    return this.sendEmailAdvanced({
      to: recipients,
      subject: `[${severity}] Incident ${incidentId}`,
      body,
      importance: severity === 'P1' ? 'high' : 'normal',
    });
  }

  /**
   * Send a CAB change approval request email.
   */
  async sendChangeApprovalRequest(
    changeId: string,
    title: string,
    riskScore: number,
    cabMembers: string[]
  ): Promise<EmailResult> {
    const riskLabel = riskScore >= 8 ? 'HIGH' : riskScore >= 5 ? 'MEDIUM' : 'LOW';
    const riskColor = riskScore >= 8 ? '#dc3545' : riskScore >= 5 ? '#fd7e14' : '#28a745';
    const body = `
      <div style="font-family:Segoe UI,sans-serif;">
        <h2 style="margin:0 0 12px;">📋 Change Approval Request</h2>
        <table style="border-collapse:collapse;width:100%;">
          <tr><td style="padding:8px;font-weight:bold;">Change ID</td><td style="padding:8px;">${changeId}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Title</td><td style="padding:8px;">${title}</td></tr>
          <tr><td style="padding:8px;font-weight:bold;">Risk Score</td>
              <td style="padding:8px;"><span style="color:${riskColor};font-weight:bold;">${riskScore}/10 (${riskLabel})</span></td></tr>
        </table>
        <p>Please review this change request and submit your approval or rejection via the ITSM portal.</p>
        <p style="color:#666;font-size:12px;">Sent by ITSM Operations Digital Worker</p>
      </div>`;
    return this.sendEmailAdvanced({
      to: cabMembers,
      subject: `[CAB Review] ${changeId}: ${title} — Risk: ${riskLabel}`,
      body,
      importance: riskScore >= 8 ? 'high' : 'normal',
    });
  }

  /**
   * Send a monthly service review pack email with optional attachment.
   */
  async sendServiceReviewPack(
    period: string,
    recipients: string[],
    summaryData: Record<string, unknown>
  ): Promise<EmailResult> {
    const body = `
      <div style="font-family:Segoe UI,sans-serif;">
        <h2>📊 Monthly Service Review — ${period}</h2>
        <p>Please find the monthly service review pack for <strong>${period}</strong>.</p>
        <h3>Key Metrics Summary</h3>
        <pre style="background:#f5f5f5;padding:12px;border-radius:4px;">${JSON.stringify(summaryData, null, 2)}</pre>
        <p>The full review deck is attached. Please review ahead of the scheduled service review meeting.</p>
        <p style="color:#666;font-size:12px;">Sent by ITSM Operations Digital Worker</p>
      </div>`;
    return this.sendEmailAdvanced({
      to: recipients,
      subject: `[Service Review] Monthly ITSM Report — ${period}`,
      body,
    });
  }

  /**
   * Send an escalation notification email.
   */
  async sendEscalationEmail(
    ticketId: string,
    escalationLevel: number,
    reason: string,
    recipients: string[]
  ): Promise<EmailResult> {
    const body = `
      <div style="font-family:Segoe UI,sans-serif;">
        <div style="background:#dc3545;color:white;padding:12px 16px;border-radius:4px 4px 0 0;">
          <strong>⬆️ Escalation Level ${escalationLevel} — ${ticketId}</strong>
        </div>
        <div style="border:1px solid #ddd;padding:16px;border-radius:0 0 4px 4px;">
          <p><strong>Reason:</strong> ${reason}</p>
          <p>This ticket has been escalated to Level ${escalationLevel}. Immediate attention is required.</p>
          <p style="color:#666;font-size:12px;">Sent by ITSM Operations Digital Worker at ${new Date().toISOString()}</p>
        </div>
      </div>`;
    return this.sendEmailAdvanced({
      to: recipients,
      subject: `[ESCALATION L${escalationLevel}] ${ticketId}`,
      body,
      importance: 'high',
    });
  }
}

export const emailService = new EmailService();

