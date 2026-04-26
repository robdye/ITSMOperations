/**
 * ServiceNow Demo Data Seeding Script
 *
 * Creates realistic ITSM demo data in a ServiceNow dev instance for a
 * financial-services firm scenario. All records are prefixed with "[DEMO]"
 * so they can be identified and cleaned up with clearDemoData().
 */

import { getAuthHeaders } from './snow-auth.js';

const SNOW_INSTANCE = process.env.SNOW_INSTANCE || '';
const DEMO_PREFIX = '[DEMO]';

// ── Low-level helpers ───────────────────────────────────────────────────────

async function snowPost(table: string, body: Record<string, unknown>): Promise<any> {
  const url = `${SNOW_INSTANCE}/api/now/table/${encodeURIComponent(table)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${table} failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return json.result ?? {};
}

async function snowGet(table: string, query: string, fields: string[], limit = 10): Promise<any[]> {
  const params = new URLSearchParams({
    sysparm_query: query,
    sysparm_fields: fields.join(','),
    sysparm_limit: String(limit),
  });
  const url = `${SNOW_INSTANCE}/api/now/table/${encodeURIComponent(table)}?${params}`;
  const res = await fetch(url, { headers: await getAuthHeaders() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${table} failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return json.result ?? [];
}

async function snowDelete(table: string, sysId: string): Promise<void> {
  const url = `${SNOW_INSTANCE}/api/now/table/${encodeURIComponent(table)}/${sysId}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: await getAuthHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DELETE ${table}/${sysId} failed (${res.status}): ${text}`);
  }
}

function isoDate(daysAgo: number, hours = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(d.getHours() - hours);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

// ── Record definitions ──────────────────────────────────────────────────────

interface SeedResult {
  incidents: number;
  changeRequests: number;
  problems: number;
  cmdbCis: number;
  taskSlas: number;
  errors: string[];
}

// ServiceNow incident states: 1=New, 2=In Progress, 3=On Hold, 6=Resolved, 7=Closed
// Priorities: 1=Critical, 2=High, 3=Moderate, 4=Low

const INCIDENTS: Record<string, unknown>[] = [
  // P1 – 2 records
  { short_description: `${DEMO_PREFIX} Core banking API latency exceeding 5s SLA`, description: 'Multiple API endpoints returning 504 errors. Payment processing queue depth growing. Customer-facing transactions failing intermittently.', priority: '1', state: '2', category: 'Software', assignment_group: 'Application Support', impact: '1', urgency: '1' },
  { short_description: `${DEMO_PREFIX} Trading platform authentication failures across all regions`, description: 'OAuth token refresh failing for trading platform SSO. Traders unable to log in since 06:45 UTC. Affects all three regional deployments.', priority: '1', state: '2', category: 'Security', assignment_group: 'Security Operations', impact: '1', urgency: '1' },
  // P2 – 4 records
  { short_description: `${DEMO_PREFIX} Oracle RAC node 2 experiencing excessive checkpoint waits`, description: 'Alert from OEM showing checkpoint wait events exceeding 500ms on RAC node 2. Read-heavy batch jobs running 40% slower than baseline.', priority: '2', state: '2', category: 'Database', assignment_group: 'Database Administration', impact: '2', urgency: '2' },
  { short_description: `${DEMO_PREFIX} Email gateway dropping attachments over 25MB`, description: 'Compliance team reports that attachments over 25MB are being silently dropped by the SMTP relay. Affects regulatory filing submissions.', priority: '2', state: '3', category: 'Software', assignment_group: 'IT Operations', impact: '2', urgency: '2' },
  { short_description: `${DEMO_PREFIX} VPN concentrator failover not triggering on primary failure`, description: 'Monitoring detected primary VPN concentrator went offline for 12 minutes without automatic failover to secondary. 340 remote users affected.', priority: '2', state: '1', category: 'Network', assignment_group: 'Network Engineering', impact: '2', urgency: '2' },
  { short_description: `${DEMO_PREFIX} Kubernetes pod evictions on production AKS cluster`, description: 'Resource pressure causing frequent pod evictions on prod-aks-east. Customer portal microservices restarting every 15-20 minutes.', priority: '2', state: '2', category: 'Software', assignment_group: 'Application Support', impact: '2', urgency: '2' },
  // P3 – 5 records
  { short_description: `${DEMO_PREFIX} Print server queue stuck for 3rd floor finance department`, description: 'Print jobs queuing but not releasing to HP LaserJet 4250 on floor 3. Spooler restart clears temporarily but recurs within an hour.', priority: '3', state: '1', category: 'Hardware', assignment_group: 'IT Operations', impact: '3', urgency: '3' },
  { short_description: `${DEMO_PREFIX} SSL certificate expiring in 7 days on customer portal`, description: 'DigiCert wildcard cert for *.customerportal.example.com expires 2026-02-15. Auto-renewal failed due to DNS validation timeout.', priority: '3', state: '6', category: 'Security', assignment_group: 'Security Operations', impact: '3', urgency: '2' },
  { short_description: `${DEMO_PREFIX} Data warehouse ETL job failing on currency conversion step`, description: 'Nightly ETL pipeline fails at stage 14 (FX rate lookup). Source API returning HTTP 403 since credentials were rotated last Friday.', priority: '3', state: '6', category: 'Database', assignment_group: 'Database Administration', impact: '3', urgency: '3' },
  { short_description: `${DEMO_PREFIX} VLAN trunking errors between core switch and distribution layer`, description: 'CRC errors and frame drops on trunk port Gi0/1 between core-sw-01 and dist-sw-03. Affecting 2nd floor east wing connectivity.', priority: '3', state: '2', category: 'Network', assignment_group: 'Network Engineering', impact: '3', urgency: '3' },
  { short_description: `${DEMO_PREFIX} Compliance dashboard showing stale data after migration`, description: 'SOX compliance dashboard still reading from legacy SQL Server after migration to new data warehouse. Reports are 72 hours behind.', priority: '3', state: '6', category: 'Software', assignment_group: 'Application Support', impact: '3', urgency: '3' },
  // P4 – 4 records
  { short_description: `${DEMO_PREFIX} Desktop wallpaper GPO not applying to new Windows 11 builds`, description: 'Corporate branding wallpaper GPO failing on Windows 11 23H2 machines. Low priority cosmetic issue affecting new hires.', priority: '4', state: '1', category: 'Software', assignment_group: 'IT Operations', impact: '3', urgency: '4' },
  { short_description: `${DEMO_PREFIX} Conference room B12 projector showing color banding`, description: 'Epson projector in boardroom B12 displaying visible color banding on gradient backgrounds. Still functional but presentation quality degraded.', priority: '4', state: '3', category: 'Hardware', assignment_group: 'IT Operations', impact: '3', urgency: '4' },
  { short_description: `${DEMO_PREFIX} Request to add SNMP monitoring for new UPS units`, description: 'Facilities installed two APC Smart-UPS 3000 units in MDF closet. Need SNMP trap receivers configured in SolarWinds for power monitoring.', priority: '4', state: '7', category: 'Network', assignment_group: 'Network Engineering', impact: '3', urgency: '4' },
  { short_description: `${DEMO_PREFIX} Legacy COBOL batch report formatting misaligned after font update`, description: 'Mainframe batch reports printing with column misalignment after server-side font package update. Only affects printed copies, PDF export is fine.', priority: '4', state: '7', category: 'Software', assignment_group: 'Application Support', impact: '3', urgency: '4' },
];

// Change request states: -5=New, -4=Assess, -3=Authorize, -2=Scheduled, -1=Implement, 0=Review, 3=Closed
// Types: normal, standard, emergency

const CHANGE_REQUESTS: Record<string, unknown>[] = [
  // Normal – 5
  { short_description: `${DEMO_PREFIX} Upgrade Oracle RAC cluster to 19c`, description: 'Rolling upgrade of Oracle RAC from 12.2 to 19c across both nodes. Includes patching, parameter tuning, and regression testing. Change window: Saturday 22:00–Sunday 06:00.', type: 'normal', state: '-2', risk: 'high', priority: '2', category: 'Hardware', assignment_group: 'Database Administration', justification: 'Oracle 12.2 end of extended support. 19c required for new partitioning features.', backout_plan: 'Restore from RMAN backup taken at T-1h. Estimated rollback: 90 minutes.', test_plan: 'Run full regression suite against UAT clone. Validate all stored procedures and materialized views.' },
  { short_description: `${DEMO_PREFIX} Deploy Kubernetes 1.29 to production AKS clusters`, description: 'Upgrade AKS control plane and node pools from 1.27 to 1.29 across east and west regions. Includes API deprecation audit.', type: 'normal', state: '-4', risk: 'moderate', priority: '3', category: 'Software', assignment_group: 'Application Support', justification: 'K8s 1.27 falls out of AKS support next quarter. 1.29 includes gateway API GA.', backout_plan: 'AKS supports in-place downgrade for control plane. Node pools can be recreated from last known-good image.', test_plan: 'Canary deploy to staging AKS, run integration tests, validate all HPA configurations.' },
  { short_description: `${DEMO_PREFIX} Migrate corporate email to Exchange Online`, description: 'Phase 2 of M365 migration: move remaining 1,200 mailboxes from on-prem Exchange 2019 to Exchange Online. Hybrid coexistence period: 30 days.', type: 'normal', state: '-5', risk: 'moderate', priority: '3', category: 'Software', assignment_group: 'IT Operations', justification: 'On-prem Exchange hardware EOL in Q3. Consolidate to cloud-only for cost savings.', backout_plan: 'Mailboxes can be moved back via MRS within 48h. Mail flow remains via hybrid connector.', test_plan: 'Pilot batch of 50 users from IT department. Validate Outlook profiles, shared mailboxes, and calendar delegation.' },
  { short_description: `${DEMO_PREFIX} Replace DMZ firewall pair with next-gen Palo Alto 5400 series`, description: 'Swap aging Cisco ASA 5585-X pair with Palo Alto PA-5430 in active/passive HA. Migrate all NAT, ACL, and VPN configurations.', type: 'normal', state: '-3', risk: 'high', priority: '2', category: 'Hardware', assignment_group: 'Network Engineering', justification: 'ASA 5585-X EOL. PA-5430 adds SSL decryption, threat prevention, and URL filtering.', backout_plan: 'Keep ASA pair powered and cabled. Revert by swapping uplink cables and restoring BGP peering.', test_plan: 'Mirror production traffic to PA-5430 via TAP mode for 2 weeks. Compare rule hit counts.' },
  { short_description: `${DEMO_PREFIX} Implement Hashicorp Vault for secrets management`, description: 'Deploy Vault Enterprise cluster (3-node) with auto-unseal via Azure Key Vault. Migrate application secrets from environment variables and config files.', type: 'normal', state: '0', risk: 'moderate', priority: '3', category: 'Software', assignment_group: 'Security Operations', justification: 'Audit finding: secrets stored in plaintext config files violate SOC2 requirements.', backout_plan: 'Applications retain existing env-var secrets as fallback. Vault can be decommissioned without data loss.', test_plan: 'Deploy to staging, rotate 10 sample secrets, validate app retrieval via Vault agent sidecar.' },
  // Standard – 3
  { short_description: `${DEMO_PREFIX} Standard monthly Windows Server patching - February 2026`, description: 'Apply February 2026 cumulative updates to all Windows Server 2022 hosts. Follows approved standard change template SC-WIN-PATCH-001.', type: 'standard', state: '-2', risk: 'low', priority: '4', category: 'Software', assignment_group: 'IT Operations' },
  { short_description: `${DEMO_PREFIX} Add new VLAN for IoT sensor network in trading floor`, description: 'Provision VLAN 450 (10.45.0.0/24) for Bloomberg terminal environmental sensors. Standard network provisioning template.', type: 'standard', state: '-5', risk: 'low', priority: '4', category: 'Network', assignment_group: 'Network Engineering' },
  { short_description: `${DEMO_PREFIX} Expand SAN storage pool by 10TB for data warehouse`, description: 'Add 10TB SSD tier to NetApp AFF A400 aggregate for SQL data warehouse growth. Standard capacity expansion procedure.', type: 'standard', state: '3', risk: 'low', priority: '4', category: 'Hardware', assignment_group: 'IT Operations', close_code: 'successful', close_notes: 'Storage expanded successfully. Capacity verified via ONTAP System Manager.' },
  // Emergency – 2
  { short_description: `${DEMO_PREFIX} Emergency patch for CVE-2026-1234 on DMZ firewalls`, description: 'Critical RCE vulnerability in firewall management plane. CVSS 9.8. Vendor released out-of-band patch. Must apply within 24h per security policy.', type: 'emergency', state: '-1', risk: 'high', priority: '1', category: 'Hardware', assignment_group: 'Security Operations', justification: 'Active exploitation observed in the wild. CISA KEV catalog addition.', backout_plan: 'Snapshot firewall config. Revert firmware via console if patch causes instability.' },
  { short_description: `${DEMO_PREFIX} Emergency database failover due to storage controller failure`, description: 'Primary storage controller on SAN shelf 3 reporting uncorrectable errors. Preemptive failover to DR site to prevent data loss.', type: 'emergency', state: '-4', risk: 'moderate', priority: '1', category: 'Hardware', assignment_group: 'Database Administration', justification: 'Imminent risk of data loss. Storage vendor confirms controller replacement requires 12h lead time.' },
];

// Problem states: 1=New, 2=Assess (Known Error=true for KE), 3=Root Cause Analysis (RCA), 4=Fix In Progress, 5=Resolved, 6=Closed
// Using ServiceNow standard states: 101=New, 102=Assess, 103=RCA, 104=Fix In Progress, 106=Resolved, 107=Closed

const PROBLEMS: Record<string, unknown>[] = [
  // New – 2
  { short_description: `${DEMO_PREFIX} Recurring memory leaks in customer portal .NET services`, description: 'W3WP process for CustomerPortal app pool grows to 4GB+ over 48 hours, requiring manual recycling. Started after .NET 8 upgrade.', priority: '2', state: '101', category: 'Software', assignment_group: 'Application Support', impact: '2', urgency: '2' },
  { short_description: `${DEMO_PREFIX} Intermittent DNS resolution failures from on-prem to Azure Private Endpoints`, description: 'Applications sporadically fail to resolve privatelink.database.windows.net domains. Affects 3-5% of requests. Correlates with AD DNS forwarder load.', priority: '3', state: '101', category: 'Network', assignment_group: 'Network Engineering', impact: '2', urgency: '3' },
  // Assess – 2
  { short_description: `${DEMO_PREFIX} Repeated SSD failures on Dell R750xs servers in rack 12`, description: 'Three Samsung PM9A3 SSDs failed in rack 12 over the past 60 days. All from the same firmware batch. Vendor investigating potential firmware defect.', priority: '2', state: '102', category: 'Hardware', assignment_group: 'IT Operations', impact: '2', urgency: '2' },
  { short_description: `${DEMO_PREFIX} Oracle listener process crashes under high connection churn`, description: 'TNS listener on RAC node 1 crashes when connection rate exceeds 200/sec. Coincides with end-of-day batch settlement window.', priority: '3', state: '102', category: 'Database', assignment_group: 'Database Administration', impact: '3', urgency: '3' },
  // Root Cause Analysis – 1
  { short_description: `${DEMO_PREFIX} TLS 1.2 handshake failures between API gateway and backend services`, description: 'Intermittent TLS handshake failures (error 525) on 2% of API calls. RCA in progress — suspected cipher suite mismatch after load balancer firmware update.', priority: '3', state: '103', category: 'Security', assignment_group: 'Security Operations', impact: '3', urgency: '3' },
  // Known Error – 1
  { short_description: `${DEMO_PREFIX} JDBC connection pool exhaustion during market open spike`, description: 'Trading platform JDBC pool (max 200) saturates within 5 minutes of market open. Connection leak in order-validation microservice confirmed.', priority: '1', state: '102', category: 'Software', assignment_group: 'Application Support', impact: '1', urgency: '1', known_error: 'true', cause_notes: 'Connection leak in OrderValidationService.validateAsync() — connections acquired in try block but not released in finally block when validation throws BusinessRuleException.', fix_notes: 'Wrap connection acquisition in try-with-resources. Increase pool max to 300 as interim mitigation. Permanent fix in release 4.7.2 scheduled for next sprint.', workaround: 'Restart order-validation pod every 30 minutes during market hours via CronJob. Reduces impact but does not eliminate brief connection errors during restart.' },
];

const CMDB_CIS: Record<string, unknown>[] = [
  // Servers
  { name: `${DEMO_PREFIX} PROD-DB-01`, short_description: 'Primary Oracle RAC database server', sys_class_name: 'cmdb_ci_server', operational_status: '1', environment: 'Production', os: 'Oracle Linux', os_version: '8.9', ip_address: '10.10.1.20', category: 'Server' },
  { name: `${DEMO_PREFIX} PROD-APP-01`, short_description: 'Core banking application server', sys_class_name: 'cmdb_ci_app_server', operational_status: '1', environment: 'Production', os: 'Red Hat Enterprise Linux', os_version: '9.3', ip_address: '10.10.2.10', category: 'Server' },
  { name: `${DEMO_PREFIX} PROD-WEB-01`, short_description: 'Customer portal web server', sys_class_name: 'cmdb_ci_server', operational_status: '1', environment: 'Production', os: 'Ubuntu', os_version: '22.04 LTS', ip_address: '10.10.3.10', category: 'Server' },
  { name: `${DEMO_PREFIX} PROD-K8S-01`, short_description: 'Production AKS cluster primary node', sys_class_name: 'cmdb_ci_server', operational_status: '1', environment: 'Production', os: 'Azure Linux', os_version: '2.0', ip_address: '10.10.4.10', category: 'Server' },
  // Applications
  { name: `${DEMO_PREFIX} CoreBanking`, short_description: 'Core banking transaction processing platform', sys_class_name: 'cmdb_ci_app_server', operational_status: '1', environment: 'Production', category: 'Application' },
  { name: `${DEMO_PREFIX} TradingPlatform`, short_description: 'Equities and fixed-income trading system', sys_class_name: 'cmdb_ci_app_server', operational_status: '1', environment: 'Production', category: 'Application' },
  { name: `${DEMO_PREFIX} CustomerPortal`, short_description: 'External customer self-service portal', sys_class_name: 'cmdb_ci_app_server', operational_status: '1', environment: 'Production', category: 'Application' },
  // Databases
  { name: `${DEMO_PREFIX} OracleRAC-Prod`, short_description: 'Production Oracle RAC 19c cluster', sys_class_name: 'cmdb_ci_db_instance', operational_status: '1', environment: 'Production', category: 'Database' },
  { name: `${DEMO_PREFIX} SQL-DataWarehouse`, short_description: 'SQL Server 2022 enterprise data warehouse', sys_class_name: 'cmdb_ci_db_instance', operational_status: '1', environment: 'Production', category: 'Database' },
  // Network
  { name: `${DEMO_PREFIX} FW-DMZ-01`, short_description: 'Primary DMZ firewall — Palo Alto PA-5430', sys_class_name: 'cmdb_ci_netgear', operational_status: '1', environment: 'Production', ip_address: '10.0.0.1', category: 'Network Gear' },
];

// ── Seed & clear functions ──────────────────────────────────────────────────

async function createBatch(
  table: string,
  records: Record<string, unknown>[],
  label: string,
): Promise<{ created: number; ids: string[]; errors: string[] }> {
  const ids: string[] = [];
  const errors: string[] = [];
  for (const rec of records) {
    try {
      const result = await snowPost(table, rec);
      const sysId = result.sys_id?.value ?? result.sys_id ?? '';
      ids.push(sysId);
      console.log(`  ✓ ${label}: ${(rec.short_description || rec.name) as string}`);
    } catch (err) {
      const msg = `${label}: ${(err as Error).message}`;
      errors.push(msg);
      console.error(`  ✗ ${msg}`);
    }
  }
  return { created: ids.length, ids, errors };
}

/**
 * Seed realistic ITSM demo data into a ServiceNow dev instance.
 * All records are prefixed with "[DEMO]" for easy identification and cleanup.
 * Skips seeding if demo data already exists.
 */
export async function seedDemoData(): Promise<SeedResult> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  ServiceNow Demo Data Seeder');
  console.log('═══════════════════════════════════════════════════');
  console.log(`Instance: ${SNOW_INSTANCE || '(not set)'}\n`);

  if (!SNOW_INSTANCE) {
    throw new Error('SNOW_INSTANCE environment variable is not set');
  }

  const result: SeedResult = {
    incidents: 0,
    changeRequests: 0,
    problems: 0,
    cmdbCis: 0,
    taskSlas: 0,
    errors: [],
  };

  // ── Check for existing demo data ──
  console.log('Checking for existing demo data...');
  try {
    const existing = await snowGet(
      'incident',
      `short_descriptionLIKE${DEMO_PREFIX}`,
      ['sys_id'],
      1,
    );
    if (existing.length > 0) {
      console.log('⚠  Demo data already exists. Run clearDemoData() first or skip seeding.');
      return result;
    }
  } catch (err) {
    console.warn(`Could not check for existing data: ${(err as Error).message}. Proceeding anyway.`);
  }

  // ── CMDB Configuration Items ──
  console.log('\n📦 Seeding CMDB Configuration Items...');
  try {
    const ciResult = await createBatch('cmdb_ci', CMDB_CIS, 'CMDB CI');
    result.cmdbCis = ciResult.created;
    result.errors.push(...ciResult.errors);
  } catch (err) {
    const msg = `CMDB CI batch failed: ${(err as Error).message}`;
    result.errors.push(msg);
    console.error(`  ✗ ${msg}`);
  }

  // ── Incidents ──
  console.log('\n🔥 Seeding Incidents...');
  let incidentIds: string[] = [];
  try {
    const incResult = await createBatch('incident', INCIDENTS, 'Incident');
    result.incidents = incResult.created;
    incidentIds = incResult.ids;
    result.errors.push(...incResult.errors);
  } catch (err) {
    const msg = `Incident batch failed: ${(err as Error).message}`;
    result.errors.push(msg);
    console.error(`  ✗ ${msg}`);
  }

  // ── Change Requests ──
  console.log('\n🔄 Seeding Change Requests...');
  try {
    const crResult = await createBatch('change_request', CHANGE_REQUESTS, 'Change');
    result.changeRequests = crResult.created;
    result.errors.push(...crResult.errors);
  } catch (err) {
    const msg = `Change Request batch failed: ${(err as Error).message}`;
    result.errors.push(msg);
    console.error(`  ✗ ${msg}`);
  }

  // ── Problems ──
  console.log('\n🔍 Seeding Problems...');
  try {
    const probResult = await createBatch('problem', PROBLEMS, 'Problem');
    result.problems = probResult.created;
    result.errors.push(...probResult.errors);
  } catch (err) {
    const msg = `Problem batch failed: ${(err as Error).message}`;
    result.errors.push(msg);
    console.error(`  ✗ ${msg}`);
  }

  // ── Task SLAs ──
  console.log('\n⏱  Seeding Task SLAs...');
  try {
    const slaRecords = buildTaskSlaRecords(incidentIds);
    const slaResult = await createBatch('task_sla', slaRecords, 'Task SLA');
    result.taskSlas = slaResult.created;
    result.errors.push(...slaResult.errors);
  } catch (err) {
    const msg = `Task SLA batch failed: ${(err as Error).message}`;
    result.errors.push(msg);
    console.error(`  ✗ ${msg}`);
  }

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Seeding Complete');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Incidents:        ${result.incidents}`);
  console.log(`  Change Requests:  ${result.changeRequests}`);
  console.log(`  Problems:         ${result.problems}`);
  console.log(`  CMDB CIs:         ${result.cmdbCis}`);
  console.log(`  Task SLAs:        ${result.taskSlas}`);
  if (result.errors.length > 0) {
    console.log(`  Errors:           ${result.errors.length}`);
    for (const e of result.errors) console.log(`    - ${e}`);
  }
  console.log('═══════════════════════════════════════════════════\n');

  return result;
}

/**
 * Build Task SLA records linked to incident sys_ids.
 * Mix: 4 within SLA, 2 at risk (>75% elapsed), 2 breached.
 */
function buildTaskSlaRecords(incidentIds: string[]): Record<string, unknown>[] {
  if (incidentIds.length === 0) {
    console.log('  ⚠ No incident IDs available — skipping Task SLAs');
    return [];
  }

  // P1 incidents are indices 0,1; P2 are 2,3,4,5
  const records: Record<string, unknown>[] = [];

  // Helper to safely get an incident ID
  const id = (idx: number) => incidentIds[Math.min(idx, incidentIds.length - 1)];

  // 4 within SLA (stage = in_progress, has_breached = false, percentage < 75)
  records.push(
    { task: id(0), short_description: `${DEMO_PREFIX} P1 Response SLA - 15min`, stage: 'in_progress', has_breached: 'false', start_time: isoDate(0, 0), planned_end_time: futureDate(0), business_percentage: '30' },
    { task: id(1), short_description: `${DEMO_PREFIX} P1 Response SLA - 15min`, stage: 'in_progress', has_breached: 'false', start_time: isoDate(0, 0), planned_end_time: futureDate(0), business_percentage: '45' },
    { task: id(2), short_description: `${DEMO_PREFIX} P2 Response SLA - 30min`, stage: 'in_progress', has_breached: 'false', start_time: isoDate(0, 1), planned_end_time: futureDate(0), business_percentage: '20' },
    { task: id(3), short_description: `${DEMO_PREFIX} P2 Resolution SLA - 8h`, stage: 'in_progress', has_breached: 'false', start_time: isoDate(1, 0), planned_end_time: futureDate(0), business_percentage: '50' },
  );

  // 2 at risk (>75% elapsed)
  records.push(
    { task: id(4), short_description: `${DEMO_PREFIX} P2 Response SLA - 30min (at risk)`, stage: 'in_progress', has_breached: 'false', start_time: isoDate(0, 2), planned_end_time: futureDate(0), business_percentage: '82' },
    { task: id(5), short_description: `${DEMO_PREFIX} P2 Resolution SLA - 8h (at risk)`, stage: 'in_progress', has_breached: 'false', start_time: isoDate(1, 0), planned_end_time: futureDate(0), business_percentage: '91' },
  );

  // 2 breached
  records.push(
    { task: id(0), short_description: `${DEMO_PREFIX} P1 Resolution SLA - 4h (breached)`, stage: 'breached', has_breached: 'true', start_time: isoDate(1, 0), planned_end_time: isoDate(0, 20), business_percentage: '120' },
    { task: id(2), short_description: `${DEMO_PREFIX} P2 Resolution SLA - 8h (breached)`, stage: 'breached', has_breached: 'true', start_time: isoDate(2, 0), planned_end_time: isoDate(1, 0), business_percentage: '145' },
  );

  return records;
}

/**
 * Delete all demo records created by seedDemoData().
 * Identifies records by the "[DEMO]" prefix in short_description or name.
 */
export async function clearDemoData(): Promise<void> {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Clearing ServiceNow Demo Data');
  console.log('═══════════════════════════════════════════════════\n');

  if (!SNOW_INSTANCE) {
    throw new Error('SNOW_INSTANCE environment variable is not set');
  }

  const tables: { table: string; field: string; label: string }[] = [
    { table: 'task_sla', field: 'short_description', label: 'Task SLAs' },
    { table: 'incident', field: 'short_description', label: 'Incidents' },
    { table: 'change_request', field: 'short_description', label: 'Change Requests' },
    { table: 'problem', field: 'short_description', label: 'Problems' },
    { table: 'cmdb_ci', field: 'name', label: 'CMDB CIs' },
  ];

  for (const { table, field, label } of tables) {
    console.log(`🗑  Deleting ${label}...`);
    try {
      const records = await snowGet(
        table,
        `${field}LIKE${DEMO_PREFIX}`,
        ['sys_id'],
        200,
      );
      let deleted = 0;
      for (const rec of records) {
        const sysId = rec.sys_id?.value ?? rec.sys_id ?? '';
        if (!sysId) continue;
        try {
          await snowDelete(table, sysId);
          deleted++;
        } catch (err) {
          console.error(`  ✗ Failed to delete ${table}/${sysId}: ${(err as Error).message}`);
        }
      }
      console.log(`  ✓ Deleted ${deleted} ${label}`);
    } catch (err) {
      console.error(`  ✗ Failed to query ${label}: ${(err as Error).message}`);
    }
  }

  console.log('\n✅ Demo data cleanup complete.\n');
}
