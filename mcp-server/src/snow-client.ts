/**
 * ServiceNow REST API client for Change Management and CMDB.
 * Uses Basic Auth for MCP server backend calls.
 * OAuth Client ID/Secret (from ServiceNow Application Registry) are used
 * by the M365 Copilot connector via Azure APIM — not by this server directly.
 */

const SNOW_INSTANCE = process.env.SNOW_INSTANCE || "";
const SNOW_USER = process.env.SNOW_USER || "";
const SNOW_PASSWORD = process.env.SNOW_PASSWORD || "";

/** Sanitize a value for use in ServiceNow encoded queries. Strips operators that could inject query logic. */
export function sanitizeSnowValue(val: string): string {
  return val.replace(/[\^=<>!%]/g, '').replace(/\b(OR|NQ|LIKE|IN|ORDERBY|GROUPBY|STARTSWITH|ENDSWITH|BETWEEN)\b/gi, '').trim();
}

async function authHeader(): Promise<Record<string, string>> {
  const encoded = Buffer.from(`${SNOW_USER}:${SNOW_PASSWORD}`).toString("base64");
  return {
    Authorization: `Basic ${encoded}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** Generic ServiceNow Table API GET */
async function snowGet(table: string, query?: string, fields?: string[], limit = 20): Promise<any[]> {
  const params = new URLSearchParams();
  if (query) params.set("sysparm_query", query);
  if (fields?.length) params.set("sysparm_fields", fields.join(","));
  params.set("sysparm_limit", String(limit));
  params.set("sysparm_display_value", "true");

  const url = `${SNOW_INSTANCE}/api/now/table/${encodeURIComponent(table)}?${params}`;
  const res = await fetch(url, { headers: await authHeader() });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ServiceNow GET ${table} failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return json.result ?? [];
}

/** ServiceNow Table API POST (create record) */
async function snowPost(table: string, body: Record<string, unknown>): Promise<any> {
  const url = `${SNOW_INSTANCE}/api/now/table/${encodeURIComponent(table)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: await authHeader(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ServiceNow POST ${table} failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return json.result ?? {};
}

/** ServiceNow Table API PATCH (update record) */
async function snowPatch(table: string, sysId: string, body: Record<string, unknown>): Promise<any> {
  const url = `${SNOW_INSTANCE}/api/now/table/${encodeURIComponent(table)}/${sysId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: await authHeader(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ServiceNow PATCH ${table}/${sysId} failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return json.result ?? {};
}

// ── Change Request operations ──

const CR_FIELDS = [
  "sys_id", "number", "short_description", "description", "state", "priority",
  "risk", "impact", "category", "type", "assignment_group", "assigned_to",
  "cmdb_ci", "requested_by", "opened_at", "closed_at", "planned_start_date",
  "planned_end_date", "work_start", "work_end", "close_code", "close_notes",
  "justification", "backout_plan", "test_plan", "conflict_status",
  "conflict_last_run", "cab_required", "on_hold", "on_hold_reason",
];

export async function getChangeRequests(filters?: {
  state?: string;
  priority?: string;
  category?: string;
  assignment_group?: string;
  limit?: number;
}): Promise<any[]> {
  const parts: string[] = [];
  if (filters?.state) parts.push(`state=${sanitizeSnowValue(filters.state)}`);
  if (filters?.priority) parts.push(`priority=${sanitizeSnowValue(filters.priority)}`);
  if (filters?.category) parts.push(`category=${sanitizeSnowValue(filters.category)}`);
  if (filters?.assignment_group) parts.push(`assignment_group.name=${sanitizeSnowValue(filters.assignment_group)}`);
  parts.push("ORDERBYDESCopened_at");
  return snowGet("change_request", parts.join("^"), CR_FIELDS, filters?.limit ?? 20);
}

export async function getChangeRequest(number?: string, sysId?: string): Promise<any> {
  const query = number ? `number=${sanitizeSnowValue(number)}` : `sys_id=${sanitizeSnowValue(sysId || '')}`;
  const results = await snowGet("change_request", query, CR_FIELDS, 1);
  return results[0] ?? null;
}

export async function createChangeRequest(data: Record<string, unknown>): Promise<any> {
  return snowPost("change_request", data);
}

export async function updateChangeRequest(sysId: string, fields: Record<string, unknown>): Promise<any> {
  return snowPatch("change_request", sysId, fields);
}

/** Get ALL change requests (for metrics, collision detection) */
export async function getAllChangeRequests(limit = 200): Promise<any[]> {
  return snowGet("change_request", "ORDERBYDESCopened_at", CR_FIELDS, limit);
}

/** Get open/pending change requests (New, Assess, Authorize, Scheduled) */
export async function getOpenChangeRequests(limit = 100): Promise<any[]> {
  return snowGet("change_request", "stateIN-5,-4,-3,-2,-1,1,2^ORDERBYDESCopened_at", CR_FIELDS, limit);
}

/** Get changes targeting a specific CI */
export async function getChangesByCi(ciSysId: string, limit = 20): Promise<any[]> {
  return snowGet("change_request", `cmdb_ci=${ciSysId}^ORDERBYDESCopened_at`, CR_FIELDS, limit);
}

/** Get closed changes for historical analysis */
export async function getClosedChanges(limit = 100): Promise<any[]> {
  return snowGet("change_request", "state=3^ORDERBYDESCclosed_at", CR_FIELDS, limit);
}

/** Get incidents opened after a specific date for PIR correlation */
export async function getIncidentsAfterDate(afterDate: string, ciSysId?: string, limit = 20): Promise<any[]> {
  let query = `opened_at>${afterDate}^ORDERBYDESCopened_at`;
  if (ciSysId) query = `cmdb_ci=${ciSysId}^${query}`;
  return snowGet("incident", query, INCIDENT_FIELDS, limit);
}

// ── CMDB operations ──

const CI_FIELDS = [
  "sys_id", "name", "sys_class_name", "category", "subcategory",
  "operational_status", "install_status", "ip_address", "os", "os_version",
  "manufacturer", "model_id", "serial_number", "asset_tag", "location",
  "assigned_to", "managed_by", "owned_by", "support_group",
  "environment", "used_for", "comments", "short_description",
  "discovery_source", "first_discovered", "last_discovered",
];

export async function getCmdbCi(name?: string, sysId?: string, ciClass?: string): Promise<any> {
  const table = ciClass || "cmdb_ci";
  const query = name ? `name=${name}` : `sys_id=${sysId}`;
  const results = await snowGet(table, query, CI_FIELDS, 1);
  return results[0] ?? null;
}

export async function getCmdbCiList(ciClass?: string, limit = 50): Promise<any[]> {
  const table = ciClass || "cmdb_ci";
  return snowGet(table, "ORDERBYname", CI_FIELDS, limit);
}

export async function updateCmdbCi(sysId: string, fields: Record<string, unknown>): Promise<any> {
  return snowPatch("cmdb_ci", sysId, fields);
}

// ── CI Relationships ──

/** Extract sys_id from a ServiceNow reference field (could be string, or object with value/link) */
function extractSysId(field: any): string {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (field.value) return field.value;
  // Try extracting from link URL
  if (field.link) {
    const parts = field.link.split("/");
    return parts[parts.length - 1] || "";
  }
  return String(field);
}

/** Extract display name from a ServiceNow reference field */
function extractDisplayName(field: any): string {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (field.display_value) return field.display_value;
  return "";
}

export async function getCiRelationships(ciSysId: string, depth = 2): Promise<any> {
  // Get direct relationships — use sysparm_display_value=true so we get names
  const downstream = await snowGet(
    "cmdb_rel_ci",
    `parent=${ciSysId}`,
    ["sys_id", "parent", "child", "type"],
    100,
  );
  const upstream = await snowGet(
    "cmdb_rel_ci",
    `child=${ciSysId}`,
    ["sys_id", "parent", "child", "type"],
    100,
  );

  // Collect all CI sys_ids and their display names from relationship data
  const ciNames: Record<string, string> = {};
  for (const rel of [...downstream, ...upstream]) {
    const parentId = extractSysId(rel.parent);
    const childId = extractSysId(rel.child);
    const parentName = extractDisplayName(rel.parent);
    const childName = extractDisplayName(rel.child);
    if (parentId && parentName) ciNames[parentId] = parentName;
    if (childId && childName) ciNames[childId] = childName;
  }

  // For any CIs where we didn't get a display name, look them up
  const allCiIds = new Set<string>();
  for (const rel of [...downstream, ...upstream]) {
    allCiIds.add(extractSysId(rel.parent));
    allCiIds.add(extractSysId(rel.child));
  }
  allCiIds.add(ciSysId);

  const ciMap: Record<string, any> = {};
  for (const id of allCiIds) {
    if (!id) continue;
    try {
      const ci = await getCmdbCi(undefined, id);
      if (ci) ciMap[id] = ci;
    } catch { /* skip unresolvable */ }
  }

  // Build graph structure for blast radius
  const nodes: any[] = [];
  const edges: any[] = [];
  const seen = new Set<string>();

  function addNode(id: string, isCentral = false) {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const ci = ciMap[id];
    const name = ci?.name || ciNames[id] || id;
    nodes.push({
      id,
      name,
      class: ci?.sys_class_name || "unknown",
      status: ci?.operational_status || "unknown",
      environment: ci?.environment || "",
      os: ci?.os || "",
      os_version: ci?.os_version || "",
      isCentral,
      snowUrl: snowUrl("cmdb_ci", id),
    });
  }

  addNode(ciSysId, true);

  for (const rel of downstream) {
    const childId = extractSysId(rel.child);
    if (!childId) continue;
    addNode(childId);
    edges.push({
      from: ciSysId,
      to: childId,
      type: extractDisplayName(rel.type) || "Depends on",
      direction: "downstream",
    });
  }

  for (const rel of upstream) {
    const parentId = extractSysId(rel.parent);
    if (!parentId) continue;
    addNode(parentId);
    edges.push({
      from: parentId,
      to: ciSysId,
      type: extractDisplayName(rel.type) || "Used by",
      direction: "upstream",
    });
  }

  // If depth > 1, recurse one more level
  if (depth > 1) {
    const nextIds = nodes.filter((n) => !n.isCentral).map((n) => n.id);
    for (const nextId of nextIds.slice(0, 20)) {
      try {
        const nextDown = await snowGet("cmdb_rel_ci", `parent=${nextId}`, ["sys_id", "parent", "child", "type"], 50);
        for (const rel of nextDown) {
          const childId = extractSysId(rel.child);
          const childName = extractDisplayName(rel.child);
          if (!childId) continue;
          if (childName && !ciNames[childId]) ciNames[childId] = childName;
          addNode(childId);
          edges.push({ from: nextId, to: childId, type: extractDisplayName(rel.type) || "Depends on", direction: "downstream" });
        }
        const nextUp = await snowGet("cmdb_rel_ci", `child=${nextId}`, ["sys_id", "parent", "child", "type"], 50);
        for (const rel of nextUp) {
          const parentId = extractSysId(rel.parent);
          const parentName = extractDisplayName(rel.parent);
          if (!parentId) continue;
          if (parentName && !ciNames[parentId]) ciNames[parentId] = parentName;
          addNode(parentId);
          edges.push({ from: parentId, to: nextId, type: extractDisplayName(rel.type) || "Used by", direction: "upstream" });
        }
      } catch { /* skip */ }
    }
  }

  return { nodes, edges, centralCi: ciSysId, snowInstance: SNOW_INSTANCE };
}

// ── Incidents ──

const INCIDENT_FIELDS = [
  "sys_id", "number", "short_description", "description", "state", "priority",
  "impact", "urgency", "category", "subcategory", "assignment_group",
  "assigned_to", "cmdb_ci", "opened_at", "resolved_at", "closed_at",
  "caller_id", "close_code", "close_notes",
];

export async function getIncidentsByCi(ciSysId: string, limit = 20): Promise<any[]> {
  return snowGet("incident", `cmdb_ci=${ciSysId}^stateNOT IN6,7^ORDERBYDESCopened_at`, INCIDENT_FIELDS, limit);
}

export async function getIncidentsByName(ciName: string, limit = 20): Promise<any[]> {
  return snowGet("incident", `cmdb_ci.name=${ciName}^stateNOT IN6,7^ORDERBYDESCopened_at`, INCIDENT_FIELDS, limit);
}

/** Get all incidents with optional filters */
export async function getIncidents(filters?: {
  state?: string; priority?: string; category?: string;
  assignment_group?: string; limit?: number;
}): Promise<any[]> {
  const parts: string[] = [];
  if (filters?.state) parts.push(`state=${sanitizeSnowValue(filters.state)}`);
  if (filters?.priority) parts.push(`priority=${sanitizeSnowValue(filters.priority)}`);
  if (filters?.category) parts.push(`category=${sanitizeSnowValue(filters.category)}`);
  if (filters?.assignment_group) parts.push(`assignment_group.name=${sanitizeSnowValue(filters.assignment_group)}`);
  parts.push("ORDERBYDESCopened_at");
  return snowGet("incident", parts.join("^"), INCIDENT_FIELDS, filters?.limit ?? 50);
}

/** Get all incidents including closed (for metrics) */
export async function getAllIncidents(limit = 200): Promise<any[]> {
  return snowGet("incident", "ORDERBYDESCopened_at", INCIDENT_FIELDS, limit);
}

/** Create an incident */
export async function createIncident(data: Record<string, unknown>): Promise<any> {
  return snowPost("incident", data);
}

/** Update an incident */
export async function updateIncident(sysId: string, fields: Record<string, unknown>): Promise<any> {
  return snowPatch("incident", sysId, fields);
}

// ── Problems ──

const PROBLEM_FIELDS = [
  "sys_id", "number", "short_description", "description", "state", "priority",
  "impact", "urgency", "category", "subcategory", "assignment_group",
  "assigned_to", "cmdb_ci", "opened_at", "resolved_at", "closed_at",
  "known_error", "cause_notes", "fix_notes", "workaround",
  "related_incidents", "first_reported_by_task",
];

export async function getProblems(filters?: {
  state?: string; priority?: string; limit?: number;
}): Promise<any[]> {
  const parts: string[] = [];
  if (filters?.state) parts.push(`state=${sanitizeSnowValue(filters.state)}`);
  if (filters?.priority) parts.push(`priority=${sanitizeSnowValue(filters.priority)}`);
  parts.push("ORDERBYDESCopened_at");
  return snowGet("problem", parts.join("^"), PROBLEM_FIELDS, filters?.limit ?? 50);
}

export async function getProblem(number?: string, sysId?: string): Promise<any> {
  const query = number ? `number=${number}` : `sys_id=${sysId}`;
  const results = await snowGet("problem", query, PROBLEM_FIELDS, 1);
  return results[0] ?? null;
}

export async function createProblem(data: Record<string, unknown>): Promise<any> {
  return snowPost("problem", data);
}

export async function updateProblem(sysId: string, fields: Record<string, unknown>): Promise<any> {
  return snowPatch("problem", sysId, fields);
}

// ── Service Requests ──

const SR_FIELDS = [
  "sys_id", "number", "short_description", "description", "state", "priority",
  "impact", "urgency", "assignment_group", "assigned_to", "opened_at",
  "closed_at", "requested_for", "approval", "stage",
];

export async function getServiceRequests(filters?: {
  state?: string; limit?: number;
}): Promise<any[]> {
  const parts: string[] = [];
  if (filters?.state) parts.push(`state=${sanitizeSnowValue(filters.state)}`);
  parts.push("ORDERBYDESCopened_at");
  return snowGet("sc_request", parts.join("^"), SR_FIELDS, filters?.limit ?? 50);
}

export async function createServiceRequest(data: Record<string, unknown>): Promise<any> {
  return snowPost("sc_request", data);
}

export async function updateServiceRequest(sysId: string, fields: Record<string, unknown>): Promise<any> {
  return snowPatch("sc_request", sysId, fields);
}

// ── Knowledge Base ──

const KB_FIELDS = [
  "sys_id", "number", "short_description", "text", "topic", "category",
  "kb_category", "author", "published", "rating", "sys_view_count",
  "workflow_state", "valid_to",
];

export async function searchKnowledge(query: string, limit = 10): Promise<any[]> {
  return snowGet("kb_knowledge", `workflow_state=published^short_descriptionLIKE${query}^ORtextLIKE${query}^ORDERBYDESCsys_view_count`, KB_FIELDS, limit);
}

export async function getKnowledgeArticle(number?: string, sysId?: string): Promise<any> {
  const query = number ? `number=${number}` : `sys_id=${sysId}`;
  const results = await snowGet("kb_knowledge", query, KB_FIELDS, 1);
  return results[0] ?? null;
}

// ── SLA Management ──

const SLA_FIELDS = [
  "sys_id", "task", "sla", "stage", "start_time", "end_time",
  "business_duration", "business_time_left", "has_breached",
  "planned_end_time", "percentage",
];

export async function getTaskSLAs(filters?: {
  stage?: string; has_breached?: string; limit?: number;
}): Promise<any[]> {
  const parts: string[] = [];
  if (filters?.stage) parts.push(`stage=${sanitizeSnowValue(filters.stage)}`);
  if (filters?.has_breached) parts.push(`has_breached=${sanitizeSnowValue(filters.has_breached)}`);
  parts.push("ORDERBYplanned_end_time");
  return snowGet("task_sla", parts.join("^"), SLA_FIELDS, filters?.limit ?? 50);
}

// ── Service Catalog ──

const CATALOG_FIELDS = [
  "sys_id", "name", "short_description", "description", "category",
  "price", "active", "order", "sys_class_name",
];

export async function getCatalogItems(limit = 50): Promise<any[]> {
  return snowGet("sc_cat_item", "active=true^ORDERBYorder", CATALOG_FIELDS, limit);
}

// ── IT Asset Management ──

const ASSET_FIELDS = [
  "sys_id", "display_name", "asset_tag", "serial_number", "model",
  "model_category", "assigned_to", "location", "install_status",
  "substatus", "cost", "warranty_expiration", "purchase_date",
  "retired", "ci", "managed_by", "owned_by",
];

export async function getAssets(filters?: {
  install_status?: string; model_category?: string; limit?: number;
}): Promise<any[]> {
  const parts: string[] = [];
  if (filters?.install_status) parts.push(`install_status=${sanitizeSnowValue(filters.install_status)}`);
  if (filters?.model_category) parts.push(`model_category.name=${sanitizeSnowValue(filters.model_category)}`);
  parts.push("ORDERBYdisplay_name");
  return snowGet("alm_asset", parts.join("^"), ASSET_FIELDS, filters?.limit ?? 100);
}

/** Create a hardware asset */
export async function createAsset(data: Record<string, unknown>): Promise<any> {
  return snowPost("alm_hardware", data);
}

/** Update a hardware asset */
export async function updateAsset(sysId: string, fields: Record<string, unknown>): Promise<any> {
  return snowPatch("alm_hardware", sysId, fields);
}

/** Get assets with expired warranties */
export async function getExpiredWarrantyAssets(limit = 50): Promise<any[]> {
  const today = new Date().toISOString().split("T")[0];
  return snowGet("alm_asset", `warranty_expiration<${today}^warranty_expirationISNOTEMPTY^ORDERBYwarranty_expiration`, ASSET_FIELDS, limit);
}

/** ServiceNow instance URL for linking */
export function snowUrl(table: string, sysId: string): string {
  return `${SNOW_INSTANCE}/nav_to.do?uri=${table}.do?sys_id=${sysId}`;
}

/** Lookup assignment groups by name (for typeahead) */
export async function lookupAssignmentGroups(query: string, limit = 10): Promise<any[]> {
  return snowGet("sys_user_group", `nameLIKE${query}^active=true^ORDERBYname`, ["sys_id", "name", "description"], limit);
}

/** Lookup CMDB CIs by name (for typeahead) */
export async function lookupCmdbCis(query: string, limit = 10): Promise<any[]> {
  return snowGet("cmdb_ci", `nameLIKE${query}^ORDERBYname`, ["sys_id", "name", "sys_class_name", "environment", "operational_status"], limit);
}

/** Create a knowledge article */
export async function createKnowledgeArticle(data: Record<string, unknown>): Promise<any> {
  return snowPost("kb_knowledge", data);
}

/** Update a knowledge article */
export async function updateKnowledgeArticle(sysId: string, fields: Record<string, unknown>): Promise<any> {
  return snowPatch("kb_knowledge", sysId, fields);
}

// ── Vendor & Licensing Management ──

const VENDOR_FIELDS = [
  "sys_id", "name", "street", "city", "state", "zip", "country",
  "phone", "website", "vendor_type", "notes", "contact",
  "primary_contact", "sys_updated_on",
];

/** Get vendors (core_company with vendor=true) */
export async function getVendors(filters?: {
  query?: string; vendor_type?: string; limit?: number;
}): Promise<any[]> {
  const parts: string[] = ["vendor=true"];
  if (filters?.query) parts.push(`nameLIKE${sanitizeSnowValue(filters.query)}`);
  if (filters?.vendor_type) parts.push(`vendor_type=${sanitizeSnowValue(filters.vendor_type)}`);
  parts.push("ORDERBYname");
  return snowGet("core_company", parts.join("^"), VENDOR_FIELDS, filters?.limit ?? 50);
}

/** Create a vendor */
export async function createVendor(data: Record<string, unknown>): Promise<any> {
  return snowPost("core_company", data);
}

/** Update a vendor */
export async function updateVendor(sysId: string, fields: Record<string, unknown>): Promise<any> {
  return snowPatch("core_company", sysId, fields);
}

/** Get a single vendor by name or sys_id */
export async function getVendor(name?: string, sysId?: string): Promise<any> {
  const query = name ? `vendor=true^name=${name}` : `vendor=true^sys_id=${sysId}`;
  const results = await snowGet("core_company", query, VENDOR_FIELDS, 1);
  return results[0] ?? null;
}

const LICENSE_FIELDS = [
  "sys_id", "license_key", "product_name", "publisher", "quantity",
  "installed_count", "rights", "start_date", "end_date", "cost",
  "state", "model", "asset_tag", "assigned_to", "managed_by",
  "sys_updated_on",
];

/** Get software licenses */
export async function getSoftwareLicenses(filters?: {
  product?: string; publisher?: string; state?: string; limit?: number;
}): Promise<any[]> {
  const parts: string[] = [];
  if (filters?.product) parts.push(`product_nameLIKE${filters.product}`);
  if (filters?.publisher) parts.push(`publisherLIKE${filters.publisher}`);
  if (filters?.state) parts.push(`state=${filters.state}`);
  parts.push("ORDERBYproduct_name");
  return snowGet("alm_license", parts.join("^"), LICENSE_FIELDS, filters?.limit ?? 100);
}

/** Get license compliance summary — compare rights vs installed */
export async function getLicenseCompliance(limit = 100): Promise<{
  licenses: any[];
  compliant: number;
  overDeployed: number;
  underUtilized: number;
}> {
  const licenses = await snowGet("alm_license", "ORDERBYproduct_name", LICENSE_FIELDS, limit);
  let compliant = 0, overDeployed = 0, underUtilized = 0;
  for (const lic of licenses) {
    const rights = parseInt(lic.rights) || 0;
    const installed = parseInt(lic.installed_count) || 0;
    if (rights === 0 && installed === 0) { compliant++; continue; }
    if (installed > rights) { overDeployed++; (lic as any)._compliance = "over-deployed"; }
    else if (installed < rights * 0.5) { underUtilized++; (lic as any)._compliance = "under-utilized"; }
    else { compliant++; (lic as any)._compliance = "compliant"; }
  }
  return { licenses, compliant, overDeployed, underUtilized };
}

const CONTRACT_FIELDS = [
  "sys_id", "number", "short_description", "description", "vendor",
  "starts", "ends", "cost", "state", "contract_type", "renewal_date",
  "terms_and_conditions", "approval", "assigned_to", "sys_updated_on",
];

/** Get contracts */
export async function getContracts(filters?: {
  vendor?: string; state?: string; contract_type?: string; limit?: number;
}): Promise<any[]> {
  const parts: string[] = [];
  if (filters?.vendor) parts.push(`vendor.nameLIKE${filters.vendor}`);
  if (filters?.state) parts.push(`state=${filters.state}`);
  if (filters?.contract_type) parts.push(`contract_type=${filters.contract_type}`);
  parts.push("ORDERBYends");
  return snowGet("ast_contract", parts.join("^"), CONTRACT_FIELDS, filters?.limit ?? 50);
}

/** Create a contract */
export async function createContract(data: Record<string, unknown>): Promise<any> {
  return snowPost("ast_contract", data);
}

/** Update a contract */
export async function updateContract(sysId: string, fields: Record<string, unknown>): Promise<any> {
  return snowPatch("ast_contract", sysId, fields);
}

/** Get contracts expiring within N days */
export async function getExpiringContracts(withinDays = 90, limit = 50): Promise<any[]> {
  const today = new Date();
  const future = new Date(today.getTime() + withinDays * 24 * 60 * 60 * 1000);
  const todayStr = today.toISOString().split("T")[0];
  const futureStr = future.toISOString().split("T")[0];
  return snowGet(
    "ast_contract",
    `ends>=${todayStr}^ends<=${futureStr}^stateINactive,auto_renew^ORDERBYends`,
    CONTRACT_FIELDS,
    limit,
  );
}

// ── Knowledge-Centred Service (KCS) Analytics ──

/** Get KB categories for browsing */
export async function getKbCategories(limit = 50): Promise<any[]> {
  return snowGet(
    "kb_category",
    "active=true^ORDERBYlabel",
    ["sys_id", "label", "description", "parent_id", "active"],
    limit,
  );
}

/** Get top/most-viewed knowledge articles for self-service analytics */
export async function getTopKbArticles(limit = 20): Promise<any[]> {
  return snowGet(
    "kb_knowledge",
    "workflow_state=published^ORDERBYDESCsys_view_count",
    KB_FIELDS,
    limit,
  );
}

/** Get recently created KB articles */
export async function getRecentKbArticles(limit = 20): Promise<any[]> {
  return snowGet(
    "kb_knowledge",
    "workflow_state=published^ORDERBYDESCsys_created_on",
    KB_FIELDS,
    limit,
  );
}

/** Get KB article statistics — total, published, draft, retired */
export async function getKbStats(): Promise<{
  total: number; published: number; draft: number; retired: number;
  avgViews: number; topCategories: { category: string; count: number }[];
}> {
  const [published, draft, retired] = await Promise.all([
    snowGet("kb_knowledge", "workflow_state=published", ["sys_id", "sys_view_count", "kb_category"], 500),
    snowGet("kb_knowledge", "workflow_state=draft", ["sys_id"], 500),
    snowGet("kb_knowledge", "workflow_state=retired", ["sys_id"], 500),
  ]);
  const totalViews = published.reduce((sum: number, a: any) => sum + (parseInt(a.sys_view_count) || 0), 0);
  const avgViews = published.length > 0 ? Math.round(totalViews / published.length) : 0;

  // Count by category
  const catMap: Record<string, number> = {};
  for (const a of published) {
    const cat = a.kb_category?.display_value || a.kb_category || "Uncategorized";
    catMap[cat] = (catMap[cat] || 0) + 1;
  }
  const topCategories = Object.entries(catMap)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    total: published.length + draft.length + retired.length,
    published: published.length,
    draft: draft.length,
    retired: retired.length,
    avgViews,
    topCategories,
  };
}

/** KB Gap Analysis — find incident categories without matching KB articles */
export async function getKbGapAnalysis(limit = 50): Promise<{
  gaps: { category: string; incidentCount: number; kbArticleCount: number }[];
  totalIncidentsWithoutKb: number;
}> {
  const incidents = await snowGet(
    "incident",
    "stateNOT IN6,7^ORDERBYDESCopened_at",
    ["sys_id", "category", "short_description"],
    200,
  );

  // Group incidents by category
  const incidentCategories: Record<string, number> = {};
  for (const inc of incidents) {
    const cat = inc.category || "Uncategorized";
    incidentCategories[cat] = (incidentCategories[cat] || 0) + 1;
  }

  // For each category, check if matching KB articles exist
  const gaps: { category: string; incidentCount: number; kbArticleCount: number }[] = [];
  let totalWithout = 0;

  for (const [cat, count] of Object.entries(incidentCategories)) {
    const kbArticles = await snowGet(
      "kb_knowledge",
      `workflow_state=published^categoryLIKE${cat}^ORshort_descriptionLIKE${cat}`,
      ["sys_id"],
      10,
    );
    gaps.push({ category: cat, incidentCount: count, kbArticleCount: kbArticles.length });
    if (kbArticles.length === 0) totalWithout += count;
  }

  gaps.sort((a, b) => {
    if (a.kbArticleCount === 0 && b.kbArticleCount > 0) return -1;
    if (a.kbArticleCount > 0 && b.kbArticleCount === 0) return 1;
    return b.incidentCount - a.incidentCount;
  });

  return { gaps: gaps.slice(0, limit), totalIncidentsWithoutKb: totalWithout };
}
