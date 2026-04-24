// ITSM Operations Digital Worker — Email service via Microsoft Graph
// Uses a dedicated standard app registration with Mail.Send permission.

import { configDotenv } from 'dotenv';
configDotenv();

const GRAPH_APP_ID = process.env.GRAPH_APP_ID || '';
const GRAPH_APP_SECRET = process.env.GRAPH_APP_SECRET || '';
const GRAPH_TENANT_ID = process.env.GRAPH_TENANT_ID || process.env.MicrosoftAppTenantId || '';
const SENDER_EMAIL = process.env.AGENT_EMAIL || process.env.MANAGER_EMAIL || '';

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
  const data = await res.json() as any;
  _tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in * 1000) };
  return data.access_token;
}

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

