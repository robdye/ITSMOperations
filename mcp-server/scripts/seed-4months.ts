/**
 * ServiceNow 4-Month ITIL v4 Demo Data Seeder
 *
 * Generates ~120 days of realistic ITIL v4 data across the practice areas
 * exposed by Alex IT Operations:
 *
 *   - Incident Management (~250 incidents)
 *   - Change Enablement (~80 changes)
 *   - Problem Management (~30 problems + Known Errors)
 *   - Service Request Management (~50 requests)
 *   - Knowledge Management (~25 KB articles)
 *   - Service Level Management (Task SLAs against active incidents)
 *
 * All records are prefixed with [DEMO] so the existing clearDemoData()
 * helper can clean them up in one call.
 *
 * Also: closes every currently-open incident in the instance with a clear
 * close_code/close_notes ("Bulk-closed during demo data refresh on YYYY-MM-DD").
 *
 * Auth: pulls SNOW_INSTANCE/SNOW_USER/SNOW_PASSWORD from mcp-server/.env
 * via Node's --env-file flag. Uses Basic Auth (admin) for simplicity on the
 * one-shot run; the running MCP server still uses OBO/OAuth for end-user
 * traffic in production.
 *
 * Usage:
 *   cd mcp-server
 *   node --env-file=.env --import tsx scripts/seed-4months.ts [options]
 *
 * Options:
 *   --close-only     Only close currently-open incidents; skip seeding
 *   --seed-only      Only seed; do not close existing open incidents
 *   --clear          Delete all existing [DEMO] records before seeding
 *   --dry-run        Print plan only, do not write
 *   --verbose        Log every POST
 *
 * Example:
 *   node --env-file=.env --import tsx scripts/seed-4months.ts --clear
 */

// ── Args ─────────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(2));
const CLOSE_ONLY = args.has('--close-only');
const SEED_ONLY = args.has('--seed-only');const PROBLEMS_ONLY = args.has('--problems-only');const CLEAR_FIRST = args.has('--clear');
const DRY_RUN = args.has('--dry-run');
const VERBOSE = args.has('--verbose');

// ── Config ───────────────────────────────────────────────────────────────
const SNOW_INSTANCE = (process.env.SNOW_INSTANCE || '').replace(/\/$/, '');
const SNOW_USER = process.env.SNOW_USER || '';
const SNOW_PASSWORD = process.env.SNOW_PASSWORD || '';
const DEMO_PREFIX = '[DEMO]';

if (!SNOW_INSTANCE || !SNOW_USER || !SNOW_PASSWORD) {
  console.error('Missing SNOW_INSTANCE / SNOW_USER / SNOW_PASSWORD in env. Use node --env-file=.env to load.');
  process.exit(1);
}

const BASIC_AUTH = 'Basic ' + Buffer.from(`${SNOW_USER}:${SNOW_PASSWORD}`).toString('base64');
const HEADERS = { Authorization: BASIC_AUTH, Accept: 'application/json', 'Content-Type': 'application/json' };

// ── Helpers ──────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

// fetch with retry+backoff for transient network errors (ECONNRESET, fetch failed)
// and HTTP 429/5xx. Up to 5 attempts; exponential backoff starting 500ms.
async function fetchRetry(url: string, init: RequestInit, attempt = 1): Promise<Response> {
  const MAX = 5;
  try {
    const res = await fetch(url, init);
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt < MAX) {
        await sleep(500 * 2 ** (attempt - 1));
        return fetchRetry(url, init, attempt + 1);
      }
    }
    return res;
  } catch (err) {
    const msg = (err as Error).message ?? '';
    const transient = msg.includes('fetch failed') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('socket hang up');
    if (transient && attempt < MAX) {
      if (VERBOSE) console.log(`  retry ${attempt}/${MAX} after transient: ${msg}`);
      await sleep(500 * 2 ** (attempt - 1));
      return fetchRetry(url, init, attempt + 1);
    }
    throw err;
  }
}

async function snowGet(table: string, query: string, fields: string[], limit = 100): Promise<any[]> {
  const params = new URLSearchParams({
    sysparm_query: query,
    sysparm_fields: fields.join(','),
    sysparm_limit: String(limit),
  });
  const url = `${SNOW_INSTANCE}/api/now/table/${encodeURIComponent(table)}?${params}`;
  const res = await fetchRetry(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${table} failed (${res.status}): ${await res.text()}`);
  const json: any = await res.json();
  return json.result ?? [];
}

async function snowGetCount(table: string, query: string): Promise<number> {
  const params = new URLSearchParams({
    sysparm_query: query,
    sysparm_count: 'true',
    sysparm_limit: '1',
    sysparm_fields: 'sys_id',
  });
  const url = `${SNOW_INSTANCE}/api/now/table/${encodeURIComponent(table)}?${params}`;
  const res = await fetchRetry(url, { headers: HEADERS });
  const total = res.headers.get('x-total-count');
  return total ? parseInt(total, 10) : 0;
}

async function snowPost(table: string, body: Record<string, unknown>): Promise<any> {
  if (DRY_RUN) return { sys_id: 'dry-run', ...body };
  const url = `${SNOW_INSTANCE}/api/now/table/${encodeURIComponent(table)}`;
  const res = await fetchRetry(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${table} failed (${res.status}): ${await res.text()}`);
  const json: any = await res.json();
  return json.result ?? {};
}

async function snowPatch(table: string, sysId: string, body: Record<string, unknown>): Promise<any> {
  if (DRY_RUN) return { sys_id: sysId, ...body };
  const url = `${SNOW_INSTANCE}/api/now/table/${encodeURIComponent(table)}/${sysId}`;
  const res = await fetchRetry(url, { method: 'PATCH', headers: HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`PATCH ${table}/${sysId} failed (${res.status}): ${await res.text()}`);
  const json: any = await res.json();
  return json.result ?? {};
}

async function snowDelete(table: string, sysId: string): Promise<void> {
  if (DRY_RUN) return;
  const url = `${SNOW_INSTANCE}/api/now/table/${encodeURIComponent(table)}/${sysId}`;
  const res = await fetchRetry(url, { method: 'DELETE', headers: HEADERS });
  if (!res.ok) throw new Error(`DELETE ${table}/${sysId} failed (${res.status}): ${await res.text()}`);
}

// ── Date helpers ─────────────────────────────────────────────────────────
function snowDate(d: Date): string {
  // ServiceNow expects 'YYYY-MM-DD HH:MM:SS' in UTC
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
function daysAgoUtc(daysAgo: number, hourOfDay = 9): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hourOfDay, Math.floor(Math.random() * 60), Math.floor(Math.random() * 60), 0);
  return d;
}
function addHours(d: Date, hours: number): Date {
  const x = new Date(d);
  x.setTime(x.getTime() + hours * 3600_000);
  return x;
}

// ── PRNG (deterministic-ish for repeatability) ───────────────────────────
let _seed = Date.now() & 0xffffffff;
function rand(): number {
  // mulberry32
  _seed = (_seed + 0x6d2b79f5) | 0;
  let t = _seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function pickWeighted<T>(items: readonly { v: T; w: number }[]): T {
  const total = items.reduce((s, i) => s + i.w, 0);
  let r = rand() * total;
  for (const it of items) {
    if ((r -= it.w) < 0) return it.v;
  }
  return items[items.length - 1].v;
}

// ── Reference data ───────────────────────────────────────────────────────
const ASSIGNMENT_GROUPS = ['Service Desk', 'Application Support', 'IT Operations', 'Network Engineering', 'Database Administration', 'Security Operations'] as const;
const CATEGORIES = ['software', 'hardware', 'network', 'database', 'security', 'inquiry'] as const;

// PDI-validated close_code choices for incident.close_code
const INCIDENT_CLOSE_CODES = [
  'Solution provided',
  'Workaround provided',
  'Resolved by caller',
  'Resolved by problem',
  'Resolved by request',
  'Resolved by change',
  'Known error',
  'User error',
] as const;

// PDI-validated resolution_code choices for problem.resolution_code
// Excludes 'duplicate' (PDI data policy requires Duplicate of reference) and
// 'canceled' (which triggers Canceled reason mandatory rule).
const PROBLEM_RESOLUTION_CODES = ['fix_applied', 'risk_accepted'] as const;

// admin sys_user for assigned_to / resolved_by references
const ADMIN_SYS_ID = '6816f79cc0a8016401c5a33be04be441';

// Resolved at runtime in setupAssignmentGroups(): name -> sys_id
const GROUP_SYS_IDS: Record<string, string> = {};

// Ensures each group in ASSIGNMENT_GROUPS exists and admin is a member.
// The OOTB "Abort changes on group" before-rule on incident/change_request/problem_task
// rejects any insert/update where current.assigned_to is NOT a member of
// current.assignment_group. Admin is auto-set as assigned_to on POST when omitted,
// so we make admin a member of all 6 groups up-front.
async function setupAssignmentGroups(): Promise<void> {
  console.log('\n👥 Ensuring assignment groups exist + admin is a member…');
  for (const name of ASSIGNMENT_GROUPS) {
    // Look up by exact name
    const found = await snowGet('sys_user_group', `name=${name}`, ['sys_id', 'name'], 1);
    let groupSysId: string;
    if (found.length > 0) {
      groupSysId = (found[0].sys_id?.value ?? found[0].sys_id) as string;
    } else {
      const r = await snowPost('sys_user_group', { name, description: `[DEMO] ${name}`, active: 'true' });
      groupSysId = (r.sys_id?.value ?? r.sys_id) as string;
      console.log(`  + created group ${name}`);
    }
    GROUP_SYS_IDS[name] = groupSysId;

    // Membership idempotent
    const member = await snowGet('sys_user_grmember', `user=${ADMIN_SYS_ID}^group=${groupSysId}`, ['sys_id'], 1);
    if (member.length === 0) {
      await snowPost('sys_user_grmember', { user: ADMIN_SYS_ID, group: groupSysId });
      console.log(`  + admin added to ${name}`);
    }
  }
  console.log(`  resolved ${Object.keys(GROUP_SYS_IDS).length}/${ASSIGNMENT_GROUPS.length} groups`);
}

function pickGroupSysId(): string {
  const name = pick(ASSIGNMENT_GROUPS);
  return GROUP_SYS_IDS[name] ?? ADMIN_SYS_ID;
}
const SUBCATEGORIES: Record<string, readonly string[]> = {
  software: ['email', 'collaboration', 'erp', 'crm', 'productivity'],
  hardware: ['laptop', 'desktop', 'server', 'printer', 'mobile'],
  network: ['vpn', 'wifi', 'firewall', 'connectivity'],
  database: ['performance', 'replication', 'backup'],
  security: ['account', 'access', 'malware', 'phishing'],
  inquiry: ['general', 'how-to'],
};

// Sentence templates per category for realistic short_description / description
const INCIDENT_TEMPLATES: Record<string, { short: string; long: string }[]> = {
  software: [
    { short: 'Outlook unable to connect to Exchange Online', long: 'User reports Outlook stuck on "Trying to connect..." on a corporate device. ESET endpoint scan clean, no recent updates. Webmail works.' },
    { short: 'Teams desktop client crashes on startup', long: 'Teams desktop client crashes immediately after splash screen. Cache clear and reinstall did not fix. Web client works.' },
    { short: 'SharePoint document library returns 403 for some users', long: 'A subset of users in the Finance department receive 403 Forbidden when opening files. SharePoint admin shows correct group membership.' },
    { short: 'Power BI report refresh timing out', long: 'Scheduled refresh of the Daily Sales Power BI dataset times out after 60 minutes. Underlying SQL query completes in 4 minutes when run directly.' },
    { short: 'CRM record save throws "Object reference" error', long: 'Sales reps unable to save Opportunity records in Dynamics 365. Server-side trace shows null reference in custom plugin.' },
  ],
  hardware: [
    { short: 'Laptop battery not holding charge after sleep', long: 'Multiple laptops in a single delivery batch fail to wake from sleep on battery. Hard reset restores function. Vendor diagnostic shows firmware mismatch.' },
    { short: 'Office printer offline in Floor 3 wing B', long: 'Network printer LJM507 is offline. Print queue backed up. Power-cycled printer; status now "Toner low" but unable to print.' },
    { short: 'External monitor flickers on docking station', long: 'When laptop is docked, secondary monitor flickers every ~10 seconds. Different cable, different monitor — same behavior. Suggests dock firmware.' },
    { short: 'Server fan speed alarm in DC1 rack 14', long: 'Out-of-band management reports fan 3 spinning at 8800 RPM with high-temp warning on PSU2. Workload at 35%, room temp normal.' },
  ],
  network: [
    { short: 'VPN connection drops every 30 minutes', long: 'Remote workers report Always On VPN disconnects roughly every 30 minutes, forcing re-authentication. Firewall logs show idle timeout being hit despite traffic.' },
    { short: 'Wi-Fi authentication failures in Building 4', long: 'Multiple users in Building 4 cannot authenticate to the corporate SSID. RADIUS logs show certificate validation errors. Building 1-3 unaffected.' },
    { short: 'Firewall rule blocking legitimate traffic to vendor API', long: 'Newly deployed firewall rule blocks outbound HTTPS to a payments vendor API. Traffic was previously allowed under a broader rule.' },
    { short: 'Slow network performance to East-US datacenter', long: 'Application teams report latency between AWS us-east-1 workloads and our East-US datacenter has tripled overnight. ExpressRoute throughput is normal.' },
  ],
  database: [
    { short: 'SQL Server tempdb growth alarm', long: 'tempdb on PROD-SQL-01 grew from 8 GB to 64 GB overnight, triggering low-disk alerts. No schema changes shipped in the last 7 days.' },
    { short: 'Always-On AG synchronization lag breached SLA', long: 'AG REPL_AG_SALES showing 45 min lag on the secondary replica. Network throughput between primary and secondary is healthy.' },
    { short: 'Cosmos DB throttled requests on customer container', long: 'Sustained 429 Too Many Requests on the customer container with throughput at 80% of provisioned RU. No code change since last week.' },
    { short: 'Postgres replication slot spilling to disk', long: 'Replication slot on standby1 has 12 GB of WAL queued. Subscriber service is alive but not consuming. Disk pressure increasing.' },
  ],
  security: [
    { short: 'Suspicious sign-in detected from unfamiliar location', long: 'Microsoft Entra ID risky sign-in alert: user account flagged for impossible-travel from a country the user has never accessed from. Account locked pending review.' },
    { short: 'Phishing email reported by 14 users', long: 'Identical phishing email impersonating IT support reported via Report Phishing button. Subject: "Action required: password expiry". Currently being purged via PowerShell ZAP.' },
    { short: 'Defender ATP isolated endpoint due to ransomware indicator', long: 'A finance laptop was auto-isolated by Defender for Endpoint after detecting ransomware-like file rename activity. User on remote leave.' },
    { short: 'Account lockout storm against admin@ tenant', long: '500+ failed sign-ins against the admin tenant account from a single APAC IP block in the last hour. Conditional Access blocked all attempts. Investigating.' },
  ],
  inquiry: [
    { short: 'How do I reset my MFA device?', long: 'User got a new phone and needs guidance to re-register MFA. Asked via the IT chat channel.' },
    { short: 'Request: license for Visio Plan 2', long: 'Marketing team member needs Visio Plan 2 license for a project. Approval flow required from cost-centre owner.' },
    { short: 'Can I install a free PDF editor on my laptop?', long: 'User asked if a specific freeware PDF editor is allowed under our software policy. Pointed to the approved-software list.' },
  ],
};

const CHANGE_TEMPLATES = [
  { short: 'Patch RHEL servers in PROD ring (March cycle)', long: 'Apply March 2026 security errata to 240 RHEL servers in PROD via Ansible. Rolling reboot in 5 batches.', risk: 'Moderate', type: 'normal' },
  { short: 'Upgrade SQL Server 2019 to 2022 on PROD-SQL-01', long: 'In-place upgrade of SQL Server 2019 → 2022 on the primary SQL node. Rollback via VM snapshot.', risk: 'High', type: 'normal' },
  { short: 'Failover ExpressRoute primary to secondary circuit', long: 'Scheduled failover to validate the secondary ER circuit. 30-second control-plane hiccup expected.', risk: 'Moderate', type: 'normal' },
  { short: 'Deploy new firewall rule for SaaS vendor', long: 'Add firewall rule allowing outbound 443 to vendor.example.com for new payments integration.', risk: 'Low', type: 'standard' },
  { short: 'Roll back failed application release v2.4.1', long: 'Roll back the release that caused 504 errors in core banking API. Hotfix candidate v2.4.2 in test.', risk: 'High', type: 'emergency' },
  { short: 'Decommission EOL Windows Server 2012 R2 hosts', long: 'Decommission 18 hosts running Windows Server 2012 R2 (EOL 2023). Workloads migrated to WS2022.', risk: 'Low', type: 'normal' },
  { short: 'Scale Cosmos DB autoscale ceiling for peak season', long: 'Raise autoscale max RU from 4000 → 10000 on customer container ahead of campaign launch.', risk: 'Low', type: 'standard' },
  { short: 'Deploy Defender for Cloud baseline policies', long: 'Apply CIS Microsoft Azure Foundations baseline to non-production subscriptions.', risk: 'Low', type: 'normal' },
  { short: 'Replace certificate on api.example.com', long: 'Rotate the production certificate before expiry. New certificate in Key Vault, ACME automation in place.', risk: 'Low', type: 'standard' },
  { short: 'Database parameter tuning for Postgres replicas', long: 'Tune max_wal_size, checkpoint_timeout, and effective_cache_size on standby replicas.', risk: 'Moderate', type: 'normal' },
];

const PROBLEM_TEMPLATES = [
  { short: 'Recurring SQL tempdb growth on PROD-SQL-01', long: 'Three P2 incidents in 30 days traced to runaway tempdb growth. Root cause likely a cursor-based stored proc.', knownError: true, workaround: 'Restart SQL service; reduce cursor scope until permanent fix shipped.' },
  { short: 'Intermittent VPN drops on AOVPN tunnel', long: 'Pattern of every-30-minute drops correlated with idle-timeout setting on Routing & Remote Access service.', knownError: true, workaround: 'Set keepalive in client profile until policy change is approved.' },
  { short: 'Cosmos DB throttling on customer container', long: 'Throttling spikes track to a specific batch ingest job that runs at 02:00 UTC. RU exhaustion identified.', knownError: false, workaround: '' },
  { short: 'Outlook autodiscover failures for new hires', long: 'New hires in the marketing OU consistently fail Autodiscover for first 4-8 hours. AD replication latency suspected.', knownError: true, workaround: 'Manual XML autoconfig pushed via Intune until replication issue closed.' },
  { short: 'Wi-Fi auth failures in Building 4 wing C', long: 'Repeating RADIUS cert validation errors localized to one Aruba AP cluster. Firmware mismatch suspected.', knownError: true, workaround: 'Disable problematic APs and rely on adjacent coverage during business hours.' },
  { short: 'Power BI scheduled refresh slowdown', long: 'Several Power BI datasets refresh 3x slower than two months ago despite no source changes. Service degradation? Premium SKU sizing?', knownError: false, workaround: '' },
];

const KB_TEMPLATES = [
  { title: 'How to reset MFA when you have a new phone', text: 'Step-by-step procedure for self-service MFA reset using the Azure AD MyAccount portal. Includes screenshots.', category: 'Identity' },
  { title: 'Runbook: SQL tempdb runaway growth', text: 'Procedure for triaging tempdb growth alarms on PROD-SQL nodes. Includes safe restart steps and the tracking ticket for the cursor-based proc fix.', category: 'Database' },
  { title: 'Runbook: VPN keepalive workaround', text: 'How to push the keepalive setting to AOVPN clients via Intune to avoid idle disconnects.', category: 'Network' },
  { title: 'Runbook: Outlook Autodiscover for new hires', text: 'Manual XML profile push procedure for new hires whose Autodiscover is failing during the first 4-8 hours.', category: 'M365' },
  { title: 'How to request a software license', text: 'Self-service flow for requesting Visio, Project, Adobe Creative Cloud, and other approved software via the Service Catalog.', category: 'Service Catalog' },
  { title: 'Approved Software List (Q2 2026)', text: 'Master list of software approved for installation on corporate laptops. Updated quarterly. Includes vendor, version, security review status.', category: 'Compliance' },
  { title: 'Runbook: SharePoint 403 Forbidden triage', text: 'Triage steps for SharePoint Online 403 errors when users have correct group membership. Covers cached tokens, conditional access, and SP admin permissions.', category: 'M365' },
  { title: 'Phishing reporting and ZAP procedure', text: 'How to use the Report Phishing button and what the IT security team does next (purge via PowerShell ZAP, user notification).', category: 'Security' },
  { title: 'Risky sign-in response procedure', text: 'Standard response when Entra ID flags a risky sign-in: account lock, user contact, password reset, MFA re-enrollment.', category: 'Security' },
  { title: 'How to request a new laptop', text: 'Service Catalog item walkthrough for laptop requests. Covers SLAs, model options, and accessory bundles.', category: 'Service Catalog' },
  { title: 'AOVPN troubleshooting checklist', text: 'Field guide for Always On VPN: certificate validation, gateway reachability, idle timeout, keepalive.', category: 'Network' },
  { title: 'Power BI scheduled refresh diagnostics', text: 'Where to look first when scheduled refresh slows down: gateway logs, source query plans, Premium capacity metrics.', category: 'Analytics' },
  { title: 'SQL Always-On replication lag triage', text: 'Procedure for triaging AG synchronization lag, including network throughput, replica IO, and log buffer pressure.', category: 'Database' },
  { title: 'Cosmos DB 429 troubleshooting', text: 'Diagnose Cosmos DB 429 errors: hot partition keys, sustained vs spike RU, autoscale ceiling sizing.', category: 'Database' },
  { title: 'Defender for Endpoint isolated host playbook', text: 'Procedure for unblocking endpoints isolated by Defender for Endpoint after auto-investigation closes the case.', category: 'Security' },
  { title: 'How to onboard a new joiner laptop', text: 'IT side of the new-hire onboarding flow: Intune enrolment, Autopilot, application baselines, access provisioning.', category: 'Onboarding' },
  { title: 'Standard change: deploy firewall allow rule', text: 'Pre-approved standard change for firewall allow rules to vetted SaaS vendors. Risk: Low. Implementation window: any.', category: 'Change' },
  { title: 'Emergency change procedure', text: 'How to invoke the emergency change procedure (CAB chair on-call, evidence requirements, post-implementation review timeline).', category: 'Change' },
  { title: 'Tempdb monitoring dashboard', text: 'Where the tempdb size and queries dashboard lives in Azure Monitor and how to read it.', category: 'Monitoring' },
  { title: 'Capacity reporting for SQL nodes', text: 'How the monthly SQL capacity report is generated and which thresholds trigger upgrade conversations.', category: 'Capacity' },
  { title: 'CMDB CI ownership transfer', text: 'Procedure for transferring CI ownership in the CMDB when a team is reorganized or service is moved.', category: 'CMDB' },
  { title: 'Knowledge contribution guidelines', text: 'How engineers can contribute new KB articles after closing an incident. Templates and review process.', category: 'Knowledge' },
  { title: 'Service request SLA matrix', text: 'Standard SLAs for service catalog items: P1 fulfilment 4h, P2 1 business day, P3 3 business days, P4 5 business days.', category: 'SLM' },
  { title: 'Backup and restore policy', text: 'Backup retention policy for VMs, SQL, file shares. Includes restore-test cadence and evidence storage location.', category: 'Continuity' },
  { title: 'Asset return on departure', text: 'IT side of the leaver flow: laptop wipe, peripheral collection, license reclaim.', category: 'Offboarding' },
];

const SR_TEMPLATES = [
  { short: 'New hire laptop request', desc: 'Standard issue laptop for a new hire starting next Monday.' },
  { short: 'Software request: Visio Plan 2', desc: 'Visio Plan 2 license for upcoming process-mapping project.' },
  { short: 'Password reset for service account', desc: 'Service account credentials need rotation per quarterly policy.' },
  { short: 'Hardware accessory: docking station', desc: 'Replacement docking station for hot-desk station 4-12.' },
  { short: 'Mobile phone request', desc: 'Corporate mobile phone for new sales team member.' },
  { short: 'External vendor account setup', desc: 'Temporary AAD guest account for vendor consultant working on Q2 project.' },
  { short: 'VPN access for new contractor', desc: 'AOVPN access for a 3-month contractor on the platform team.' },
  { short: 'Removable media exception', desc: 'Time-limited USB write exception for engineer attending offline lab.' },
  { short: 'Office relocation: floor 5', desc: 'Move 24 desks worth of IT kit to floor 5 over the weekend.' },
  { short: 'Asset return: leaver', desc: 'Laptop and peripheral return for leaver in finance team.' },
];

// ── Bulk close currently-open incidents ──────────────────────────────────
async function closeOpenIncidents(): Promise<number> {
  console.log('\n🧹 Closing currently-open incidents…');
  const open = await snowGet('incident', 'stateIN1,2,3', ['sys_id', 'number'], 500);
  console.log(`  found ${open.length} open incident(s)`);
  if (open.length === 0) return 0;

  const todayStr = new Date().toISOString().slice(0, 10);
  const resolvedAt = snowDate(addHours(new Date(), -1));
  const closedAt = snowDate(new Date());

  let closed = 0;
  let failed = 0;
  let firstErr: string | null = null;
  for (const inc of open) {
    const sysId = (inc.sys_id?.value ?? inc.sys_id) as string;
    const num = inc.number?.value ?? inc.number;
    let stepErr: string | null = null;
    try {
      // Two-step is the safer path on PDIs: Resolved (state 6) sets resolution timestamps, then Close (7).
      try {
        await snowPatch('incident', sysId, {
          state: '6',
          close_code: 'Solution provided',
          close_notes: `Bulk-closed during demo data refresh on ${todayStr}. No customer impact.`,
          resolved_at: resolvedAt,
          resolved_by: ADMIN_SYS_ID,
          assigned_to: ADMIN_SYS_ID,
        });
      } catch (err) {
        stepErr = `step1(resolve): ${(err as Error).message}`;
        throw err;
      }
      try {
        await snowPatch('incident', sysId, {
          state: '7',
          closed_at: closedAt,
        });
      } catch (err) {
        stepErr = `step2(close): ${(err as Error).message}`;
        throw err;
      }
      closed++;
      if (VERBOSE) console.log(`  ✓ closed ${num}`);
    } catch {
      failed++;
      if (!firstErr && stepErr) firstErr = `${num}: ${stepErr}`;
      if (VERBOSE && stepErr) console.warn(`  ✗ ${num}: ${stepErr}`);
    }
  }
  console.log(`  closed ${closed}/${open.length}${failed ? `, ${failed} failed` : ''}`);
  if (firstErr) console.log(`  first failure → ${firstErr}`);
  return closed;
}

// ── Optional: clear existing [DEMO] records ──────────────────────────────
async function clearDemo(): Promise<void> {
  console.log('\n🗑  Clearing existing [DEMO] records…');
  const tables: { table: string; field: string; label: string }[] = [
    { table: 'task_sla', field: 'short_description', label: 'Task SLAs' },
    { table: 'sc_request', field: 'short_description', label: 'Service Requests' },
    { table: 'incident', field: 'short_description', label: 'Incidents' },
    { table: 'change_request', field: 'short_description', label: 'Change Requests' },
    { table: 'problem', field: 'short_description', label: 'Problems' },
    { table: 'kb_knowledge', field: 'short_description', label: 'KB articles' },
  ];
  for (const t of tables) {
    const recs = await snowGet(t.table, `${t.field}LIKE${DEMO_PREFIX}`, ['sys_id'], 500);
    let deleted = 0;
    for (const r of recs) {
      try {
        await snowDelete(t.table, (r.sys_id?.value ?? r.sys_id) as string);
        deleted++;
      } catch { /* ignore */ }
    }
    console.log(`  ${t.label}: deleted ${deleted}/${recs.length}`);
  }
}

// ── Seed: incidents (~250 across 120 days) ──────────────────────────────
async function seedIncidents(): Promise<{ created: number; ids: string[] }> {
  console.log('\n🔥 Seeding incidents (4 months of history)…');
  const N = 250;
  const ids: string[] = [];
  let created = 0;

  for (let i = 0; i < N; i++) {
    // Priority distribution: P1 5%, P2 15%, P3 50%, P4 30%
    const priority = pickWeighted([
      { v: '1', w: 5 },
      { v: '2', w: 15 },
      { v: '3', w: 50 },
      { v: '4', w: 30 },
    ]);
    // Resolution time per priority (hours)
    const resolveHours =
      priority === '1' ? randInt(1, 6) :
      priority === '2' ? randInt(2, 24) :
      priority === '3' ? randInt(4, 72) :
      randInt(8, 168);

    // State distribution: 80% closed, 10% resolved, 10% active
    const state = pickWeighted([
      { v: '7', w: 80 }, // Closed
      { v: '6', w: 10 }, // Resolved
      { v: '2', w: 7 },  // In Progress (active)
      { v: '1', w: 2 },  // New (active)
      { v: '3', w: 1 },  // On Hold (active)
    ]);
    const isActive = state === '1' || state === '2' || state === '3';

    // opened_at distributed across last 120 days; active ones recent.
    const daysAgo = isActive ? randInt(0, 14) : randInt(1, 120);
    const opened = daysAgoUtc(daysAgo, randInt(7, 19));
    const resolved = isActive ? null : addHours(opened, resolveHours);
    const closed = state === '7' && resolved ? addHours(resolved, randInt(0, 24)) : null;

    const cat = pick(CATEGORIES);
    const sub = pick(SUBCATEGORIES[cat] ?? ['general']);
    const tpl = pick(INCIDENT_TEMPLATES[cat] ?? INCIDENT_TEMPLATES.software);
    const groupSysId = pickGroupSysId();
    const impact = priority === '1' ? '1' : priority === '2' ? '2' : '3';
    const urgency = priority === '1' || priority === '2' ? '1' : priority === '3' ? '2' : '3';

    const body: Record<string, unknown> = {
      short_description: `${DEMO_PREFIX} ${tpl.short}`,
      description: tpl.long,
      priority,
      state,
      impact,
      urgency,
      category: cat,
      subcategory: sub,
      assignment_group: groupSysId,
      assigned_to: ADMIN_SYS_ID,
      opened_at: snowDate(opened),
    };
    if (resolved) {
      body.resolved_at = snowDate(resolved);
      body.resolved_by = ADMIN_SYS_ID;
      body.assigned_to = ADMIN_SYS_ID;
      body.close_code = pick(INCIDENT_CLOSE_CODES);
      body.close_notes = `Resolved by ${tpl.short}.`;
    }
    if (closed) body.closed_at = snowDate(closed);

    try {
      const r = await snowPost('incident', body);
      const sysId = (r.sys_id?.value ?? r.sys_id) as string;
      if (sysId) ids.push(sysId);
      created++;
      if (VERBOSE && created % 25 === 0) console.log(`  ${created}/${N}`);
    } catch (err) {
      console.warn(`  ✗ incident #${i}: ${(err as Error).message}`);
    }
  }
  console.log(`  created ${created}/${N} incidents`);
  return { created, ids };
}

// ── Seed: changes (~80 across 120 days) ──────────────────────────────────
async function seedChanges(): Promise<number> {
  console.log('\n🔄 Seeding change requests…');
  const N = 80;
  let created = 0;
  for (let i = 0; i < N; i++) {
    const tpl = pick(CHANGE_TEMPLATES);
    // ServiceNow change states: -5=New, -4=Assess, -3=Authorize, -2=Scheduled, -1=Implement, 0=Review, 3=Closed, 4=Canceled
    const isHistorical = rand() < 0.85;
    const state = isHistorical ? '3' : pickWeighted([
      { v: '-2', w: 30 }, // Scheduled
      { v: '-3', w: 25 }, // Authorize
      { v: '-1', w: 15 }, // Implement
      { v: '-4', w: 15 }, // Assess
      { v: '0', w: 10 },  // Review
      { v: '-5', w: 5 },  // New
    ]);
    const daysAgo = isHistorical ? randInt(7, 120) : randInt(-7, 14); // upcoming changes ahead
    const opened = daysAgoUtc(Math.max(daysAgo, 0), randInt(9, 17));
    const startPlanned = addHours(opened, randInt(48, 240));
    const endPlanned = addHours(startPlanned, randInt(1, 4));

    const body: Record<string, unknown> = {
      short_description: `${DEMO_PREFIX} ${tpl.short}`,
      description: tpl.long,
      type: tpl.type,
      risk: tpl.risk === 'High' ? '2' : tpl.risk === 'Moderate' ? '3' : '4',
      impact: tpl.risk === 'High' ? '1' : tpl.risk === 'Moderate' ? '2' : '3',
      state,
      category: 'Other',
      assignment_group: pickGroupSysId(),
      assigned_to: ADMIN_SYS_ID,
      opened_at: snowDate(opened),
      start_date: snowDate(startPlanned),
      end_date: snowDate(endPlanned),
      justification: `Required for stability and compliance. ${tpl.long}`,
      implementation_plan: 'See attached runbook in Knowledge Base.',
      backout_plan: 'Restore from snapshot or revert configuration as documented in runbook.',
      test_plan: 'Smoke tests post-implementation; monitor for 60 minutes; PIR scheduled within 5 days.',
    };
    if (state === '3') {
      const closed = addHours(endPlanned, randInt(1, 24));
      body.closed_at = snowDate(closed);
      body.close_code = pick(['successful', 'successful_issues']);
      body.close_notes = 'Change completed within window. PIR scheduled.';
    }
    try {
      await snowPost('change_request', body);
      created++;
    } catch (err) {
      console.warn(`  ✗ change #${i}: ${(err as Error).message}`);
    }
  }
  console.log(`  created ${created}/${N} changes`);
  return created;
}

// ── Seed: problems (~30) ─────────────────────────────────────────────────
async function seedProblems(): Promise<number> {
  console.log('\n🔍 Seeding problems…');
  const N = 30;
  let created = 0;
  for (let i = 0; i < N; i++) {
    const tpl = PROBLEM_TEMPLATES[i % PROBLEM_TEMPLATES.length];
    // PDI Problem Model business rule blocks inserting in non-101 states.
    // Always insert as 101 (Open). Real demo flows can transition via UI/agent later.
    const state = '101';
    const opened = daysAgoUtc(randInt(7, 110), randInt(9, 17));

    const body: Record<string, unknown> = {
      short_description: `${DEMO_PREFIX} ${tpl.short}${i >= PROBLEM_TEMPLATES.length ? ` (cluster ${Math.floor(i / PROBLEM_TEMPLATES.length) + 1})` : ''}`,
      description: tpl.long,
      state,
      priority: pickWeighted([{ v: '2', w: 30 }, { v: '3', w: 50 }, { v: '4', w: 20 }]),
      impact: '2',
      urgency: '2',
      assignment_group: pickGroupSysId(),
      assigned_to: ADMIN_SYS_ID,
      opened_at: snowDate(opened),
      cause_notes: `Investigation traced to ${tpl.short.toLowerCase()}. Root cause analysis ongoing.`,
      // PDI data policy demands resolution_code on insert; set unconditionally
      resolution_code: pick(PROBLEM_RESOLUTION_CODES),
      fix_notes: `Working hypothesis: ${tpl.short}. ${tpl.long}`,
      close_notes: `${tpl.short}. Fix or workaround applied.`,
    };
    if (tpl.knownError) {
      body.known_error = 'true';
      body.workaround = tpl.workaround;
    }
    try {
      await snowPost('problem', body);
      created++;
    } catch (err) {
      console.warn(`  ✗ problem #${i}: ${(err as Error).message}`);
    }
  }
  console.log(`  created ${created}/${N} problems`);
  return created;
}

// ── Seed: knowledge articles (~25) ───────────────────────────────────────
async function seedKnowledge(): Promise<number> {
  console.log('\n📚 Seeding knowledge articles…');
  let created = 0;
  for (let i = 0; i < KB_TEMPLATES.length; i++) {
    const tpl = KB_TEMPLATES[i];
    const opened = daysAgoUtc(randInt(14, 120), randInt(9, 17));
    const body: Record<string, unknown> = {
      short_description: `${DEMO_PREFIX} ${tpl.title}`,
      text: `<p>${tpl.text}</p>`,
      kb_category: tpl.category,
      workflow_state: 'published',
      // most PDIs ship a default kb base — leave blank and let SN assign
      published: snowDate(opened),
    };
    try {
      await snowPost('kb_knowledge', body);
      created++;
    } catch (err) {
      console.warn(`  ✗ kb #${i}: ${(err as Error).message}`);
    }
  }
  console.log(`  created ${created}/${KB_TEMPLATES.length} KB articles`);
  return created;
}

// ── Seed: service requests (~50) ─────────────────────────────────────────
async function seedServiceRequests(): Promise<number> {
  console.log('\n📦 Seeding service requests…');
  const N = 50;
  let created = 0;
  for (let i = 0; i < N; i++) {
    const tpl = pick(SR_TEMPLATES);
    // sc_request request_state values: requested, in_process, delivered, closed_complete, closed_cancelled
    const state = pickWeighted([
      { v: 'closed_complete', w: 60 },
      { v: 'in_process', w: 20 },
      { v: 'requested', w: 15 },
      { v: 'closed_cancelled', w: 5 },
    ]);
    const opened = daysAgoUtc(randInt(1, 120), randInt(8, 18));
    const body: Record<string, unknown> = {
      short_description: `${DEMO_PREFIX} ${tpl.short}`,
      description: tpl.desc,
      request_state: state,
      stage: state === 'closed_complete' ? 'completed' : state === 'in_process' ? 'fulfillment' : 'request_approved',
      opened_at: snowDate(opened),
      priority: pickWeighted([{ v: '3', w: 70 }, { v: '4', w: 25 }, { v: '2', w: 5 }]),
    };
    if (state === 'closed_complete') {
      const closed = addHours(opened, randInt(8, 96));
      body.closed_at = snowDate(closed);
    }
    try {
      await snowPost('sc_request', body);
      created++;
    } catch (err) {
      console.warn(`  ✗ sr #${i}: ${(err as Error).message}`);
    }
  }
  console.log(`  created ${created}/${N} service requests`);
  return created;
}

// ── Seed: SLAs against active incidents ──────────────────────────────────
async function seedSlas(activeIds: string[]): Promise<number> {
  console.log('\n⏱  Seeding task SLAs…');
  if (activeIds.length === 0) {
    console.log('  no active incident IDs available, skipping');
    return 0;
  }
  let created = 0;
  // Mix: 60% within, 25% at-risk, 15% breached
  for (let i = 0; i < Math.min(20, activeIds.length); i++) {
    const taskId = activeIds[i];
    const profile = pickWeighted([
      { v: 'within', w: 60 },
      { v: 'risk', w: 25 },
      { v: 'breached', w: 15 },
    ]);
    const start = daysAgoUtc(randInt(0, 3), randInt(8, 18));
    const planned = addHours(start, profile === 'breached' ? -2 : profile === 'risk' ? 2 : 8);
    const body: Record<string, unknown> = {
      task: taskId,
      short_description: `${DEMO_PREFIX} ${profile === 'breached' ? 'Breached' : profile === 'risk' ? 'At-risk' : 'On track'} resolution SLA`,
      stage: profile === 'breached' ? 'breached' : 'in_progress',
      has_breached: profile === 'breached' ? 'true' : 'false',
      start_time: snowDate(start),
      planned_end_time: snowDate(planned),
      business_percentage: profile === 'breached' ? '125' : profile === 'risk' ? '85' : '40',
    };
    try {
      await snowPost('task_sla', body);
      created++;
    } catch (err) {
      console.warn(`  ✗ sla #${i}: ${(err as Error).message}`);
    }
  }
  console.log(`  created ${created} task SLAs`);
  return created;
}

// ── Verify counts ────────────────────────────────────────────────────────
async function verifyCounts(): Promise<void> {
  console.log('\n📊 Post-run counts:');
  const checks: { table: string; query: string; label: string }[] = [
    { table: 'incident', query: '', label: 'Total incidents' },
    { table: 'incident', query: 'active=true', label: '  open' },
    { table: 'incident', query: `short_descriptionLIKE${DEMO_PREFIX}`, label: '  [DEMO]' },
    { table: 'change_request', query: '', label: 'Total changes' },
    { table: 'change_request', query: `short_descriptionLIKE${DEMO_PREFIX}`, label: '  [DEMO]' },
    { table: 'problem', query: '', label: 'Total problems' },
    { table: 'problem', query: `short_descriptionLIKE${DEMO_PREFIX}`, label: '  [DEMO]' },
    { table: 'kb_knowledge', query: '', label: 'Total KB articles' },
    { table: 'kb_knowledge', query: `short_descriptionLIKE${DEMO_PREFIX}`, label: '  [DEMO]' },
    { table: 'sc_request', query: '', label: 'Total service requests' },
    { table: 'sc_request', query: `short_descriptionLIKE${DEMO_PREFIX}`, label: '  [DEMO]' },
    { table: 'task_sla', query: `short_descriptionLIKE${DEMO_PREFIX}`, label: '[DEMO] SLAs' },
  ];
  for (const c of checks) {
    try {
      const n = await snowGetCount(c.table, c.query);
      console.log(`  ${c.label.padEnd(28)} ${n}`);
    } catch (err) {
      console.log(`  ${c.label.padEnd(28)} ERROR: ${(err as Error).message}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
(async () => {
  console.log('═══════════════════════════════════════════════════');
  console.log('  ServiceNow 4-Month ITIL v4 Demo Data Seeder');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Instance:   ${SNOW_INSTANCE}`);
  console.log(`  Auth:       Basic (admin)`);
  console.log(`  Mode:       ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}${CLOSE_ONLY ? ' close-only' : ''}${SEED_ONLY ? ' seed-only' : ''}${CLEAR_FIRST ? ' --clear' : ''}`);
  console.log(`  Today:      ${new Date().toISOString().slice(0, 10)}`);
  console.log('═══════════════════════════════════════════════════');

  const summary: Record<string, number> = {};

  if (!SEED_ONLY) {
    summary.incidentsClosed = await closeOpenIncidents();
  }
  if (CLOSE_ONLY) {
    await verifyCounts();
    return;
  }

  if (CLEAR_FIRST) {
    await clearDemo();
  }

  // Resolve assignment_group sys_ids and ensure admin membership BEFORE any seeding
  await setupAssignmentGroups();

  if (PROBLEMS_ONLY) {
    summary.problems = await seedProblems();
    console.log('\n✅ Done (problems-only).\n');
    await verifyCounts();
    return;
  }

  const inc = await seedIncidents();
  summary.incidents = inc.created;
  summary.changes = await seedChanges();
  summary.problems = await seedProblems();
  summary.knowledge = await seedKnowledge();
  summary.serviceRequests = await seedServiceRequests();
  // SLAs: link to first 20 active incident sys_ids we just created
  // (those without resolved_at field set will most reliably be active)
  summary.taskSlas = await seedSlas(inc.ids.slice(0, 20));

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Seed Summary');
  console.log('═══════════════════════════════════════════════════');
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k.padEnd(22)} ${v}`);
  }

  await verifyCounts();
  console.log('\n✅ Done.\n');
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
