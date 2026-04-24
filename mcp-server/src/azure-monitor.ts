/**
 * Azure Monitor / App Insights client.
 * Uses Azure CLI token or managed identity for authentication.
 */

const AZURE_SUBSCRIPTION = process.env.AZURE_SUBSCRIPTION_ID || "";
const AZURE_RESOURCE_GROUP = process.env.AZURE_MONITOR_RG || "";
const AZURE_APP_INSIGHTS_ID = process.env.AZURE_APP_INSIGHTS_ID || "";

async function getAzureToken(): Promise<string> {
  // Try managed identity first, fall back to env var
  if (process.env.AZURE_MONITOR_TOKEN) return process.env.AZURE_MONITOR_TOKEN;

  try {
    const res = await fetch("http://169.254.169.254/metadata/identity/oauth2/token?api-version=2019-08-01&resource=https://management.azure.com/", {
      headers: { Metadata: "true" },
    });
    if (res.ok) {
      const json = await res.json();
      return json.access_token;
    }
  } catch { /* not on Azure, skip */ }

  return "";
}

async function azureGet(url: string): Promise<any> {
  const token = await getAzureToken();
  if (!token) return null;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) return null;
  return res.json();
}

/** Get Azure Monitor alerts for a subscription */
export async function getAlerts(limit = 50): Promise<any[]> {
  if (!AZURE_SUBSCRIPTION) return [];
  const url = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION}/providers/Microsoft.AlertsManagement/alerts?api-version=2019-05-05-preview&$top=${limit}`;
  const data = await azureGet(url);
  return data?.value ?? [];
}

/** Get Azure resource health */
export async function getResourceHealth(): Promise<any[]> {
  if (!AZURE_SUBSCRIPTION) return [];
  const url = `https://management.azure.com/subscriptions/${AZURE_SUBSCRIPTION}/providers/Microsoft.ResourceHealth/availabilityStatuses?api-version=2020-05-01`;
  const data = await azureGet(url);
  return data?.value ?? [];
}

/** Get App Insights exceptions/failures */
export async function getAppInsightsFailures(timespan = "PT24H"): Promise<any> {
  if (!AZURE_APP_INSIGHTS_ID) return null;
  const url = `https://management.azure.com${AZURE_APP_INSIGHTS_ID}/api/query?api-version=2018-04-20&timespan=${timespan}&query=exceptions | summarize count() by type, outerMessage | top 20 by count_`;
  return azureGet(url);
}

/** Check if Azure Monitor is configured */
export function isConfigured(): boolean {
  return !!(AZURE_SUBSCRIPTION && (process.env.AZURE_MONITOR_TOKEN || process.env.IDENTITY_ENDPOINT));
}
