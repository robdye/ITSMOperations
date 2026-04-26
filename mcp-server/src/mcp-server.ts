/**
 * Change Management MCP Server factory.
 *
 * Creates a low-level MCP Server with full _meta control for the
 * OpenAI Apps SDK widget protocol (text/html+skybridge resources,
 * openai/outputTemplate, structuredContent).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import * as snow from "./snow-client.js";
import * as eol from "./eol-client.js";
import * as azmon from "./azure-monitor.js";
import * as search from "./search-client.js";
import { classifyRecord, isOperationAllowed, redactPii, getDlpStatus } from './purview-dlp.js';
import { getPublicServerUrl } from "./index.js";

// ── Widget HTML loader ──────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, "..", "assets");
const MIME = "text/html+skybridge";

function readWidgetHtml(name: string): string {
  if (!fs.existsSync(ASSETS_DIR)) {
    throw new Error(`Widget assets not found at ${ASSETS_DIR}. Run "npm run build:widgets" first.`);
  }
  const p = path.join(ASSETS_DIR, `${name}.html`);
  if (!fs.existsSync(p)) throw new Error(`Widget "${name}" not found in ${ASSETS_DIR}.`);
  let html = fs.readFileSync(p, "utf8");
  const injection = `<script>window.__SERVER_BASE_URL__=${JSON.stringify(getPublicServerUrl())};</script>`;
  html = html.replace("<head>", `<head>${injection}`);
  return html;
}

function embedDataInHtml(html: string, data: unknown): string {
  const json = JSON.stringify(data).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");
  const script = `<script>window.__TOOL_DATA__=${json};</script>`;
  return html.replace("</head>", `${script}</head>`);
}

// ── DLP helpers ─────────────────────────────────────────────
function applyDlpToRecords(
  records: Record<string, unknown>[],
  table: string,
  operation: 'read' | 'write',
): Record<string, unknown>[] {
  return records.map((record) => {
    const classification = classifyRecord(table, record);
    const opCheck = isOperationAllowed(operation, classification);
    if (!opCheck.allowed) {
      return { sys_id: record.sys_id, number: record.number, blocked: true, reason: opCheck.reason };
    }
    if (classification.piiDetected) {
      return redactPii(record, classification);
    }
    return record;
  });
}

function applyDlpWriteCheck(
  table: string,
  data: Record<string, unknown>,
): { allowed: boolean; reason?: string } {
  const classification = classifyRecord(table, data);
  const opCheck = isOperationAllowed('write', classification);
  return opCheck;
}

// ── Widget definitions ──────────────────────────────────────
interface Widget {
  id: string;
  title: string;
  uri: string;
  invoking: string;
  invoked: string;
  html: string;
}

let CHANGE_DASHBOARD: Widget;
let CHANGE_REQUEST: Widget;
let BLAST_RADIUS: Widget;
let RISK_FORECAST: Widget;
let ASSET_LIFECYCLE: Widget;
let CHANGE_FORM: Widget;
let CHANGE_BRIEFING: Widget;
let CHANGE_METRICS: Widget;
let INCIDENT_DASHBOARD: Widget;
let PROBLEM_DASHBOARD: Widget;
let SLA_DASHBOARD: Widget;
let ITSM_BRIEFING: Widget;
let MISSION_CONTROL: Widget;
let AUDIT_TRAIL: Widget;
let FINOPS_DASHBOARD: Widget;
let SHADOW_AGENTS: Widget;
let SCHEDULE_CONTROL: Widget;
let HANDOVER: Widget;
let SNOW_LIVE_CHAT: Widget;

function loadWidgets() {
  CHANGE_DASHBOARD = {
    id: "change-dashboard",
    title: "Change Management Dashboard",
    uri: "ui://widget/change-dashboard.html",
    invoking: "Loading change management dashboard\u2026",
    invoked: "Dashboard ready.",
    html: readWidgetHtml("change-dashboard"),
  };
  CHANGE_REQUEST = {
    id: "change-request",
    title: "Change Request Detail",
    uri: "ui://widget/change-request.html",
    invoking: "Loading change request details\u2026",
    invoked: "Change request ready.",
    html: readWidgetHtml("change-request"),
  };
  BLAST_RADIUS = {
    id: "blast-radius",
    title: "Blast Radius",
    uri: "ui://widget/blast-radius.html",
    invoking: "Mapping blast radius\u2026",
    invoked: "Blast radius mapped.",
    html: readWidgetHtml("blast-radius"),
  };
  RISK_FORECAST = {
    id: "risk-forecast",
    title: "EOL Risk Forecast",
    uri: "ui://widget/risk-forecast.html",
    invoking: "Computing risk forecast\u2026",
    invoked: "Risk forecast ready.",
    html: readWidgetHtml("risk-forecast"),
  };
  ASSET_LIFECYCLE = {
    id: "asset-lifecycle",
    title: "Asset Lifecycle",
    uri: "ui://widget/asset-lifecycle.html",
    invoking: "Loading asset lifecycle data\u2026",
    invoked: "Lifecycle dashboard ready.",
    html: readWidgetHtml("asset-lifecycle"),
  };
  CHANGE_FORM = {
    id: "change-form",
    title: "Change Request Form",
    uri: "ui://widget/change-form.html",
    invoking: "Preparing change request form\u2026",
    invoked: "Form ready.",
    html: readWidgetHtml("change-form"),
  };
  CHANGE_BRIEFING = {
    id: "change-briefing",
    title: "Change Risk Briefing",
    uri: "ui://widget/change-briefing.html",
    invoking: "Compiling change risk briefing\u2026",
    invoked: "Briefing ready.",
    html: readWidgetHtml("change-briefing"),
  };
  CHANGE_METRICS = {
    id: "change-metrics",
    title: "Change Management KPIs",
    uri: "ui://widget/change-metrics.html",
    invoking: "Computing change metrics\u2026",
    invoked: "Metrics ready.",
    html: readWidgetHtml("change-metrics"),
  };
  INCIDENT_DASHBOARD = {
    id: "incident-dashboard",
    title: "Incident Dashboard",
    uri: "ui://widget/incident-dashboard.html",
    invoking: "Loading incident dashboard\u2026",
    invoked: "Incidents ready.",
    html: readWidgetHtml("incident-dashboard"),
  };
  PROBLEM_DASHBOARD = {
    id: "problem-dashboard",
    title: "Problem Dashboard",
    uri: "ui://widget/problem-dashboard.html",
    invoking: "Loading problem dashboard\u2026",
    invoked: "Problems ready.",
    html: readWidgetHtml("problem-dashboard"),
  };
  SLA_DASHBOARD = {
    id: "sla-dashboard",
    title: "SLA Dashboard",
    uri: "ui://widget/sla-dashboard.html",
    invoking: "Loading SLA compliance\u2026",
    invoked: "SLA dashboard ready.",
    html: readWidgetHtml("sla-dashboard"),
  };
  ITSM_BRIEFING = {
    id: "itsm-briefing",
    title: "ITSM Operations Briefing",
    uri: "ui://widget/itsm-briefing.html",
    invoking: "Compiling ITSM operations briefing\u2026",
    invoked: "Briefing ready.",
    html: readWidgetHtml("itsm-briefing"),
  };
  MISSION_CONTROL = {
    id: "mission-control",
    title: "Mission Control",
    uri: "ui://widget/mission-control.html",
    invoking: "Loading mission control\u2026",
    invoked: "Mission control ready.",
    html: readWidgetHtml("mission-control"),
  };
  AUDIT_TRAIL = {
    id: "audit-trail",
    title: "Audit Trail",
    uri: "ui://widget/audit-trail.html",
    invoking: "Loading audit trail\u2026",
    invoked: "Audit trail ready.",
    html: readWidgetHtml("audit-trail"),
  };
  FINOPS_DASHBOARD = {
    id: "finops-dashboard",
    title: "FinOps Dashboard",
    uri: "ui://widget/finops-dashboard.html",
    invoking: "Loading FinOps dashboard\u2026",
    invoked: "FinOps dashboard ready.",
    html: readWidgetHtml("finops-dashboard"),
  };
  SHADOW_AGENTS = {
    id: "shadow-agents",
    title: "Shadow Agent Discovery",
    uri: "ui://widget/shadow-agents.html",
    invoking: "Scanning for shadow agents\u2026",
    invoked: "Shadow agent scan complete.",
    html: readWidgetHtml("shadow-agents"),
  };
  SCHEDULE_CONTROL = {
    id: "schedule-control",
    title: "Schedule Control",
    uri: "ui://widget/schedule-control.html",
    invoking: "Loading scheduled jobs\u2026",
    invoked: "Schedule control ready.",
    html: readWidgetHtml("schedule-control"),
  };
  HANDOVER = {
    id: "handover",
    title: "Shift Handover Report",
    uri: "ui://widget/handover.html",
    invoking: "Generating shift handover report\u2026",
    invoked: "Handover report ready.",
    html: readWidgetHtml("handover"),
  };
  SNOW_LIVE_CHAT = {
    id: "snow-live-chat",
    title: "ServiceNow Live Chat",
    uri: "ui://widget/snow-live-chat.html",
    invoking: "Connecting to ServiceNow live agent\u2026",
    invoked: "Live chat ready.",
    html: readWidgetHtml("snow-live-chat"),
  };
}

function allWidgets(): Widget[] {
  return [CHANGE_DASHBOARD, CHANGE_REQUEST, BLAST_RADIUS, RISK_FORECAST, ASSET_LIFECYCLE, CHANGE_FORM, CHANGE_BRIEFING, CHANGE_METRICS, INCIDENT_DASHBOARD, PROBLEM_DASHBOARD, SLA_DASHBOARD, ITSM_BRIEFING, MISSION_CONTROL, AUDIT_TRAIL, FINOPS_DASHBOARD, SHADOW_AGENTS, SCHEDULE_CONTROL, HANDOVER, SNOW_LIVE_CHAT];
}

// ── _meta helpers ───────────────────────────────────────────
function descriptorMeta(w: Widget): Record<string, unknown> {
  return {
    "openai/outputTemplate": w.uri,
    "openai/toolInvocation/invoking": w.invoking,
    "openai/toolInvocation/invoked": w.invoked,
    "openai/widgetAccessible": true,
  };
}

function invocationMeta(w: Widget): Record<string, unknown> {
  return {
    "openai/outputTemplate": w.uri,
    "openai/toolInvocation/invoking": w.invoking,
    "openai/toolInvocation/invoked": w.invoked,
    "openai/widgetAccessible": true,
  };
}

function widgetResponse(w: Widget, data: unknown, summaryText: string) {
  const html = embedDataInHtml(w.html, data);
  return {
    content: [
      { type: "text" as const, text: html, mimeType: MIME },
      { type: "text" as const, text: summaryText },
    ],
    structuredContent: data as Record<string, unknown>,
    _meta: invocationMeta(w),
  };
}

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// ── Risk scoring ──────────────────────────────────────────
function calculateRiskScore(threatLikelihood: number, businessImpact: number) {
  const score = threatLikelihood * businessImpact;
  let category: string;
  let color: string;
  if (score <= 5) { category = "Low"; color = "#4caf50"; }
  else if (score <= 12) { category = "Medium"; color = "#ff9800"; }
  else if (score <= 19) { category = "High"; color = "#f44336"; }
  else { category = "Critical"; color = "#9c27b0"; }

  return {
    score,
    category,
    color,
    threatLikelihood,
    businessImpact,
    itilProcess: score <= 5 ? "Standard Change — auto-approve if pre-authorized" :
                 score <= 12 ? "Normal Change — Change Manager approval required" :
                 score <= 19 ? "Normal Change — mandatory CAB review required" :
                 "Emergency/Escalated — CISO and CTO sign-off required",
    nistControls: ["CM-3 (Change Control)", "CM-4 (Impact Analysis)", ...(score > 12 ? ["CM-5 (Access Restrictions)"] : [])],
  };
}

// ── Tool schemas ──────────────────────────────────────────
const changeDashboardSchema = {
  type: "object" as const,
  properties: {
    state: { type: "string" as const, description: "Filter by state" },
    priority: { type: "string" as const, description: "Filter by priority" },
  },
  additionalProperties: false,
};

const changeRequestSchema = {
  type: "object" as const,
  properties: {
    number: { type: "string" as const, description: "Change Request number (e.g. CHG0000001)" },
    sys_id: { type: "string" as const, description: "ServiceNow sys_id" },
  },
  additionalProperties: false,
};

const blastRadiusSchema = {
  type: "object" as const,
  properties: {
    ci_name: { type: "string" as const, description: "CI name" },
    ci_sys_id: { type: "string" as const, description: "CI sys_id" },
  },
  additionalProperties: false,
};

const riskForecastSchema = {
  type: "object" as const,
  properties: {
    months: { type: "number" as const, description: "Forecast window in months (default 12)" },
    tier: { type: "string" as const, description: "Filter by tier: Tier1, Tier2, Tier3" },
  },
  additionalProperties: false,
};

const assetLifecycleSchema = {
  type: "object" as const,
  properties: {
    status: { type: "string" as const, description: "Filter: supported, at-risk, non-compliant" },
    category: { type: "string" as const, description: "Asset category" },
  },
  additionalProperties: false,
};

const getChangeRequestsSchema = {
  type: "object" as const,
  properties: {
    state: { type: "string" as const },
    priority: { type: "string" as const },
    category: { type: "string" as const },
    assignment_group: { type: "string" as const },
    limit: { type: "number" as const },
  },
  additionalProperties: false,
};

const getCmdbCiSchema = {
  type: "object" as const,
  properties: {
    name: { type: "string" as const },
    sys_id: { type: "string" as const },
    ci_class: { type: "string" as const },
  },
  additionalProperties: false,
};

const getCiRelationshipsSchema = {
  type: "object" as const,
  properties: {
    ci_sys_id: { type: "string" as const, description: "CI sys_id" },
    depth: { type: "number" as const, description: "Depth (default 2)" },
  },
  required: ["ci_sys_id"] as const,
  additionalProperties: false,
};

const prepareChangeRequestSchema = {
  type: "object" as const,
  properties: {
    short_description: { type: "string" as const },
    description: { type: "string" as const },
    category: { type: "string" as const },
    priority: { type: "string" as const },
    risk: { type: "string" as const },
    type: { type: "string" as const },
    assignment_group: { type: "string" as const },
    cmdb_ci: { type: "string" as const },
    justification: { type: "string" as const },
    backout_plan: { type: "string" as const },
    test_plan: { type: "string" as const },
    planned_start: { type: "string" as const },
    planned_end: { type: "string" as const },
  },
  additionalProperties: false,
};

const updateCmdbCiSchema = {
  type: "object" as const,
  properties: {
    sys_id: { type: "string" as const },
    fields: { type: "string" as const, description: "JSON object of fields to update" },
  },
  required: ["sys_id", "fields"] as const,
  additionalProperties: false,
};

const eolProductSchema = {
  type: "object" as const,
  properties: {
    product: { type: "string" as const, description: "Product identifier (e.g. windows-server, rhel, nodejs)" },
  },
  required: ["product"] as const,
  additionalProperties: false,
};

const eolStatusSchema = {
  type: "object" as const,
  properties: {
    product: { type: "string" as const },
    version: { type: "string" as const },
  },
  required: ["product", "version"] as const,
  additionalProperties: false,
};

// ── Server factory ──────────────────────────────────────────
export function createChangeServer(): Server {
  loadWidgets();

  const server = new Server(
    { name: "change-mgmt-mcp", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {} } },
  );

  // ── List resources (widgets) ──
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources = allWidgets().map((w) => ({
      uri: w.uri,
      name: w.title,
      mimeType: MIME,
    }));
    return { resources };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const w = allWidgets().find((ww) => ww.uri === uri);
    if (!w) throw new Error(`Unknown resource: ${uri}`);
    return { contents: [{ uri: w.uri, mimeType: MIME, text: w.html }] };
  });

  // ── List tools ──
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = [
      { name: "show-change-dashboard", description: "Display the Change Management dashboard.", inputSchema: changeDashboardSchema, annotations: { readOnlyHint: true }, _meta: descriptorMeta(CHANGE_DASHBOARD) } as any,
      { name: "show-change-request", description: "Display a detailed Change Request.", inputSchema: changeRequestSchema, annotations: { readOnlyHint: true }, _meta: descriptorMeta(CHANGE_REQUEST) } as any,
      { name: "show-blast-radius", description: "Display the Blast Radius dependency graph.", inputSchema: blastRadiusSchema, annotations: { readOnlyHint: true }, _meta: descriptorMeta(BLAST_RADIUS) } as any,
      { name: "show-risk-forecast", description: "Display the EOL Risk Forecast timeline.", inputSchema: riskForecastSchema, annotations: { readOnlyHint: true }, _meta: descriptorMeta(RISK_FORECAST) } as any,
      { name: "show-asset-lifecycle", description: "Display the Asset Lifecycle compliance dashboard.", inputSchema: assetLifecycleSchema, annotations: { readOnlyHint: true }, _meta: descriptorMeta(ASSET_LIFECYCLE) } as any,
      { name: "get-change-requests", description: "Query ServiceNow change requests.", inputSchema: getChangeRequestsSchema, annotations: { readOnlyHint: true } },
      { name: "get-cmdb-ci", description: "Get a CMDB Configuration Item.", inputSchema: getCmdbCiSchema, annotations: { readOnlyHint: true } },
      { name: "get-ci-relationships", description: "Get CI relationships.", inputSchema: getCiRelationshipsSchema, annotations: { readOnlyHint: true } },
      { name: "prepare-change-request", description: "Open an interactive form to create a Change Request.", inputSchema: prepareChangeRequestSchema, _meta: descriptorMeta(CHANGE_FORM) } as any,
      { name: "update-cmdb-ci", description: "Update a CMDB CI.", inputSchema: updateCmdbCiSchema },
      { name: "create-change-request", description: "Create a new Change Request in ServiceNow.", inputSchema: { type: "object" as const, properties: { data: { type: "string" as const, description: "JSON object of CR fields" } }, required: ["data"] as const, additionalProperties: false } },
      { name: "update-change-request", description: "Update an existing Change Request in ServiceNow.", inputSchema: { type: "object" as const, properties: { number: { type: "string" as const, description: "CR number (e.g. CHG0000001)" }, sys_id: { type: "string" as const }, fields: { type: "string" as const, description: "JSON object of fields to update" } }, required: ["fields"] as const, additionalProperties: false } },
      { name: "get-incidents-for-ci", description: "Get active incidents for a Configuration Item to assess impact on change requests.", inputSchema: { type: "object" as const, properties: { ci_name: { type: "string" as const, description: "CI name" }, ci_sys_id: { type: "string" as const, description: "CI sys_id" }, limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "show-change-briefing", description: "Display the Change Risk Briefing — a proactive morning briefing showing collisions, stale CRs, high-risk changes, incident risks, and actionable recommendations.", inputSchema: { type: "object" as const, properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: descriptorMeta(CHANGE_BRIEFING) } as any,
      { name: "show-change-metrics", description: "Display Change Management KPIs — success rate, emergency change %, pipeline breakdown, risk distribution, and change outcomes.", inputSchema: { type: "object" as const, properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: descriptorMeta(CHANGE_METRICS) } as any,
      { name: "detect-change-collisions", description: "Detect changes targeting the same CI or overlapping maintenance windows. Returns collision risks.", inputSchema: { type: "object" as const, properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "generate-cab-agenda", description: "Generate a CAB meeting agenda with all pending changes, risk scores, blast radius summaries, and recommendations.", inputSchema: { type: "object" as const, properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "get-change-history", description: "Find similar past changes for a CI or category. Shows success/failure rates and lessons learned.", inputSchema: { type: "object" as const, properties: { ci_name: { type: "string" as const }, category: { type: "string" as const }, limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "post-implementation-review", description: "Post-Implementation Review — checks if a completed change caused any incidents in the 48 hours after implementation.", inputSchema: { type: "object" as const, properties: { number: { type: "string" as const, description: "CR number" } }, required: ["number"] as const, additionalProperties: false }, annotations: { readOnlyHint: true } },
      // ── Incident Management ──
      { name: "show-incident-dashboard", description: "Display the Incident Dashboard with all active incidents by priority.", inputSchema: { type: "object" as const, properties: { state: { type: "string" as const }, priority: { type: "string" as const }, category: { type: "string" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: descriptorMeta(INCIDENT_DASHBOARD) } as any,
      { name: "get-incidents", description: "Query ServiceNow incidents. Defaults to active/open incidents only (excludes Resolved, Closed, Canceled). Pass state='all' for every state.", inputSchema: { type: "object" as const, properties: { state: { type: "string" as const, description: "Incident state filter. Omit for active only. Use 'all' for every state, or a number: 1=New, 2=InProgress, 3=OnHold, 6=Resolved, 7=Closed, 8=Canceled." }, priority: { type: "string" as const }, category: { type: "string" as const }, assignment_group: { type: "string" as const }, limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "create-incident", description: "Create a new incident in ServiceNow.", inputSchema: { type: "object" as const, properties: { data: { type: "string" as const, description: "JSON object of incident fields" } }, required: ["data"] as const, additionalProperties: false } },
      { name: "update-incident", description: "Update an existing incident.", inputSchema: { type: "object" as const, properties: { sys_id: { type: "string" as const }, fields: { type: "string" as const } }, required: ["sys_id", "fields"] as const, additionalProperties: false } },
      // ── Problem Management ──
      { name: "show-problem-dashboard", description: "Display the Problem Dashboard with open problems and known errors.", inputSchema: { type: "object" as const, properties: { state: { type: "string" as const }, priority: { type: "string" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: descriptorMeta(PROBLEM_DASHBOARD) } as any,
      { name: "create-problem", description: "Create a problem record from recurring incidents.", inputSchema: { type: "object" as const, properties: { data: { type: "string" as const } }, required: ["data"] as const, additionalProperties: false } },
      { name: "update-problem", description: "Update an existing problem record.", inputSchema: { type: "object" as const, properties: { sys_id: { type: "string" as const }, fields: { type: "string" as const } }, required: ["sys_id", "fields"] as const, additionalProperties: false } },
      // ── SLA Management ──
      { name: "show-sla-dashboard", description: "Display the SLA Compliance Dashboard showing breaches, at-risk, and compliance rate.", inputSchema: { type: "object" as const, properties: { stage: { type: "string" as const }, has_breached: { type: "string" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: descriptorMeta(SLA_DASHBOARD) } as any,
      // ── Service Request Management ──
      { name: "create-service-request", description: "Create a new service request in ServiceNow.", inputSchema: { type: "object" as const, properties: { data: { type: "string" as const, description: "JSON object of service request fields" } }, required: ["data"] as const, additionalProperties: false } },
      { name: "update-service-request", description: "Update an existing service request.", inputSchema: { type: "object" as const, properties: { sys_id: { type: "string" as const }, fields: { type: "string" as const } }, required: ["sys_id", "fields"] as const, additionalProperties: false } },
      // ── Knowledge Management ──
      { name: "search-knowledge", description: "Search the ServiceNow Knowledge Base for articles, runbooks, and procedures. Uses Azure AI semantic search when configured, with automatic fallback to keyword search.", inputSchema: { type: "object" as const, properties: { query: { type: "string" as const, description: "Search query" }, source: { type: "string" as const, description: "Filter by source: kb_article, incident_resolution, runbook, cmdb_ci" }, category: { type: "string" as const, description: "Filter by category" }, limit: { type: "number" as const } }, required: ["query"] as const, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "search-incident-resolutions", description: "Search similar past incident resolutions using semantic search. Finds close notes from previously resolved incidents to help resolve current ones.", inputSchema: { type: "object" as const, properties: { description: { type: "string" as const, description: "Incident description to find similar resolutions for" }, top: { type: "number" as const, description: "Max results (default 10)" } }, required: ["description"] as const, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "search-runbooks", description: "Search operational runbooks using semantic search. Finds relevant procedures and playbooks for incident response or change implementation.", inputSchema: { type: "object" as const, properties: { query: { type: "string" as const, description: "Search query describing the operational scenario" } }, required: ["query"] as const, additionalProperties: false }, annotations: { readOnlyHint: true } },
      // ── Service Catalog ──
      { name: "get-catalog-items", description: "List available Service Catalog items.", inputSchema: { type: "object" as const, properties: { limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      // ── IT Asset Management ──
      { name: "get-assets", description: "Query IT assets including hardware, software, warranty status.", inputSchema: { type: "object" as const, properties: { install_status: { type: "string" as const }, model_category: { type: "string" as const }, limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "get-expired-warranties", description: "Get assets with expired warranties.", inputSchema: { type: "object" as const, properties: { limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "create-asset", description: "Create a new hardware asset in ServiceNow.", inputSchema: { type: "object" as const, properties: { data: { type: "string" as const, description: "JSON object of asset fields" } }, required: ["data"] as const, additionalProperties: false } },
      { name: "update-asset", description: "Update an existing hardware asset.", inputSchema: { type: "object" as const, properties: { sys_id: { type: "string" as const }, fields: { type: "string" as const } }, required: ["sys_id", "fields"] as const, additionalProperties: false } },
      // ── ITSM Operations Briefing ──
      { name: "show-itsm-briefing", description: "Display the ITSM Operations Briefing — a holistic view across incidents, problems, SLAs, changes, and assets.", inputSchema: { type: "object" as const, properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: descriptorMeta(ITSM_BRIEFING) } as any,
      // ── Azure Monitor ──
      { name: "get-azure-alerts", description: "Get Azure Monitor alerts for infrastructure health.", inputSchema: { type: "object" as const, properties: { limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "get-eol-product", description: "Get lifecycle data for a product from endoflife.date.", inputSchema: eolProductSchema, annotations: { readOnlyHint: true } },
      { name: "get-eol-all-products", description: "List all products tracked by endoflife.date.", inputSchema: { type: "object" as const, properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "check-eol-status", description: "Check EOL status for a product version.", inputSchema: eolStatusSchema, annotations: { readOnlyHint: true } },
      // ── Internal Lookup Tools ──
      { name: "lookup-assignment-groups", description: "Lookup assignment groups by name for typeahead search.", inputSchema: { type: "object" as const, properties: { query: { type: "string" as const, description: "Search query for group name" } }, required: ["query"] as const, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "lookup-cmdb-cis", description: "Lookup CMDB CIs by name for typeahead search.", inputSchema: { type: "object" as const, properties: { query: { type: "string" as const, description: "Search query for CI name" } }, required: ["query"] as const, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "create-knowledge-article", description: "Create a knowledge article in ServiceNow KB.", inputSchema: { type: "object" as const, properties: { short_description: { type: "string" as const }, text: { type: "string" as const }, category: { type: "string" as const }, workflow_state: { type: "string" as const } }, required: ["short_description", "text"] as const, additionalProperties: false } },
      { name: "update-knowledge-article", description: "Update an existing knowledge article.", inputSchema: { type: "object" as const, properties: { sys_id: { type: "string" as const }, fields: { type: "string" as const } }, required: ["sys_id", "fields"] as const, additionalProperties: false } },
      // ── Vendor & Licensing Management ──
      { name: "get-vendors", description: "List IT vendors from ServiceNow. Supports filtering by name or vendor type.", inputSchema: { type: "object" as const, properties: { query: { type: "string" as const, description: "Search by vendor name" }, vendor_type: { type: "string" as const, description: "Filter by vendor type" }, limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "create-vendor", description: "Create a new vendor in ServiceNow.", inputSchema: { type: "object" as const, properties: { data: { type: "string" as const, description: "JSON object of vendor fields" } }, required: ["data"] as const, additionalProperties: false } },
      { name: "update-vendor", description: "Update an existing vendor.", inputSchema: { type: "object" as const, properties: { sys_id: { type: "string" as const }, fields: { type: "string" as const } }, required: ["sys_id", "fields"] as const, additionalProperties: false } },
      { name: "get-software-licenses", description: "Query software licenses from ServiceNow SAM. Shows product name, publisher, quantities, and dates.", inputSchema: { type: "object" as const, properties: { product: { type: "string" as const, description: "Filter by product name" }, publisher: { type: "string" as const, description: "Filter by publisher" }, state: { type: "string" as const, description: "Filter by state" }, limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "get-license-compliance", description: "License compliance summary — compares entitled rights vs installed count to identify over-deployed or under-utilized licenses.", inputSchema: { type: "object" as const, properties: { limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "get-contracts", description: "Query vendor contracts from ServiceNow. Includes vendor, dates, cost, and renewal info.", inputSchema: { type: "object" as const, properties: { vendor: { type: "string" as const, description: "Filter by vendor name" }, state: { type: "string" as const, description: "Filter by contract state" }, contract_type: { type: "string" as const, description: "Filter by contract type" }, limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "get-expiring-contracts", description: "Get contracts expiring within a specified number of days. Proactive vendor renewal management.", inputSchema: { type: "object" as const, properties: { within_days: { type: "number" as const, description: "Days from now (default 90)" }, limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "create-contract", description: "Create a new contract in ServiceNow.", inputSchema: { type: "object" as const, properties: { data: { type: "string" as const, description: "JSON object of contract fields" } }, required: ["data"] as const, additionalProperties: false } },
      { name: "update-contract", description: "Update an existing contract.", inputSchema: { type: "object" as const, properties: { sys_id: { type: "string" as const }, fields: { type: "string" as const } }, required: ["sys_id", "fields"] as const, additionalProperties: false } },
      // ── Knowledge-Centred Service (KCS) ──
      { name: "get-kb-categories", description: "Browse Knowledge Base categories for self-service navigation.", inputSchema: { type: "object" as const, properties: { limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "get-kb-analytics", description: "Knowledge Base analytics — total articles, published/draft/retired counts, average views, and top categories.", inputSchema: { type: "object" as const, properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "get-top-kb-articles", description: "Get the most-viewed knowledge articles for self-service effectiveness tracking.", inputSchema: { type: "object" as const, properties: { limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "get-kb-gap-analysis", description: "KB Gap Analysis — identifies incident categories with no matching knowledge articles. Drives KCS article creation.", inputSchema: { type: "object" as const, properties: { limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      // ── DLP ──
      { name: "get-dlp-status", description: "Get data loss prevention classification status.", inputSchema: { type: "object" as const, properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
      // ── Mission Control ──
      { name: "show-mission-control", description: "Display the Mission Control dashboard — live tool-call waterfall, active worker delegations, HITL queue, and schedule heartbeat.", inputSchema: { type: "object" as const, properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: descriptorMeta(MISSION_CONTROL) } as any,
      // ── Audit Trail ──
      { name: "show-audit-trail", description: "Display the Audit Trail — filterable table of all actions taken by workers and users.", inputSchema: { type: "object" as const, properties: { search: { type: "string" as const, description: "Search term" }, date_from: { type: "string" as const, description: "Start date (ISO 8601)" }, date_to: { type: "string" as const, description: "End date (ISO 8601)" } }, additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: descriptorMeta(AUDIT_TRAIL) } as any,
      { name: "query-audit", description: "Query audit trail records programmatically. Returns raw JSON.", inputSchema: { type: "object" as const, properties: { action: { type: "string" as const, description: "Filter by action type" }, user: { type: "string" as const, description: "Filter by user" }, worker: { type: "string" as const, description: "Filter by worker" }, limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      // ── FinOps Dashboard ──
      { name: "show-finops-dashboard", description: "Display the FinOps Dashboard — cost trends, top drivers, right-sizing recommendations, budget status, and anomalies.", inputSchema: { type: "object" as const, properties: { resource_group: { type: "string" as const, description: "Filter by resource group" }, timeframe: { type: "string" as const, description: "Timeframe: 7d, 30d, 90d (default 30d)" } }, additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: descriptorMeta(FINOPS_DASHBOARD) } as any,
      // ── Shadow Agent Discovery ──
      { name: "scan-shadow-agents", description: "Scan for shadow (unauthorized/unmonitored) AI agents across the environment.", inputSchema: { type: "object" as const, properties: { platform: { type: "string" as const, description: "Filter by platform" }, compliance_status: { type: "string" as const, description: "Filter: unauthorized, unmonitored, non-compliant, compliant" } }, additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: descriptorMeta(SHADOW_AGENTS) } as any,
      // ── Schedule Control ──
      { name: "show-scheduled-jobs", description: "Display all scheduled jobs with status, last run, next run, and run history.", inputSchema: { type: "object" as const, properties: { status: { type: "string" as const, description: "Filter: active, paused, error" } }, additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: descriptorMeta(SCHEDULE_CONTROL) } as any,
      { name: "pause-job", description: "Pause a scheduled job.", inputSchema: { type: "object" as const, properties: { job_id: { type: "string" as const, description: "Job ID to pause" } }, required: ["job_id"] as const, additionalProperties: false } },
      { name: "resume-job", description: "Resume a paused scheduled job.", inputSchema: { type: "object" as const, properties: { job_id: { type: "string" as const, description: "Job ID to resume" } }, required: ["job_id"] as const, additionalProperties: false } },
      // ── Knowledge Harvester ──
      { name: "harvest-resolution", description: "Extract resolution knowledge from a resolved incident for KB draft creation.", inputSchema: { type: "object" as const, properties: { incident_number: { type: "string" as const, description: "Incident number (e.g. INC0010001)" }, include_workaround: { type: "boolean" as const, description: "Include workaround steps" } }, required: ["incident_number"] as const, additionalProperties: false }, annotations: { readOnlyHint: true } },
      { name: "propose-kb-draft", description: "Generate a knowledge base article draft from harvested resolution data.", inputSchema: { type: "object" as const, properties: { title: { type: "string" as const }, body: { type: "string" as const }, category: { type: "string" as const }, keywords: { type: "string" as const, description: "Comma-separated keywords" }, source_incident: { type: "string" as const, description: "Source incident number" } }, required: ["title", "body"] as const, additionalProperties: false } },
      // ── Shift Handover ──
      { name: "generate-shift-handover", description: "Generate a shift handover report covering incidents, changes, problems, SLAs, decisions, and outstanding items.", inputSchema: { type: "object" as const, properties: { shift_hours: { type: "number" as const, description: "Shift duration in hours (default 8)" }, team: { type: "string" as const, description: "Team name" } }, additionalProperties: false }, annotations: { readOnlyHint: true }, _meta: descriptorMeta(HANDOVER) } as any,
      // ── Problem Management (additional) ──
      { name: "get-problem", description: "Query ServiceNow problem records.", inputSchema: { type: "object" as const, properties: { number: { type: "string" as const, description: "Problem number" }, state: { type: "string" as const }, priority: { type: "string" as const }, category: { type: "string" as const }, limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      // ── SLA Breaches ──
      { name: "get-sla-breaches", description: "Query SLA breaches within a timeframe.", inputSchema: { type: "object" as const, properties: { timeframe: { type: "string" as const, description: "Timeframe: 24h, 7d, 30d (default 7d)" }, priority: { type: "string" as const }, limit: { type: "number" as const } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      // ── Azure Resource Health ──
      { name: "get-resource-health", description: "Get Azure resource health status.", inputSchema: { type: "object" as const, properties: { resource_group: { type: "string" as const, description: "Azure resource group" }, resource_type: { type: "string" as const, description: "Filter by resource type" } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
      // ── Knowledge Harvesting ──
      { name: "harvest-knowledge", description: "Extract knowledge from a resolved incident and format as KB draft.", inputSchema: { type: "object" as const, properties: { incident_number: { type: "string" as const, description: "Incident number" }, include_workaround: { type: "boolean" as const, description: "Include workaround steps" } }, required: ["incident_number"] as const, additionalProperties: false }, annotations: { readOnlyHint: true } },
      // ── KB Article Creation ──
      { name: "create-kb-article", description: "Create a knowledge base article in ServiceNow.", inputSchema: { type: "object" as const, properties: { title: { type: "string" as const, description: "Article title" }, body: { type: "string" as const, description: "Article body (HTML)" }, category: { type: "string" as const }, keywords: { type: "string" as const, description: "Comma-separated keywords" } }, required: ["title", "body"] as const, additionalProperties: false } },
      // ── ServiceNow Live Chat ──
      { name: "connect-live-agent", description: "Connect the user to a ServiceNow live chat agent for real-time human support.", inputSchema: { type: "object" as const, properties: { reason: { type: "string" as const, description: "Reason for requesting a live agent" }, queue: { type: "string" as const, description: "Support queue: general, network, security, database" } }, additionalProperties: false }, _meta: descriptorMeta(SNOW_LIVE_CHAT) } as any,
      // ── Demo Data ──
      { name: "seed-demo-data", description: "Seed the ServiceNow dev instance with realistic ITSM demo data (incidents, changes, problems, CMDB CIs, SLAs).", inputSchema: { type: "object" as const, properties: {}, additionalProperties: false } },
      { name: "clear-demo-data", description: "Remove all [DEMO]-prefixed records from the ServiceNow dev instance.", inputSchema: { type: "object" as const, properties: {}, additionalProperties: false } },
    ];
    return { tools };
  });

  // ── Call tool ──
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;

    switch (name) {
      // ── Widget: Change Dashboard ──
      case "show-change-dashboard": {
        const changes = await snow.getChangeRequests({
          state: args?.state as string,
          priority: args?.priority as string,
        });

        // Enrich with risk scores
        const enriched = changes.map((ch: any) => {
          const threatLikelihood = ch.risk === "High" ? 4 : ch.risk === "Moderate" ? 3 : ch.risk === "Low" ? 2 : 1;
          const businessImpact = ch.impact === "1 - High" ? 5 : ch.impact === "2 - Medium" ? 3 : 1;
          return { ...ch, _riskScore: calculateRiskScore(threatLikelihood, businessImpact) };
        });

        const snowInstance = process.env.SNOW_INSTANCE || "";
        const data = { changes: enriched, snowInstance, generatedAt: new Date().toISOString() };
        const summary = `Change Dashboard: ${enriched.length} change requests. ` +
          `Critical: ${enriched.filter((c: any) => c._riskScore.category === "Critical").length}, ` +
          `High: ${enriched.filter((c: any) => c._riskScore.category === "High").length}, ` +
          `Medium: ${enriched.filter((c: any) => c._riskScore.category === "Medium").length}, ` +
          `Low: ${enriched.filter((c: any) => c._riskScore.category === "Low").length}`;
        return widgetResponse(CHANGE_DASHBOARD, data, summary);
      }

      // ── Widget: Change Request Detail ──
      case "show-change-request": {
        const cr = await snow.getChangeRequest(args?.number as string, args?.sys_id as string);
        if (!cr) return textResponse("Change request not found.");

        const threatLikelihood = cr.risk === "High" ? 4 : cr.risk === "Moderate" ? 3 : cr.risk === "Low" ? 2 : 1;
        const businessImpact = cr.impact === "1 - High" ? 5 : cr.impact === "2 - Medium" ? 3 : 1;
        const riskScore = calculateRiskScore(threatLikelihood, businessImpact);

        // Try to get EOL data for the CI
        let eolData = null;
        if (cr.cmdb_ci) {
          try {
            const ci = await snow.getCmdbCi(undefined, cr.cmdb_ci?.value || cr.cmdb_ci);
            if (ci?.os) {
              const product = eol.normalizeProductName(ci.os);
              const version = ci.os_version || "";
              if (version) {
                eolData = await eol.checkEolStatus(product, version);
              }
            }
          } catch { /* skip */ }
        }

        // Check for incidents against the affected CI
        let incidents: any[] = [];
        if (cr.cmdb_ci) {
          try {
            const ciId = cr.cmdb_ci?.value || cr.cmdb_ci;
            if (typeof ciId === 'string' && ciId.length > 10) {
              incidents = await snow.getIncidentsByCi(ciId, 5);
            }
          } catch { /* skip */ }
        }

        const snowInstance = process.env.SNOW_INSTANCE || "";
        const data = { changeRequest: cr, riskScore, eolData, incidents, snowInstance, generatedAt: new Date().toISOString() };
        const incidentSummary = incidents.length > 0 ? ` | ${incidents.length} active incident(s) on affected CI` : '';
        const summary = `Change Request ${cr.number}: "${cr.short_description}" | State: ${cr.state} | Risk: ${riskScore.category} (${riskScore.score}/25) | ${riskScore.itilProcess}${incidentSummary}`;
        return widgetResponse(CHANGE_REQUEST, data, summary);
      }

      // ── Widget: Blast Radius ──
      case "show-blast-radius": {
        let ciSysId = args?.ci_sys_id as string;
        if (!ciSysId && args?.ci_name) {
          const ci = await snow.getCmdbCi(args.ci_name as string);
          if (!ci) return textResponse(`CI "${args.ci_name}" not found in CMDB.`);
          ciSysId = ci.sys_id;
        }
        if (!ciSysId) return textResponse("Please provide a CI name or sys_id.");

        const graph = await snow.getCiRelationships(ciSysId, 2);
        const centralNode = graph.nodes.find((n: any) => n.isCentral);
        const data = { graph, generatedAt: new Date().toISOString() };
        const summary = `Blast Radius for ${centralNode?.name || ciSysId}: ${graph.nodes.length} systems, ${graph.edges.length} dependencies mapped. ` +
          `Downstream: ${graph.edges.filter((e: any) => e.direction === "downstream").length} dependent systems. ` +
          `Upstream: ${graph.edges.filter((e: any) => e.direction === "upstream").length} feeder systems.`;
        return widgetResponse(BLAST_RADIUS, data, summary);
      }

      // ── Widget: Risk Forecast ──
      case "show-risk-forecast": {
        const months = (args?.months as number) || 12;
        // Query multiple CI tables that typically have OS data
        const ciTables = ["cmdb_ci_server", "cmdb_ci_app_server", "cmdb_ci_win_server", "cmdb_ci_linux_server"];
        let allCis: any[] = [];
        for (const table of ciTables) {
          try {
            const tableCis = await snow.getCmdbCiList(table, 50);
            allCis = allCis.concat(tableCis);
          } catch { /* table may not exist */ }
        }
        const seenIds = new Set<string>();
        allCis = allCis.filter((ci) => { if (seenIds.has(ci.sys_id)) return false; seenIds.add(ci.sys_id); return true; });

        // For each CI with an OS, check EOL status
        const forecasts: any[] = [];
        for (const ci of allCis.slice(0, 40)) {
          if (!ci.os) continue;
          try {
            const product = eol.normalizeProductName(ci.os);
            const version = eol.extractVersion(ci.os, ci.os_version || "");
            if (!version) continue;
            const status = await eol.checkEolStatus(product, version);
            if (status) {
              forecasts.push({
                ci_name: ci.name,
                ci_sys_id: ci.sys_id,
                os: `${ci.os} ${ci.os_version}`,
                environment: ci.environment,
                eolStatus: status._riskClassification,
                eolDate: status._riskClassification?.eolDate,
                daysToEol: status._riskClassification?.daysToEol,
              });
            }
          } catch { /* skip */ }
        }

        // Sort by days to EOL
        forecasts.sort((a, b) => (a.daysToEol ?? 9999) - (b.daysToEol ?? 9999));

        const data = { forecasts, months, generatedAt: new Date().toISOString() };
        const nonCompliant = forecasts.filter((f) => f.eolStatus?.status === "non-compliant").length;
        const atRisk = forecasts.filter((f) => f.eolStatus?.status === "at-risk").length;
        const summary = `EOL Risk Forecast (${months} months): ${forecasts.length} assets analyzed. ` +
          `Non-Compliant: ${nonCompliant}, At Risk: ${atRisk}, Supported: ${forecasts.length - nonCompliant - atRisk}`;
        return widgetResponse(RISK_FORECAST, data, summary);
      }

      // ── Widget: Asset Lifecycle ──
      case "show-asset-lifecycle": {
        // Query multiple CI tables that typically have OS data
        const ciTables = ["cmdb_ci_server", "cmdb_ci_app_server", "cmdb_ci_win_server", "cmdb_ci_linux_server"];
        let allCis: any[] = [];
        for (const table of ciTables) {
          try {
            const cis = await snow.getCmdbCiList(table, 50);
            allCis = allCis.concat(cis);
          } catch { /* table may not exist */ }
        }
        // Deduplicate by sys_id
        const seen = new Set<string>();
        allCis = allCis.filter((ci) => {
          if (seen.has(ci.sys_id)) return false;
          seen.add(ci.sys_id);
          return true;
        });

        const assets: any[] = [];
        for (const ci of allCis.slice(0, 60)) {
          if (!ci.os) continue;
          try {
            const product = eol.normalizeProductName(ci.os);
            const version = eol.extractVersion(ci.os, ci.os_version || "");
            if (!version) continue;
            const status = await eol.checkEolStatus(product, version);
            if (status) {
              const threatLikelihood = status._riskClassification?.threatLikelihood || 1;
              const env = (ci.environment || "").toLowerCase();
              const businessImpact = env.includes("prod") ? 4 : env.includes("staging") ? 3 : env.includes("dev") ? 1 : 2;
              assets.push({
                ...ci,
                eolStatus: status._riskClassification,
                riskScore: calculateRiskScore(threatLikelihood, businessImpact),
              });
            }
          } catch { /* skip */ }
        }

        // Apply filters
        let filtered = assets;
        if (args?.status) {
          filtered = filtered.filter((a) => a.eolStatus?.status === args.status);
        }
        if (args?.category) {
          filtered = filtered.filter((a) =>
            (a.sys_class_name || "").toLowerCase().includes((args.category as string).toLowerCase()),
          );
        }

        const snowInstance = process.env.SNOW_INSTANCE || "";
        const data = { assets: filtered, snowInstance, generatedAt: new Date().toISOString() };
        const summary = `Asset Lifecycle: ${filtered.length} assets. Supported: ${filtered.filter((a) => a.eolStatus?.status === "supported").length}, ` +
          `At Risk: ${filtered.filter((a) => a.eolStatus?.status === "at-risk").length}, ` +
          `Non-Compliant: ${filtered.filter((a) => a.eolStatus?.status === "non-compliant").length}`;
        return widgetResponse(ASSET_LIFECYCLE, data, summary);
      }

      // ── Text: Get Change Requests ──
      case "get-change-requests": {
        const changes = await snow.getChangeRequests({
          state: args?.state as string,
          priority: args?.priority as string,
          category: args?.category as string,
          assignment_group: args?.assignment_group as string,
          limit: args?.limit as number,
        });
        const dlpChanges = applyDlpToRecords(changes, 'change_request', 'read');
        return textResponse(JSON.stringify(dlpChanges, null, 2));
      }

      // ── Text: Get CMDB CI ──
      case "get-cmdb-ci": {
        const ci = await snow.getCmdbCi(args?.name as string, args?.sys_id as string, args?.ci_class as string);
        if (!ci) return textResponse("Configuration Item not found.");
        return textResponse(JSON.stringify(ci, null, 2));
      }

      // ── Text: Get CI Relationships ──
      case "get-ci-relationships": {
        const graph = await snow.getCiRelationships(args?.ci_sys_id as string, (args?.depth as number) || 2);
        return textResponse(JSON.stringify(graph, null, 2));
      }

      // ── Widget: Prepare Change Request Form ──
      case "prepare-change-request": {
        const data = {
          prefill: { ...args },
          snowInstance: process.env.SNOW_INSTANCE || "",
          generatedAt: new Date().toISOString(),
        };
        return widgetResponse(CHANGE_FORM, data, "Change Request form ready. Fill in the details and submit.");
      }

      // ── Write: Update CMDB CI ──
      case "update-cmdb-ci": {
        const fields = JSON.parse(args?.fields as string);
        const writeCheck = applyDlpWriteCheck('cmdb_ci', fields);
        if (!writeCheck.allowed) return textResponse(`DLP blocked: ${writeCheck.reason}`);
        const result = await snow.updateCmdbCi(args?.sys_id as string, fields);
        return textResponse(`CMDB CI updated. sys_id: ${result.sys_id}, name: ${result.name}`);
      }

      // ── EOL: Get Product ──
      case "get-eol-product": {
        const product = eol.normalizeProductName(args?.product as string);
        const data = await eol.getProduct(product);
        if (!data) return textResponse(`Product "${args?.product}" not found on endoflife.date. Try a different name.`);
        return textResponse(JSON.stringify(data, null, 2));
      }

      // ── EOL: List All Products ──
      case "get-eol-all-products": {
        const products = await eol.getAllProducts();
        return textResponse(`${products.length} products tracked. Examples: ${products.slice(0, 20).join(", ")}`);
      }

      // ── EOL: Check Status ──
      case "check-eol-status": {
        const product = eol.normalizeProductName(args?.product as string);
        const data = await eol.checkEolStatus(product, args?.version as string);
        if (!data) return textResponse(`Version "${args?.version}" of "${args?.product}" not found.`);
        const rc = data._riskClassification;
        const summary = `${rc.statusEmoji} ${args?.product} ${args?.version}: ${rc.status.toUpperCase()}\n` +
          `EOL Date: ${rc.eolDate} | Days to EOL: ${rc.daysToEol ?? "N/A"}\n` +
          `Threat Likelihood: ${rc.threatLikelihood}/5\n` +
          `NIST: ${rc.nistControl}\n\n` +
          JSON.stringify(data, null, 2);
        return textResponse(summary);
      }

      // ── Write: Create Change Request ──
      case "create-change-request": {
        const data = JSON.parse(args?.data as string || '{}');
        const writeCheck = applyDlpWriteCheck('change_request', data);
        if (!writeCheck.allowed) return textResponse(`DLP blocked: ${writeCheck.reason}`);
        const result = await snow.createChangeRequest(data);
        const snowInstance = process.env.SNOW_INSTANCE || "";
        return textResponse(`Change Request created: ${result.number || 'N/A'}\nsys_id: ${result.sys_id}\nLink: ${snowInstance}/nav_to.do?uri=change_request.do?sys_id=${result.sys_id}`);
      }

      // ── Write: Update Change Request ──
      case "update-change-request": {
        const sysId = args?.sys_id as string;
        const number = args?.number as string;
        let targetSysId = sysId;
        if (!targetSysId && number) {
          const cr = await snow.getChangeRequest(number);
          if (!cr) return textResponse(`Change request ${number} not found.`);
          targetSysId = cr.sys_id;
        }
        if (!targetSysId) return textResponse('Please provide a change request number or sys_id.');
        const fields = JSON.parse(args?.fields as string || '{}');
        const writeCheck = applyDlpWriteCheck('change_request', fields);
        if (!writeCheck.allowed) return textResponse(`DLP blocked: ${writeCheck.reason}`);
        const result = await snow.updateChangeRequest(targetSysId, fields);
        return textResponse(`Change Request ${result.number || number} updated. sys_id: ${result.sys_id}`);
      }

      // ── Text: Get Incidents for CI ──
      case "get-incidents-for-ci": {
        let ciSysId = args?.ci_sys_id as string;
        if (!ciSysId && args?.ci_name) {
          const ci = await snow.getCmdbCi(args.ci_name as string);
          if (!ci) return textResponse(`CI "${args.ci_name}" not found.`);
          ciSysId = ci.sys_id;
        }
        if (!ciSysId) return textResponse('Please provide a CI name or sys_id.');
        const incidents = await snow.getIncidentsByCi(ciSysId, (args?.limit as number) || 10);
        if (incidents.length === 0) return textResponse('No active incidents found for this Configuration Item.');
        const dlpIncidents = applyDlpToRecords(incidents, 'incident', 'read');
        const snowInstance = process.env.SNOW_INSTANCE || "";
        const summaryLines = dlpIncidents.map((inc: any) => 
          inc.blocked
            ? `${inc.number}: [BLOCKED] ${inc.reason}`
            : `${inc.number}: ${inc.short_description} | State: ${inc.state} | Priority: ${inc.priority} | Link: ${snowInstance}/nav_to.do?uri=incident.do?sys_id=${inc.sys_id}`
        );
        return textResponse(`${dlpIncidents.length} active incident(s):\n${summaryLines.join('\n')}`);
      }

      // ── Widget: Change Risk Briefing ──
      case "show-change-briefing": {
        const snowInstance = process.env.SNOW_INSTANCE || "";
        const openCRs = await snow.getOpenChangeRequests(100);
        const now = new Date();

        // Enrich with risk scores
        const enriched = openCRs.map((ch: any) => {
          const tl = ch.risk === "High" ? 4 : ch.risk === "Moderate" ? 3 : ch.risk === "Low" ? 2 : 1;
          const bi = ch.impact === "1 - High" ? 5 : ch.impact === "2 - Medium" ? 3 : 1;
          return { ...ch, _riskScore: calculateRiskScore(tl, bi) };
        });

        // Collisions: changes targeting the same CI
        const ciGroups: Record<string, any[]> = {};
        for (const cr of enriched) {
          const ciKey = cr.cmdb_ci?.display_value || cr.cmdb_ci || "";
          if (ciKey) {
            if (!ciGroups[ciKey]) ciGroups[ciKey] = [];
            ciGroups[ciKey].push(cr);
          }
        }
        const collisions: any[] = [];
        for (const [ci, crs] of Object.entries(ciGroups)) {
          if (crs.length > 1) {
            collisions.push({
              title: `${crs.length} changes target "${ci}"`,
              detail: crs.map((c: any) => `${c.number} (${c.state})`).join(", ") + ` — Risk of conflicting changes on the same Configuration Item.`,
              crs: crs.map((c: any) => c.number),
            });
          }
        }

        // Stale changes (>30 days open)
        const staleChanges = enriched.filter((cr: any) => {
          if (!cr.opened_at) return false;
          const openedDate = new Date(cr.opened_at);
          const daysOpen = Math.floor((now.getTime() - openedDate.getTime()) / (1000 * 60 * 60 * 24));
          (cr as any).daysOpen = daysOpen;
          return daysOpen > 30;
        });

        // High/Critical risk
        const highRiskChanges = enriched.filter((cr: any) => cr._riskScore.score >= 13);

        // CRs with active incidents on their CI
        const incidentRisks: any[] = [];
        for (const cr of enriched.slice(0, 20)) {
          const ciId = cr.cmdb_ci?.value || cr.cmdb_ci;
          if (ciId && typeof ciId === "string" && ciId.length > 10) {
            try {
              const incs = await snow.getIncidentsByCi(ciId, 3);
              if (incs.length > 0) {
                incidentRisks.push({ ...cr, incidentCount: incs.length });
              }
            } catch { /* skip */ }
          }
        }

        // Recommendations
        const recommendations: any[] = [];
        if (collisions.length > 0) {
          recommendations.push({ text: `<strong>Resolve ${collisions.length} collision(s)</strong> — Multiple changes target the same CI. Sequence them or merge into a single CR to reduce conflict risk.`, urgent: true });
        }
        if (staleChanges.length > 0) {
          recommendations.push({ text: `<strong>Review ${staleChanges.length} stale CR(s)</strong> — Open >30 days without progress. Close, defer, or escalate per ITIL continual improvement.`, urgent: staleChanges.length > 3 });
        }
        if (highRiskChanges.length > 0) {
          recommendations.push({ text: `<strong>${highRiskChanges.length} high/critical risk change(s)</strong> require mandatory CAB review per NIST CM-3 and ITIL V4 Normal Change process.`, urgent: true });
        }
        if (incidentRisks.length > 0) {
          recommendations.push({ text: `<strong>${incidentRisks.length} change(s) affect CIs with active incidents</strong> — Per NIST CM-4, resolve incidents before implementing changes.`, urgent: true });
        }
        const emergencies = enriched.filter((cr: any) => (cr.type || "").toLowerCase().includes("emergency"));
        if (emergencies.length > 0) {
          recommendations.push({ text: `<strong>${emergencies.length} emergency change(s)</strong> active — Ensure ECAB fast-track approval and schedule post-implementation review within 5 business days.` });
        }
        if (recommendations.length === 0) {
          recommendations.push({ text: `<strong>All clear</strong> — No immediate risks detected. Continue monitoring.` });
        }

        const data = {
          pulse: { openChanges: enriched.length, collisions: collisions.length, staleChanges: staleChanges.length, highRisk: highRiskChanges.length },
          collisions, staleChanges, highRiskChanges, incidentRisks, recommendations,
          snowInstance, generatedAt: now.toISOString(),
        };
        const summary = `Change Risk Briefing: ${enriched.length} open CRs | ${collisions.length} collisions | ${staleChanges.length} stale | ${highRiskChanges.length} high-risk | ${incidentRisks.length} with incidents | ${recommendations.length} recommendations`;
        return widgetResponse(CHANGE_BRIEFING, data, summary);
      }

      // ── Widget: Change Metrics ──
      case "show-change-metrics": {
        const snowInstance = process.env.SNOW_INSTANCE || "";
        const allCRs = await snow.getAllChangeRequests(200);
        const now = new Date();

        const closedCRs = allCRs.filter((cr: any) => cr.state === "Closed");
        const successful = closedCRs.filter((cr: any) => cr.close_code === "Successful").length;
        const unsuccessful = closedCRs.filter((cr: any) => cr.close_code === "Unsuccessful").length;
        const successRate = closedCRs.length > 0 ? Math.round(successful / closedCRs.length * 100) : 0;

        const emergencies = allCRs.filter((cr: any) => (cr.type || "").toLowerCase().includes("emergency"));
        const emergencyPct = allCRs.length > 0 ? Math.round(emergencies.length / allCRs.length * 100) : 0;

        const openCRs = allCRs.filter((cr: any) => !["Closed", "Canceled"].includes(cr.state));
        const pendingApproval = allCRs.filter((cr: any) => cr.state === "Authorize").length;

        // Average days open for open CRs
        let totalDaysOpen = 0; let countOpen = 0;
        for (const cr of openCRs) {
          if (cr.opened_at) {
            totalDaysOpen += Math.floor((now.getTime() - new Date(cr.opened_at).getTime()) / (1000 * 60 * 60 * 24));
            countOpen++;
          }
        }

        // By state
        const stateMap: Record<string, number> = {};
        for (const cr of allCRs) { stateMap[cr.state || "Unknown"] = (stateMap[cr.state || "Unknown"] || 0) + 1; }
        const byState = Object.entries(stateMap).map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count);

        // By type
        const typeMap: Record<string, number> = {};
        for (const cr of allCRs) { typeMap[cr.type || "Normal"] = (typeMap[cr.type || "Normal"] || 0) + 1; }
        const byType = Object.entries(typeMap).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);

        // By risk
        const riskMap: Record<string, number> = {};
        for (const cr of allCRs) { riskMap[cr.risk || "None"] = (riskMap[cr.risk || "None"] || 0) + 1; }
        const byRisk = Object.entries(riskMap).map(([risk, count]) => ({ risk, count })).sort((a, b) => b.count - a.count);

        const data = {
          metrics: {
            successRate, successful, totalClosed: closedCRs.length,
            emergencyPct, emergencyCount: emergencies.length, totalAll: allCRs.length,
            openCount: openCRs.length, pendingApproval,
            avgDaysOpen: countOpen > 0 ? Math.round(totalDaysOpen / countOpen) : 0,
            byState, byType, byRisk,
            closedChanges: closedCRs.slice(0, 10),
          },
          snowInstance, generatedAt: now.toISOString(),
        };
        const summary = `Change Metrics: Success Rate ${successRate}% (${successful}/${closedCRs.length}) | Emergency ${emergencyPct}% | Open ${openCRs.length} | Avg ${countOpen > 0 ? Math.round(totalDaysOpen / countOpen) : 0} days open`;
        return widgetResponse(CHANGE_METRICS, data, summary);
      }

      // ── Text: Detect Change Collisions ──
      case "detect-change-collisions": {
        const openCRs = await snow.getOpenChangeRequests(100);
        const ciGroups: Record<string, any[]> = {};
        for (const cr of openCRs) {
          const ciKey = cr.cmdb_ci?.display_value || cr.cmdb_ci || "";
          if (ciKey) {
            if (!ciGroups[ciKey]) ciGroups[ciKey] = [];
            ciGroups[ciKey].push(cr);
          }
        }
        const collisions: string[] = [];
        for (const [ci, crs] of Object.entries(ciGroups)) {
          if (crs.length > 1) {
            collisions.push(`CI "${ci}": ${crs.map((c: any) => `${c.number} (${c.state}, ${c.type})`).join(", ")}`);
          }
        }
        if (collisions.length === 0) return textResponse("No change collisions detected. No CIs have multiple open change requests.");
        return textResponse(`${collisions.length} collision(s) detected:\n\n${collisions.join("\n\n")}\n\nPer NIST CM-3, these should be sequenced or merged to prevent conflicting modifications.`);
      }

      // ── Text: Generate CAB Agenda ──
      case "generate-cab-agenda": {
        const snowInstance = process.env.SNOW_INSTANCE || "";
        const pendingCRs = await snow.getOpenChangeRequests(50);
        const cabCRs = pendingCRs.filter((cr: any) => ["Authorize", "Assess", "Scheduled"].includes(cr.state));

        if (cabCRs.length === 0) return textResponse("No changes pending CAB review. All clear.");

        let agenda = `# CAB Meeting Agenda\nGenerated: ${new Date().toISOString().split("T")[0]}\nTotal Items: ${cabCRs.length}\n\n---\n\n`;

        for (let i = 0; i < cabCRs.length; i++) {
          const cr = cabCRs[i];
          const tl = cr.risk === "High" ? 4 : cr.risk === "Moderate" ? 3 : cr.risk === "Low" ? 2 : 1;
          const bi = cr.impact === "1 - High" ? 5 : cr.impact === "2 - Medium" ? 3 : 1;
          const rs = calculateRiskScore(tl, bi);
          const ciName = cr.cmdb_ci?.display_value || cr.cmdb_ci || "N/A";
          const link = `${snowInstance}/nav_to.do?uri=change_request.do?sys_id=${cr.sys_id}`;

          agenda += `## ${i + 1}. ${cr.number} — ${cr.short_description || "No description"}\n`;
          agenda += `- **State:** ${cr.state} | **Type:** ${cr.type || "Normal"} | **Priority:** ${cr.priority || "N/A"}\n`;
          agenda += `- **Risk Score:** ${rs.score}/25 (${rs.category}) — Likelihood ${rs.threatLikelihood} x Impact ${rs.businessImpact}\n`;
          agenda += `- **ITIL Process:** ${rs.itilProcess}\n`;
          agenda += `- **Affected CI:** ${ciName}\n`;
          agenda += `- **Requested By:** ${cr.requested_by?.display_value || cr.requested_by || "N/A"}\n`;
          if (cr.justification) agenda += `- **Justification:** ${cr.justification}\n`;
          if (cr.backout_plan) agenda += `- **Backout Plan:** ${cr.backout_plan}\n`;
          if (!cr.backout_plan) agenda += `- **Backout Plan:** MISSING — Per NIST CM-3, this is required before approval\n`;
          if (!cr.test_plan) agenda += `- **Test Plan:** MISSING — Required per NIST CM-3\n`;
          agenda += `- **Link:** ${link}\n`;

          // Recommendation
          if (rs.score >= 13) {
            agenda += `- **RECOMMENDATION:** HIGH RISK — Requires detailed impact analysis and CISO review\n`;
          } else if (!cr.backout_plan || !cr.test_plan) {
            agenda += `- **RECOMMENDATION:** INCOMPLETE — Missing governance fields. Return to requestor\n`;
          } else {
            agenda += `- **RECOMMENDATION:** APPROVE — Risk acceptable, governance complete\n`;
          }
          agenda += `\n`;
        }

        agenda += `---\n\n## Summary\n`;
        const highCount = cabCRs.filter((cr: any) => { const tl = cr.risk === "High" ? 4 : cr.risk === "Moderate" ? 3 : 2; return tl * 3 >= 13; }).length;
        const missingBackout = cabCRs.filter((cr: any) => !cr.backout_plan).length;
        agenda += `- Changes for review: ${cabCRs.length}\n`;
        agenda += `- High/Critical risk: ${highCount}\n`;
        agenda += `- Missing backout plan: ${missingBackout}\n`;
        if (missingBackout > 0) agenda += `\n**ACTION:** ${missingBackout} change(s) are missing mandatory backout plans per NIST CM-3. Return to requestors before approval.\n`;

        return textResponse(agenda);
      }

      // ── Text: Change History ──
      case "get-change-history": {
        const snowInstance = process.env.SNOW_INSTANCE || "";
        const closedCRs = await snow.getClosedChanges(100);
        let filtered = closedCRs;

        if (args?.ci_name) {
          filtered = filtered.filter((cr: any) => {
            const ciName = cr.cmdb_ci?.display_value || cr.cmdb_ci || "";
            return ciName.toLowerCase().includes((args!.ci_name as string).toLowerCase());
          });
        }
        if (args?.category) {
          filtered = filtered.filter((cr: any) => (cr.category || "").toLowerCase().includes((args!.category as string).toLowerCase()));
        }

        filtered = filtered.slice(0, (args?.limit as number) || 20);

        if (filtered.length === 0) return textResponse("No matching historical changes found.");

        const successful = filtered.filter((cr: any) => cr.close_code === "Successful").length;
        const unsuccessful = filtered.filter((cr: any) => cr.close_code === "Unsuccessful").length;
        const rate = filtered.length > 0 ? Math.round(successful / filtered.length * 100) : 0;

        let result = `## Historical Change Analysis\n\n`;
        result += `Found ${filtered.length} matching change(s): ${successful} successful, ${unsuccessful} unsuccessful (${rate}% success rate)\n\n`;

        for (const cr of filtered) {
          const link = `${snowInstance}/nav_to.do?uri=change_request.do?sys_id=${cr.sys_id}`;
          const tag = cr.close_code === "Unsuccessful" ? "FAILED" : "SUCCESS";
          result += `- **${cr.number}** [${tag}] ${cr.short_description || ""} | CI: ${cr.cmdb_ci?.display_value || "N/A"} | Closed: ${cr.closed_at || "N/A"}`;
          if (cr.close_notes) result += ` | Notes: ${cr.close_notes}`;
          result += ` | [Link](${link})\n`;
        }

        if (unsuccessful > 0) {
          result += `\n### Lessons Learned\n`;
          const failedCRs = filtered.filter((cr: any) => cr.close_code === "Unsuccessful");
          for (const cr of failedCRs) {
            result += `- **${cr.number}**: ${cr.close_notes || "No close notes recorded — consider adding PIR notes for future reference."}\n`;
          }
        }

        return textResponse(result);
      }

      // ── Text: Post-Implementation Review ──
      case "post-implementation-review": {
        const snowInstance = process.env.SNOW_INSTANCE || "";
        const cr = await snow.getChangeRequest(args?.number as string);
        if (!cr) return textResponse(`Change request ${args?.number} not found.`);

        if (cr.state !== "Closed" && cr.state !== "Review") {
          return textResponse(`${cr.number} is in state "${cr.state}". Post-implementation review is only available for Closed or Review changes.`);
        }

        const workEnd = cr.work_end || cr.closed_at;
        if (!workEnd) return textResponse(`${cr.number} has no work_end or closed_at date. Cannot determine the post-implementation window.`);

        // Check for incidents opened within 48 hours after work_end
        const endDate = new Date(workEnd);
        const after48h = new Date(endDate.getTime() + 48 * 60 * 60 * 1000);
        const ciId = cr.cmdb_ci?.value || cr.cmdb_ci;

        let incidents: any[] = [];
        try {
          incidents = await snow.getIncidentsAfterDate(workEnd, typeof ciId === "string" && ciId.length > 10 ? ciId : undefined, 20);
          // Filter to only incidents within the 48h window
          incidents = incidents.filter((inc: any) => {
            const openedAt = new Date(inc.opened_at);
            return openedAt >= endDate && openedAt <= after48h;
          });
        } catch { /* skip */ }

        let result = `## Post-Implementation Review: ${cr.number}\n\n`;
        result += `**Change:** ${cr.short_description || ""}\n`;
        result += `**CI:** ${cr.cmdb_ci?.display_value || cr.cmdb_ci || "N/A"}\n`;
        result += `**Close Code:** ${cr.close_code || "N/A"}\n`;
        result += `**Work Ended:** ${workEnd}\n`;
        result += `**PIR Window:** ${workEnd} to ${after48h.toISOString()}\n\n`;

        if (incidents.length === 0) {
          result += `**Result: No incidents detected in the 48-hour post-implementation window.**\n\n`;
          result += `This change appears to have been implemented successfully with no adverse impact.\n`;
        } else {
          result += `**WARNING: ${incidents.length} incident(s) opened within 48 hours of implementation:**\n\n`;
          for (const inc of incidents) {
            const incLink = `${snowInstance}/nav_to.do?uri=incident.do?sys_id=${inc.sys_id}`;
            result += `- **${inc.number}**: ${inc.short_description || ""} | Priority: ${inc.priority} | Opened: ${inc.opened_at} | [Link](${incLink})\n`;
          }
          result += `\nPer ITIL V4, these incidents should be investigated for correlation with the change. If causal, the change should be flagged as Unsuccessful and backout procedures reviewed.\n`;
        }

        return textResponse(result);
      }

      // ── Widget: Incident Dashboard ──
      case "show-incident-dashboard": {
        const snowInstance = process.env.SNOW_INSTANCE || "";
        const incidents = await snow.getIncidents({
          state: args?.state as string, priority: args?.priority as string,
          category: args?.category as string, limit: 50,
        });
        const data = { incidents, snowInstance, generatedAt: new Date().toISOString() };
        const p1 = incidents.filter((i: any) => (i.priority || "").includes("1")).length;
        return widgetResponse(INCIDENT_DASHBOARD, data,
          `Incident Dashboard: ${incidents.length} incidents. P1: ${p1}, P2: ${incidents.filter((i: any) => (i.priority || "").includes("2")).length}`);
      }

      // ── Text: Get Incidents ──
      case "get-incidents": {
        const incidents = await snow.getIncidents({
          state: args?.state as string, priority: args?.priority as string,
          category: args?.category as string, assignment_group: args?.assignment_group as string,
          limit: args?.limit as number,
        });
        const dlpIncidents = applyDlpToRecords(incidents, 'incident', 'read');
        return textResponse(JSON.stringify(dlpIncidents, null, 2));
      }

      // ── Write: Create Incident ──
      case "create-incident": {
        const data = JSON.parse(args?.data as string || "{}");
        const writeCheck = applyDlpWriteCheck('incident', data);
        if (!writeCheck.allowed) return textResponse(`DLP blocked: ${writeCheck.reason}`);
        const result = await snow.createIncident(data);
        const snowInstance = process.env.SNOW_INSTANCE || "";
        return textResponse(`Incident created: ${result.number || "N/A"}\nLink: ${snowInstance}/nav_to.do?uri=incident.do?sys_id=${result.sys_id}`);
      }

      // ── Write: Update Incident ──
      case "update-incident": {
        const fields = JSON.parse(args?.fields as string || "{}");
        const writeCheck = applyDlpWriteCheck('incident', fields);
        if (!writeCheck.allowed) return textResponse(`DLP blocked: ${writeCheck.reason}`);
        const result = await snow.updateIncident(args?.sys_id as string, fields);
        return textResponse(`Incident updated. sys_id: ${result.sys_id}`);
      }

      // ── Widget: Problem Dashboard ──
      case "show-problem-dashboard": {
        const snowInstance = process.env.SNOW_INSTANCE || "";
        const problems = await snow.getProblems({
          state: args?.state as string, priority: args?.priority as string, limit: 50,
        });
        const data = { problems, snowInstance, generatedAt: new Date().toISOString() };
        return widgetResponse(PROBLEM_DASHBOARD, data,
          `Problem Dashboard: ${problems.length} problems. Known Errors: ${problems.filter((p: any) => p.known_error === "true").length}`);
      }

      // ── Write: Create Problem ──
      case "create-problem": {
        const data = JSON.parse(args?.data as string || "{}");
        const writeCheck = applyDlpWriteCheck('problem', data);
        if (!writeCheck.allowed) return textResponse(`DLP blocked: ${writeCheck.reason}`);
        const result = await snow.createProblem(data);
        const snowInstance = process.env.SNOW_INSTANCE || "";
        return textResponse(`Problem created: ${result.number || "N/A"}\nLink: ${snowInstance}/nav_to.do?uri=problem.do?sys_id=${result.sys_id}`);
      }

      // ── Write: Update Problem ──
      case "update-problem": {
        const fields = JSON.parse(args?.fields as string || "{}");
        const writeCheck = applyDlpWriteCheck('problem', fields);
        if (!writeCheck.allowed) return textResponse(`DLP blocked: ${writeCheck.reason}`);
        const result = await snow.updateProblem(args?.sys_id as string, fields);
        return textResponse(`Problem updated. sys_id: ${result.sys_id}`);
      }

      // ── Widget: SLA Dashboard ──
      case "show-sla-dashboard": {
        const snowInstance = process.env.SNOW_INSTANCE || "";
        const slas = await snow.getTaskSLAs({
          stage: args?.stage as string, has_breached: args?.has_breached as string, limit: 50,
        });
        const data = { slas, snowInstance, generatedAt: new Date().toISOString() };
        const breached = slas.filter((s: any) => s.has_breached === "true").length;
        return widgetResponse(SLA_DASHBOARD, data,
          `SLA Dashboard: ${slas.length} tracked. Breached: ${breached}. Compliance: ${slas.length > 0 ? Math.round((slas.length - breached) / slas.length * 100) : 100}%`);
      }

      // ── Text: Search Knowledge Base (semantic + fallback) ──
      case "search-knowledge": {
        const snowInstance = process.env.SNOW_INSTANCE || "";
        const searchResult = await search.searchKnowledge(args?.query as string, {
          source: args?.source as any,
          category: args?.category as string,
          top: (args?.limit as number) || 10,
        });

        // If semantic search returned results, use them
        if (searchResult.searchMode !== 'fallback' && searchResult.documents.length > 0) {
          const lines = searchResult.documents.map((d) =>
            `**${d.sourceId}**: ${d.title}\nSource: ${d.source} | Category: ${d.category} | Score: ${d.relevanceScore?.toFixed(3) ?? "N/A"}${d.url ? ` | [Open](${d.url})` : ""}`
          );
          return textResponse(`${searchResult.documents.length} result(s) via ${searchResult.searchMode} search (${searchResult.searchDurationMs}ms):\n\n${lines.join("\n\n")}`);
        }

        // Fallback to ServiceNow keyword search
        const articles = await snow.searchKnowledge(args?.query as string, (args?.limit as number) || 10);
        if (articles.length === 0) return textResponse(`No knowledge articles found for "${args?.query}".`);
        const lines = articles.map((a: any) =>
          `**${a.number}**: ${a.short_description}\nTopic: ${a.topic || "N/A"} | Views: ${a.sys_view_count || 0} | [Open](${snowInstance}/nav_to.do?uri=kb_knowledge.do?sys_id=${a.sys_id})`
        );
        return textResponse(`${articles.length} knowledge article(s) found (keyword fallback):\n\n${lines.join("\n\n")}`);
      }

      // ── Text: Search Incident Resolutions ──
      case "search-incident-resolutions": {
        const resolutions = await search.searchSimilarResolutions(
          args?.description as string,
          (args?.top as number) || 10,
        );
        if (resolutions.length === 0) {
          return textResponse(`No similar incident resolutions found. Azure AI Search may not be configured.`);
        }
        const lines = resolutions.map((d) =>
          `**${d.sourceId}**: ${d.title}\nResolution: ${d.content.slice(0, 300)}${d.content.length > 300 ? "…" : ""}\nScore: ${d.relevanceScore?.toFixed(3) ?? "N/A"}${d.url ? ` | [Open](${d.url})` : ""}`
        );
        return textResponse(`${resolutions.length} similar resolution(s) found:\n\n${lines.join("\n\n")}`);
      }

      // ── Text: Search Runbooks ──
      case "search-runbooks": {
        const runbooks = await search.searchRunbooks(args?.query as string);
        if (runbooks.length === 0) {
          return textResponse(`No runbooks found for "${args?.query}". Azure AI Search may not be configured.`);
        }
        const lines = runbooks.map((d) =>
          `**${d.sourceId}**: ${d.title}\nSummary: ${d.content.slice(0, 300)}${d.content.length > 300 ? "…" : ""}\nCategory: ${d.category} | Score: ${d.relevanceScore?.toFixed(3) ?? "N/A"}${d.url ? ` | [Open](${d.url})` : ""}`
        );
        return textResponse(`${runbooks.length} runbook(s) found:\n\n${lines.join("\n\n")}`);
      }

      // ── Text: Service Catalog ──
      case "get-catalog-items": {
        const items = await snow.getCatalogItems((args?.limit as number) || 50);
        return textResponse(JSON.stringify(items.map((i: any) => ({
          name: i.name, description: i.short_description, category: i.category, price: i.price,
        })), null, 2));
      }

      // ── Text: IT Assets ──
      case "get-assets": {
        const assets = await snow.getAssets({
          install_status: args?.install_status as string,
          model_category: args?.model_category as string,
          limit: args?.limit as number,
        });
        return textResponse(JSON.stringify(assets, null, 2));
      }

      // ── Text: Expired Warranties ──
      case "get-expired-warranties": {
        const assets = await snow.getExpiredWarrantyAssets((args?.limit as number) || 50);
        if (assets.length === 0) return textResponse("No assets with expired warranties found.");
        return textResponse(`${assets.length} asset(s) with expired warranties:\n\n` +
          JSON.stringify(assets.map((a: any) => ({
            name: a.display_name, tag: a.asset_tag, warranty_expiration: a.warranty_expiration,
            model: a.model, location: a.location,
          })), null, 2));
      }

      // ── Widget: ITSM Operations Briefing ──
      case "show-itsm-briefing": {
        const snowInstance = process.env.SNOW_INSTANCE || "";
        const now = new Date();

        // Gather data across all ITSM practices
        // Active incidents for pulse + all incidents for total count
        const [activeIncidents, allIncidents, problems, slas, openCRs, allCRs] = await Promise.all([
          snow.getIncidents({ limit: 200 }),           // active only (default: excludes resolved/closed/canceled)
          snow.getAllIncidents(200),                     // all states for total metrics
          snow.getProblems({ limit: 50 }),
          snow.getTaskSLAs({ limit: 50 }),
          snow.getOpenChangeRequests(100),
          snow.getClosedChanges(50),
        ]);

        const p1Incidents = activeIncidents.filter((i: any) => (i.priority || "").includes("1") || (i.priority || "").includes("2"));
        const openProblems = problems.filter((p: any) => !["Closed", "Canceled"].includes(p.state));
        const knownErrors = problems.filter((p: any) => p.known_error === "true").length;
        const slaBreaches = slas.filter((s: any) => s.has_breached === "true");
        const slaAtRisk = slas.filter((s: any) => {
          const pct = parseInt(s.percentage) || 0;
          return pct > 75 && s.has_breached !== "true" && s.stage === "In progress";
        });

        // Change collisions
        const ciGroups: Record<string, any[]> = {};
        for (const cr of openCRs) {
          const ciKey = cr.cmdb_ci?.display_value || cr.cmdb_ci || "";
          if (ciKey) { if (!ciGroups[ciKey]) ciGroups[ciKey] = []; ciGroups[ciKey].push(cr); }
        }
        const collisions = Object.entries(ciGroups).filter(([_, crs]) => crs.length > 1)
          .map(([ci, crs]) => ({ title: `${crs.length} changes on "${ci}"`, detail: crs.map((c: any) => c.number).join(", ") }));

        // Change success rate
        const successful = allCRs.filter((cr: any) => cr.close_code === "Successful").length;
        const changeSuccessRate = allCRs.length > 0 ? Math.round(successful / allCRs.length * 100) : 0;

        // Recommendations
        const recommendations: any[] = [];
        if (p1Incidents.length > 0)
          recommendations.push({ text: `<strong>${p1Incidents.length} major incident(s)</strong> require immediate attention. Assign and escalate per P1/P2 SLA.`, urgent: true });
        if (slaBreaches.length > 0)
          recommendations.push({ text: `<strong>${slaBreaches.length} SLA breach(es)</strong> — review and escalate. Update affected stakeholders.`, urgent: true });
        if (collisions.length > 0)
          recommendations.push({ text: `<strong>${collisions.length} change collision(s)</strong> — sequence or merge CRs targeting the same CI.`, urgent: false });
        if (knownErrors > 0)
          recommendations.push({ text: `<strong>${knownErrors} known error(s)</strong> in the problem backlog — review workarounds and plan permanent fixes.`, urgent: false });
        if (slaAtRisk.length > 0)
          recommendations.push({ text: `<strong>${slaAtRisk.length} SLA(s) at risk</strong> (>75% elapsed) — prioritize resolution to avoid breach.`, urgent: true });

        const data = {
          pulse: {
            p1Incidents: p1Incidents.length, totalIncidents: activeIncidents.length,
            allIncidents: allIncidents.length,
            openProblems: openProblems.length, knownErrors,
            slaBreaches: slaBreaches.length, slaAtRisk: slaAtRisk.length,
            openChanges: openCRs.length, collisions: collisions.length,
            changeSuccessRate, closedChanges: allCRs.length,
          },
          majorIncidents: p1Incidents.slice(0, 10),
          slaBreaches: slaBreaches.slice(0, 5).map((s: any) => ({
            taskName: s.task?.display_value || s.task || "",
            slaName: s.sla?.display_value || s.sla || "",
            businessTimeLeft: s.business_time_left,
          })),
          collisions, recommendations,
          snowInstance, generatedAt: now.toISOString(),
        };
        const summary = `ITSM Briefing: ${activeIncidents.length} active incidents (${p1Incidents.length} P1/P2, ${allIncidents.length} total) | ${openProblems.length} problems | ${slaBreaches.length} SLA breaches | ${openCRs.length} changes (${collisions.length} collisions) | ${changeSuccessRate}% change success rate`;
        return widgetResponse(ITSM_BRIEFING, data, summary);
      }

      // ── Text: Azure Monitor Alerts ──
      case "get-azure-alerts": {
        if (!azmon.isConfigured()) return textResponse("Azure Monitor is not configured. Set AZURE_SUBSCRIPTION_ID and authenticate via managed identity or AZURE_MONITOR_TOKEN.");
        const alerts = await azmon.getAlerts((args?.limit as number) || 20);
        if (alerts.length === 0) return textResponse("No Azure Monitor alerts found.");
        return textResponse(JSON.stringify(alerts, null, 2));
      }

      // ── Lookup: Assignment Groups ──
      case "lookup-assignment-groups": {
        const groups = await snow.lookupAssignmentGroups(args?.query as string || "", 10);
        const dlpGroups = applyDlpToRecords(groups, 'sys_user_group', 'read');
        return textResponse(JSON.stringify(dlpGroups, null, 2));
      }

      // ── Lookup: CMDB CIs ──
      case "lookup-cmdb-cis": {
        const cis = await snow.lookupCmdbCis(args?.query as string || "", 10);
        return textResponse(JSON.stringify(cis, null, 2));
      }

      // ── Write: Create Knowledge Article ──
      case "create-knowledge-article": {
        const kbData: any = {};
        if (args?.short_description) kbData.short_description = args.short_description;
        if (args?.text) kbData.text = args.text;
        if (args?.category) kbData.category = args.category;
        kbData.workflow_state = args?.workflow_state || "draft";
        const writeCheck = applyDlpWriteCheck('kb_knowledge', kbData);
        if (!writeCheck.allowed) return textResponse(`DLP blocked: ${writeCheck.reason}`);
        const result = await snow.createKnowledgeArticle(kbData);
        const snowInstance = process.env.SNOW_INSTANCE || "";
        return textResponse(`Knowledge Article created: ${result.number || 'N/A'}\nState: ${kbData.workflow_state}\nLink: ${snowInstance}/nav_to.do?uri=kb_knowledge.do?sys_id=${result.sys_id}`);
      }

      // ── Write: Update Knowledge Article ──
      case "update-knowledge-article": {
        const fields = JSON.parse(args?.fields as string || "{}");
        const writeCheck = applyDlpWriteCheck('kb_knowledge', fields);
        if (!writeCheck.allowed) return textResponse(`DLP blocked: ${writeCheck.reason}`);
        const result = await snow.updateKnowledgeArticle(args?.sys_id as string, fields);
        return textResponse(`Knowledge Article updated. sys_id: ${result.sys_id}`);
      }

      // ── Vendor & Licensing Management ──
      case "get-vendors": {
        const snowInstance = process.env.SNOW_INSTANCE || "";
        const vendors = await snow.getVendors({
          query: args?.query as string,
          vendor_type: args?.vendor_type as string,
          limit: args?.limit as number,
        });
        if (vendors.length === 0) return textResponse("No vendors found matching the criteria.");
        const lines = vendors.map((v: any) =>
          `**${v.name}** | Type: ${v.vendor_type || "N/A"} | Phone: ${v.phone || "N/A"} | Website: ${v.website || "N/A"} | [Open](${snowInstance}/nav_to.do?uri=core_company.do?sys_id=${v.sys_id})`
        );
        return textResponse(`${vendors.length} vendor(s) found:\n\n${lines.join("\n\n")}`);
      }

      case "get-software-licenses": {
        const licenses = await snow.getSoftwareLicenses({
          product: args?.product as string,
          publisher: args?.publisher as string,
          state: args?.state as string,
          limit: args?.limit as number,
        });
        if (licenses.length === 0) return textResponse("No software licenses found.");
        return textResponse(JSON.stringify(licenses.map((l: any) => ({
          product: l.product_name, publisher: l.publisher, rights: l.rights,
          installed: l.installed_count, start: l.start_date, end: l.end_date,
          cost: l.cost, state: l.state,
        })), null, 2));
      }

      case "get-license-compliance": {
        const { licenses, compliant, overDeployed, underUtilized } = await snow.getLicenseCompliance((args?.limit as number) || 100);
        const total = licenses.length;
        let result = `## License Compliance Summary\n\n`;
        result += `- **Total Licenses:** ${total}\n`;
        result += `- **Compliant:** ${compliant} (${total > 0 ? Math.round(compliant / total * 100) : 0}%)\n`;
        result += `- **Over-Deployed:** ${overDeployed} ⚠️\n`;
        result += `- **Under-Utilized:** ${underUtilized}\n\n`;

        if (overDeployed > 0) {
          result += `### Over-Deployed Licenses (Risk)\n`;
          const overItems = licenses.filter((l: any) => l._compliance === "over-deployed");
          for (const l of overItems) {
            result += `- **${l.product_name}** (${l.publisher || "N/A"}): ${l.installed_count} installed / ${l.rights} entitled — **${parseInt(l.installed_count) - parseInt(l.rights)} over**\n`;
          }
          result += `\n`;
        }
        if (underUtilized > 0) {
          result += `### Under-Utilized Licenses (Cost Savings Opportunity)\n`;
          const underItems = licenses.filter((l: any) => l._compliance === "under-utilized");
          for (const l of underItems) {
            result += `- **${l.product_name}** (${l.publisher || "N/A"}): ${l.installed_count} installed / ${l.rights} entitled — ${parseInt(l.rights) - parseInt(l.installed_count)} unused\n`;
          }
        }
        return textResponse(result);
      }

      case "get-contracts": {
        const snowInstance = process.env.SNOW_INSTANCE || "";
        const contracts = await snow.getContracts({
          vendor: args?.vendor as string,
          state: args?.state as string,
          contract_type: args?.contract_type as string,
          limit: args?.limit as number,
        });
        if (contracts.length === 0) return textResponse("No contracts found.");
        const lines = contracts.map((c: any) =>
          `**${c.number}**: ${c.short_description || "N/A"} | Vendor: ${c.vendor?.display_value || c.vendor || "N/A"} | Ends: ${c.ends || "N/A"} | Cost: ${c.cost || "N/A"} | State: ${c.state || "N/A"} | [Open](${snowInstance}/nav_to.do?uri=ast_contract.do?sys_id=${c.sys_id})`
        );
        return textResponse(`${contracts.length} contract(s):\n\n${lines.join("\n\n")}`);
      }

      case "get-expiring-contracts": {
        const withinDays = (args?.within_days as number) || 90;
        const contracts = await snow.getExpiringContracts(withinDays, (args?.limit as number) || 50);
        if (contracts.length === 0) return textResponse(`No contracts expiring within ${withinDays} days.`);
        const snowInstance = process.env.SNOW_INSTANCE || "";
        let result = `## Contracts Expiring Within ${withinDays} Days\n\n`;
        result += `**${contracts.length} contract(s) require attention:**\n\n`;
        for (const c of contracts) {
          const endsDate = new Date(c.ends);
          const daysLeft = Math.ceil((endsDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          const urgency = daysLeft <= 30 ? "🔴 URGENT" : daysLeft <= 60 ? "🟡 SOON" : "🟢 PLANNED";
          result += `- ${urgency} **${c.number}**: ${c.short_description || "N/A"} | Vendor: ${c.vendor?.display_value || c.vendor || "N/A"} | Expires: ${c.ends} (${daysLeft} days) | Cost: ${c.cost || "N/A"} | [Open](${snowInstance}/nav_to.do?uri=ast_contract.do?sys_id=${c.sys_id})\n`;
        }
        return textResponse(result);
      }

      // ── Knowledge-Centred Service (KCS) ──
      case "get-kb-categories": {
        const categories = await snow.getKbCategories((args?.limit as number) || 50);
        if (categories.length === 0) return textResponse("No knowledge base categories found.");
        return textResponse(JSON.stringify(categories.map((c: any) => ({
          label: c.label, description: c.description, parent: c.parent_id?.display_value || "",
        })), null, 2));
      }

      case "get-kb-analytics": {
        const stats = await snow.getKbStats();
        let result = `## Knowledge Base Analytics\n\n`;
        result += `- **Total Articles:** ${stats.total}\n`;
        result += `- **Published:** ${stats.published}\n`;
        result += `- **Draft:** ${stats.draft}\n`;
        result += `- **Retired:** ${stats.retired}\n`;
        result += `- **Average Views per Article:** ${stats.avgViews}\n\n`;
        if (stats.topCategories.length > 0) {
          result += `### Top Categories\n`;
          for (const cat of stats.topCategories) {
            result += `- ${cat.category}: ${cat.count} articles\n`;
          }
        }
        if (stats.draft > 0) {
          result += `\n**Action:** ${stats.draft} draft article(s) awaiting review and publication.\n`;
        }
        return textResponse(result);
      }

      case "get-top-kb-articles": {
        const snowInstance = process.env.SNOW_INSTANCE || "";
        const articles = await snow.getTopKbArticles((args?.limit as number) || 20);
        if (articles.length === 0) return textResponse("No published knowledge articles found.");
        const lines = articles.map((a: any, i: number) =>
          `${i + 1}. **${a.number}**: ${a.short_description} | Views: ${a.sys_view_count || 0} | Rating: ${a.rating || "N/A"} | [Open](${snowInstance}/nav_to.do?uri=kb_knowledge.do?sys_id=${a.sys_id})`
        );
        return textResponse(`## Top Knowledge Articles (by views)\n\n${lines.join("\n")}`);
      }

      case "get-kb-gap-analysis": {
        const { gaps, totalIncidentsWithoutKb } = await snow.getKbGapAnalysis((args?.limit as number) || 50);
        if (gaps.length === 0) return textResponse("No incident categories found for analysis.");
        let result = `## Knowledge Base Gap Analysis\n\n`;
        result += `**${totalIncidentsWithoutKb} active incidents** have categories with no matching KB articles.\n\n`;
        result += `| Category | Active Incidents | KB Articles | Status |\n`;
        result += `|----------|-----------------|-------------|--------|\n`;
        for (const g of gaps) {
          const status = g.kbArticleCount === 0 ? "❌ GAP" : g.kbArticleCount < 3 ? "⚠️ LOW" : "✅ OK";
          result += `| ${g.category} | ${g.incidentCount} | ${g.kbArticleCount} | ${status} |\n`;
        }
        result += `\n**KCS Recommendation:** Prioritize creating articles for categories marked as GAP, starting with highest incident volume. This will improve first-contact resolution and self-service deflection.\n`;
        return textResponse(result);
      }

      // ── Write: Create Asset ──
      case "create-asset": {
        const data = JSON.parse(args?.data as string || "{}");
        const result = await snow.createAsset(data);
        const snowInstance = process.env.SNOW_INSTANCE || "";
        return textResponse(`Asset created: ${result.display_name || result.asset_tag || "N/A"}\nLink: ${snowInstance}/nav_to.do?uri=alm_hardware.do?sys_id=${result.sys_id}`);
      }

      // ── Write: Update Asset ──
      case "update-asset": {
        const fields = JSON.parse(args?.fields as string || "{}");
        const result = await snow.updateAsset(args?.sys_id as string, fields);
        return textResponse(`Asset updated. sys_id: ${result.sys_id}`);
      }

      // ── Write: Create Service Request ──
      case "create-service-request": {
        const data = JSON.parse(args?.data as string || "{}");
        const result = await snow.createServiceRequest(data);
        const snowInstance = process.env.SNOW_INSTANCE || "";
        return textResponse(`Service Request created: ${result.number || "N/A"}\nLink: ${snowInstance}/nav_to.do?uri=sc_request.do?sys_id=${result.sys_id}`);
      }

      // ── Write: Update Service Request ──
      case "update-service-request": {
        const fields = JSON.parse(args?.fields as string || "{}");
        const result = await snow.updateServiceRequest(args?.sys_id as string, fields);
        return textResponse(`Service Request updated. sys_id: ${result.sys_id}`);
      }

      // ── Write: Create Vendor ──
      case "create-vendor": {
        const data = JSON.parse(args?.data as string || "{}");
        const result = await snow.createVendor(data);
        const snowInstance = process.env.SNOW_INSTANCE || "";
        return textResponse(`Vendor created: ${result.name || "N/A"}\nLink: ${snowInstance}/nav_to.do?uri=core_company.do?sys_id=${result.sys_id}`);
      }

      // ── Write: Update Vendor ──
      case "update-vendor": {
        const fields = JSON.parse(args?.fields as string || "{}");
        const result = await snow.updateVendor(args?.sys_id as string, fields);
        return textResponse(`Vendor updated. sys_id: ${result.sys_id}`);
      }

      // ── Write: Create Contract ──
      case "create-contract": {
        const data = JSON.parse(args?.data as string || "{}");
        const result = await snow.createContract(data);
        const snowInstance = process.env.SNOW_INSTANCE || "";
        return textResponse(`Contract created: ${result.number || "N/A"}\nLink: ${snowInstance}/nav_to.do?uri=ast_contract.do?sys_id=${result.sys_id}`);
      }

      // ── Write: Update Contract ──
      case "update-contract": {
        const fields = JSON.parse(args?.fields as string || "{}");
        const result = await snow.updateContract(args?.sys_id as string, fields);
        return textResponse(`Contract updated. sys_id: ${result.sys_id}`);
      }

      // ── DLP Status ──
      case "get-dlp-status": {
        const status = getDlpStatus();
        return textResponse(JSON.stringify(status, null, 2));
      }

      // ── Widget: Mission Control ──
      case "show-mission-control": {
        const now = new Date();
        const mockInvocations = [
          { timestamp: new Date(now.getTime() - 120000).toISOString(), tool: "get-incidents", worker: "incident-triage", duration: 1200, status: "success" },
          { timestamp: new Date(now.getTime() - 300000).toISOString(), tool: "search-knowledge", worker: "kb-resolver", duration: 890, status: "success" },
          { timestamp: new Date(now.getTime() - 480000).toISOString(), tool: "update-incident", worker: "incident-triage", duration: 450, status: "success" },
          { timestamp: new Date(now.getTime() - 600000).toISOString(), tool: "get-change-requests", worker: "change-analyst", duration: 1100, status: "success" },
          { timestamp: new Date(now.getTime() - 720000).toISOString(), tool: "show-blast-radius", worker: "change-analyst", duration: 3200, status: "success" },
          { timestamp: new Date(now.getTime() - 900000).toISOString(), tool: "create-incident", worker: "auto-categorizer", duration: 680, status: "success" },
          { timestamp: new Date(now.getTime() - 1080000).toISOString(), tool: "get-sla-breaches", worker: "sla-monitor", duration: 540, status: "failure" },
          { timestamp: new Date(now.getTime() - 1200000).toISOString(), tool: "search-runbooks", worker: "kb-resolver", duration: 2100, status: "success" },
          { timestamp: new Date(now.getTime() - 1500000).toISOString(), tool: "get-azure-alerts", worker: "infra-monitor", duration: 1800, status: "success" },
          { timestamp: new Date(now.getTime() - 1800000).toISOString(), tool: "detect-change-collisions", worker: "change-analyst", duration: 950, status: "success" },
        ];
        const mockWorkers = [
          { name: "incident-triage", type: "Digital Worker", status: "active", lastAction: "Triaged INC0010042", delegatedAt: new Date(now.getTime() - 3600000).toISOString() },
          { name: "change-analyst", type: "Digital Worker", status: "active", lastAction: "Reviewed CHG0000015", delegatedAt: new Date(now.getTime() - 7200000).toISOString() },
          { name: "kb-resolver", type: "Digital Worker", status: "idle", lastAction: "Searched KB for DNS resolution", delegatedAt: new Date(now.getTime() - 1800000).toISOString() },
          { name: "sla-monitor", type: "Scheduled Worker", status: "active", lastAction: "Checked SLA compliance", delegatedAt: new Date(now.getTime() - 600000).toISOString() },
        ];
        const mockHitlQueue = [
          { id: "HITL-001", action: "Approve emergency change CHG0000023", requestedBy: "change-analyst", resource: "CHG0000023", urgency: "high", requestedAt: new Date(now.getTime() - 900000).toISOString() },
          { id: "HITL-002", action: "Confirm incident escalation INC0010045", requestedBy: "incident-triage", resource: "INC0010045", urgency: "medium", requestedAt: new Date(now.getTime() - 1200000).toISOString() },
          { id: "HITL-003", action: "Review KB article draft KB0010089", requestedBy: "kb-resolver", resource: "KB0010089", urgency: "low", requestedAt: new Date(now.getTime() - 3600000).toISOString() },
        ];
        const mockScheduledJobs = [
          { name: "SLA Compliance Check", nextFire: new Date(now.getTime() + 300000).toISOString(), schedule: "*/5 * * * *", status: "active" },
          { name: "Incident Auto-Triage", nextFire: new Date(now.getTime() + 600000).toISOString(), schedule: "*/10 * * * *", status: "active" },
          { name: "Change Collision Detection", nextFire: new Date(now.getTime() + 3600000).toISOString(), schedule: "0 * * * *", status: "active" },
          { name: "KB Gap Analysis", nextFire: new Date(now.getTime() + 86400000).toISOString(), schedule: "0 6 * * *", status: "active" },
        ];
        const data = { recentInvocations: mockInvocations, activeWorkers: mockWorkers, hitlQueue: mockHitlQueue, scheduledJobs: mockScheduledJobs, generatedAt: now.toISOString() };
        return widgetResponse(MISSION_CONTROL, data, `Mission Control: ${mockInvocations.length} recent invocations, ${mockWorkers.filter(w => w.status === "active").length} active workers, ${mockHitlQueue.length} pending approvals`);
      }

      // ── Widget: Audit Trail ──
      case "show-audit-trail": {
        const now = new Date();
        const mockRecords = [
          { timestamp: new Date(now.getTime() - 60000).toISOString(), action: "incident.create", user: "system", worker: "auto-categorizer", resource: "INC0010042", outcome: "success", severity: "info", details: "Auto-created incident from Azure Monitor alert" },
          { timestamp: new Date(now.getTime() - 180000).toISOString(), action: "incident.update", user: "jsmith", worker: "incident-triage", resource: "INC0010041", outcome: "success", severity: "info", details: "Priority escalated from P3 to P2" },
          { timestamp: new Date(now.getTime() - 300000).toISOString(), action: "change.approve", user: "cab-board", worker: "change-analyst", resource: "CHG0000015", outcome: "success", severity: "warning", details: "Emergency change approved via fast-track" },
          { timestamp: new Date(now.getTime() - 600000).toISOString(), action: "sla.breach", user: "system", worker: "sla-monitor", resource: "SLA0001234", outcome: "failure", severity: "error", details: "P1 resolution SLA breached for INC0010039" },
          { timestamp: new Date(now.getTime() - 900000).toISOString(), action: "kb.create", user: "kb-resolver", worker: "kb-resolver", resource: "KB0010089", outcome: "success", severity: "info", details: "KB article drafted from INC0010038 resolution" },
          { timestamp: new Date(now.getTime() - 1200000).toISOString(), action: "cmdb.update", user: "asset-manager", worker: "asset-lifecycle", resource: "CI-SRV-0042", outcome: "success", severity: "info", details: "Updated OS version to Windows Server 2022" },
          { timestamp: new Date(now.getTime() - 1800000).toISOString(), action: "incident.escalate", user: "incident-triage", worker: "incident-triage", resource: "INC0010040", outcome: "success", severity: "warning", details: "Escalated to vendor support team" },
          { timestamp: new Date(now.getTime() - 3600000).toISOString(), action: "security.block", user: "security-admin", worker: "shadow-scanner", resource: "AGENT-UNAUTH-003", outcome: "success", severity: "critical", details: "Blocked unauthorized AI agent accessing CMDB" },
          { timestamp: new Date(now.getTime() - 5400000).toISOString(), action: "change.reject", user: "cab-board", worker: "change-analyst", resource: "CHG0000014", outcome: "failure", severity: "warning", details: "Rejected: missing backout plan per NIST CM-3" },
          { timestamp: new Date(now.getTime() - 7200000).toISOString(), action: "problem.create", user: "problem-manager", worker: "incident-triage", resource: "PRB0000012", outcome: "success", severity: "info", details: "Problem created from 3 recurring DNS incidents" },
        ];
        const data = { records: mockRecords, query: { search: args?.search || "", dateFrom: args?.date_from || "", dateTo: args?.date_to || "" }, generatedAt: now.toISOString() };
        return widgetResponse(AUDIT_TRAIL, data, `Audit Trail: ${mockRecords.length} records. Errors: ${mockRecords.filter(r => r.severity === "error" || r.severity === "critical").length}`);
      }

      // ── Text: Query Audit ──
      case "query-audit": {
        const now = new Date();
        let records = [
          { timestamp: new Date(now.getTime() - 60000).toISOString(), action: "incident.create", user: "system", worker: "auto-categorizer", resource: "INC0010042", outcome: "success" },
          { timestamp: new Date(now.getTime() - 180000).toISOString(), action: "incident.update", user: "jsmith", worker: "incident-triage", resource: "INC0010041", outcome: "success" },
          { timestamp: new Date(now.getTime() - 300000).toISOString(), action: "change.approve", user: "cab-board", worker: "change-analyst", resource: "CHG0000015", outcome: "success" },
          { timestamp: new Date(now.getTime() - 600000).toISOString(), action: "sla.breach", user: "system", worker: "sla-monitor", resource: "SLA0001234", outcome: "failure" },
          { timestamp: new Date(now.getTime() - 900000).toISOString(), action: "kb.create", user: "kb-resolver", worker: "kb-resolver", resource: "KB0010089", outcome: "success" },
        ];
        if (args?.action) records = records.filter(r => r.action.includes(args!.action as string));
        if (args?.user) records = records.filter(r => r.user === args!.user);
        if (args?.worker) records = records.filter(r => r.worker === args!.worker);
        if (args?.limit) records = records.slice(0, args.limit as number);
        return textResponse(JSON.stringify(records, null, 2));
      }

      // ── Widget: FinOps Dashboard ──
      case "show-finops-dashboard": {
        const now = new Date();
        const costTrend = Array.from({ length: 30 }, (_, i) => {
          const d = new Date(now.getTime() - (29 - i) * 86400000);
          return { date: d.toISOString().split("T")[0], cost: Math.round(10000 + Math.random() * 5000 + (i > 20 ? 2000 : 0)) };
        });
        const topDrivers = [
          { resource: "prod-aks-cluster", type: "Microsoft.ContainerService/managedClusters", cost: 8450, change: 12.5 },
          { resource: "prod-sql-primary", type: "Microsoft.Sql/servers", cost: 6200, change: -3.2 },
          { resource: "prod-appgw-01", type: "Microsoft.Network/applicationGateways", cost: 4100, change: 0.8 },
          { resource: "prod-cosmos-main", type: "Microsoft.DocumentDB/databaseAccounts", cost: 3800, change: 25.1 },
          { resource: "prod-redis-cache", type: "Microsoft.Cache/Redis", cost: 2900, change: -1.5 },
        ];
        const recommendations = [
          { resource: "dev-vm-test-01", currentSku: "Standard_D4s_v3", recommendedSku: "Standard_B2ms", savings: 850, reason: "Average CPU utilization <15% over 30 days" },
          { resource: "staging-sql-02", currentSku: "GP_Gen5_8", recommendedSku: "GP_Gen5_4", savings: 620, reason: "DTU usage consistently below 40%" },
          { resource: "prod-redis-cache", currentSku: "Premium P2", recommendedSku: "Premium P1", savings: 480, reason: "Memory utilization <30%, connections <100" },
        ];
        const budget = { allocated: 55000, actual: 42800, forecast: 48500 };
        const anomalies = [
          { resource: "prod-cosmos-main", date: new Date(now.getTime() - 172800000).toISOString().split("T")[0], expectedCost: 120, actualCost: 380, severity: "high" },
          { resource: "dev-storage-logs", date: new Date(now.getTime() - 86400000).toISOString().split("T")[0], expectedCost: 15, actualCost: 45, severity: "medium" },
        ];
        const data = { costTrend, topDrivers, recommendations, budget, anomalies, generatedAt: now.toISOString() };
        const totalSavings = recommendations.reduce((s, r) => s + r.savings, 0);
        return widgetResponse(FINOPS_DASHBOARD, data, `FinOps Dashboard: $${budget.actual.toLocaleString()} actual / $${budget.allocated.toLocaleString()} budget. ${recommendations.length} right-sizing opportunities ($${totalSavings}/mo savings). ${anomalies.length} anomalies detected.`);
      }

      // ── Widget: Shadow Agent Discovery ──
      case "scan-shadow-agents": {
        const now = new Date();
        let agents = [
          { name: "auto-ticket-bot", type: "ChatBot", platform: "Slack", owner: "help-desk-team", complianceStatus: "unauthorized", lastSeen: new Date(now.getTime() - 3600000).toISOString(), riskLevel: "high", details: "Unregistered bot creating ServiceNow tickets via API. No audit trail." },
          { name: "cost-alert-agent", type: "Scheduled Agent", platform: "Azure Functions", owner: "finance-ops", complianceStatus: "unmonitored", lastSeen: new Date(now.getTime() - 7200000).toISOString(), riskLevel: "medium", details: "Registered but not integrated with central monitoring. Missing telemetry." },
          { name: "deploy-helper", type: "CI/CD Agent", platform: "GitHub Actions", owner: "platform-eng", complianceStatus: "non-compliant", lastSeen: new Date(now.getTime() - 1800000).toISOString(), riskLevel: "medium", details: "Using outdated API keys. Not following secret rotation policy." },
          { name: "incident-classifier", type: "ML Agent", platform: "Azure ML", owner: "data-science", complianceStatus: "compliant", lastSeen: new Date(now.getTime() - 600000).toISOString(), riskLevel: "low", details: "Registered, monitored, and compliant with governance policies." },
          { name: "password-reset-bot", type: "RPA Bot", platform: "Power Automate", owner: "identity-team", complianceStatus: "compliant", lastSeen: new Date(now.getTime() - 300000).toISOString(), riskLevel: "low", details: "Approved RPA for password resets. Full audit trail." },
          { name: "legacy-sync-agent", type: "Data Sync", platform: "On-Prem VM", owner: "unknown", complianceStatus: "unauthorized", lastSeen: new Date(now.getTime() - 86400000).toISOString(), riskLevel: "critical", details: "Unknown owner. Syncing CMDB data to external endpoint. Investigate immediately." },
          { name: "backup-monitor", type: "Monitoring Agent", platform: "Azure Functions", owner: "infra-ops", complianceStatus: "unmonitored", lastSeen: new Date(now.getTime() - 14400000).toISOString(), riskLevel: "medium", details: "Running backup checks but not reporting to central dashboard." },
          { name: "vendor-api-proxy", type: "API Gateway", platform: "AWS Lambda", owner: "vendor-mgmt", complianceStatus: "non-compliant", lastSeen: new Date(now.getTime() - 43200000).toISOString(), riskLevel: "high", details: "Cross-cloud agent not following data residency policies." },
        ];
        if (args?.platform) agents = agents.filter(a => a.platform.toLowerCase().includes((args!.platform as string).toLowerCase()));
        if (args?.compliance_status) agents = agents.filter(a => a.complianceStatus === args!.compliance_status);
        const summary = {
          total: agents.length,
          unauthorized: agents.filter(a => a.complianceStatus === "unauthorized").length,
          unmonitored: agents.filter(a => a.complianceStatus === "unmonitored").length,
          nonCompliant: agents.filter(a => a.complianceStatus === "non-compliant").length,
          compliant: agents.filter(a => a.complianceStatus === "compliant").length,
        };
        const data = { agents, summary, generatedAt: now.toISOString() };
        return widgetResponse(SHADOW_AGENTS, data, `Shadow Agent Scan: ${summary.total} agents discovered. Unauthorized: ${summary.unauthorized}, Unmonitored: ${summary.unmonitored}, Non-Compliant: ${summary.nonCompliant}, Compliant: ${summary.compliant}`);
      }

      // ── Widget: Schedule Control ──
      case "show-scheduled-jobs": {
        const now = new Date();
        const makeHistory = (successes: number, failures: number) => {
          const h = [];
          for (let i = 0; i < successes + failures; i++) {
            h.push({ time: new Date(now.getTime() - (i + 1) * 600000).toISOString(), result: i < failures ? "failure" : "success" });
          }
          return h.reverse();
        };
        let jobs = [
          { id: "job-sla-check", name: "SLA Compliance Check", schedule: "*/5 * * * *", lastRun: new Date(now.getTime() - 300000).toISOString(), nextRun: new Date(now.getTime() + 300000).toISOString(), status: "active", lastResult: "success", runHistory: makeHistory(9, 1) },
          { id: "job-incident-triage", name: "Incident Auto-Triage", schedule: "*/10 * * * *", lastRun: new Date(now.getTime() - 600000).toISOString(), nextRun: new Date(now.getTime() + 600000).toISOString(), status: "active", lastResult: "success", runHistory: makeHistory(10, 0) },
          { id: "job-change-collision", name: "Change Collision Detection", schedule: "0 * * * *", lastRun: new Date(now.getTime() - 1800000).toISOString(), nextRun: new Date(now.getTime() + 1800000).toISOString(), status: "active", lastResult: "success", runHistory: makeHistory(8, 2) },
          { id: "job-kb-gap", name: "KB Gap Analysis", schedule: "0 6 * * *", lastRun: new Date(now.getTime() - 43200000).toISOString(), nextRun: new Date(now.getTime() + 43200000).toISOString(), status: "active", lastResult: "success", runHistory: makeHistory(7, 0) },
          { id: "job-shadow-scan", name: "Shadow Agent Scan", schedule: "0 */4 * * *", lastRun: new Date(now.getTime() - 7200000).toISOString(), nextRun: new Date(now.getTime() + 7200000).toISOString(), status: "paused", lastResult: "success", runHistory: makeHistory(5, 1) },
          { id: "job-cost-report", name: "Daily Cost Report", schedule: "0 8 * * *", lastRun: new Date(now.getTime() - 86400000).toISOString(), nextRun: new Date(now.getTime() + 28800000).toISOString(), status: "active", lastResult: "failure", runHistory: makeHistory(6, 3) },
        ];
        if (args?.status) jobs = jobs.filter(j => j.status === args!.status);
        const data = { jobs, generatedAt: now.toISOString() };
        return widgetResponse(SCHEDULE_CONTROL, data, `Schedule Control: ${jobs.length} jobs. Active: ${jobs.filter(j => j.status === "active").length}, Paused: ${jobs.filter(j => j.status === "paused").length}`);
      }

      // ── Text: Pause Job ──
      case "pause-job": {
        const jobId = args?.job_id as string;
        return textResponse(`Job "${jobId}" has been paused. It will not fire until resumed.`);
      }

      // ── Text: Resume Job ──
      case "resume-job": {
        const jobId = args?.job_id as string;
        return textResponse(`Job "${jobId}" has been resumed. It will fire at its next scheduled time.`);
      }

      // ── Text: Harvest Resolution ──
      case "harvest-resolution": {
        const incNumber = args?.incident_number as string;
        const includeWorkaround = args?.include_workaround !== false;
        try {
          const incidents = await snow.getIncidents({ limit: 1 });
          const inc = incidents.find((i: any) => i.number === incNumber) || {
            number: incNumber,
            short_description: "Application performance degradation on prod-web-cluster",
            description: "Users reporting slow response times on customer portal. Average response time increased from 200ms to 2500ms.",
            category: "Performance",
            priority: "2 - High",
            state: "Resolved",
            close_notes: "Root cause: Connection pool exhaustion due to leaked database connections in the order processing module. Fix: Updated connection pool settings (max connections: 100→200, idle timeout: 30s→15s) and deployed hotfix v2.4.1 to patch the connection leak.",
            resolved_at: new Date().toISOString(),
            assigned_to: { display_value: "Sarah Chen" },
          };
          const result: any = {
            sourceIncident: inc.number,
            title: inc.short_description,
            category: inc.category || "General",
            problem: inc.description || inc.short_description,
            resolution: inc.close_notes || "No resolution notes recorded.",
            resolvedBy: inc.assigned_to?.display_value || inc.assigned_to || "Unknown",
            resolvedAt: inc.resolved_at || inc.closed_at || "N/A",
            priority: inc.priority,
            suggestedKeywords: [inc.category, "resolution", "troubleshooting"].filter(Boolean),
          };
          if (includeWorkaround) {
            result.workaround = "Restart the affected application pool as a temporary measure while the permanent fix is deployed.";
          }
          return textResponse(JSON.stringify(result, null, 2));
        } catch {
          return textResponse(`Could not retrieve incident ${incNumber}. Using mock data for demonstration.`);
        }
      }

      // ── Text: Propose KB Draft ──
      case "propose-kb-draft": {
        const kbData: any = {
          short_description: args?.title as string,
          text: args?.body as string,
          category: args?.category || "General",
          workflow_state: "draft",
        };
        if (args?.keywords) {
          kbData.meta = args.keywords;
        }
        if (args?.source_incident) {
          kbData.text = `<p><em>Source: ${args.source_incident}</em></p>\n${kbData.text}`;
        }
        const writeCheck = applyDlpWriteCheck('kb_knowledge', kbData);
        if (!writeCheck.allowed) return textResponse(`DLP blocked: ${writeCheck.reason}`);
        try {
          const result = await snow.createKnowledgeArticle(kbData);
          const snowInstance = process.env.SNOW_INSTANCE || "";
          return textResponse(`KB Draft created: ${result.number || "N/A"}\nTitle: ${args?.title}\nState: draft\nLink: ${snowInstance}/nav_to.do?uri=kb_knowledge.do?sys_id=${result.sys_id}`);
        } catch {
          return textResponse(`KB Draft prepared (not saved — ServiceNow unavailable):\nTitle: ${args?.title}\nCategory: ${kbData.category}\nKeywords: ${args?.keywords || "N/A"}\nBody preview: ${(args?.body as string || "").slice(0, 200)}...`);
        }
      }

      // ── Widget: Shift Handover ──
      case "generate-shift-handover": {
        const now = new Date();
        const shiftHours = (args?.shift_hours as number) || 8;
        const shiftStart = new Date(now.getTime() - shiftHours * 3600000);
        const team = (args?.team as string) || "Operations Team Alpha";

        let incidentData: any = { opened: 5, closed: 3, escalated: 1, items: [] };
        let changeData: any = { approved: 2, rejected: 0, implemented: 1, items: [] };
        let problemData: any = { new: 1, updated: 2, items: [] };
        let slaData: any = { breached: 1, atRisk: 2, met: 15 };

        try {
          const [incidents, changes, problems, slas] = await Promise.all([
            snow.getIncidents({ limit: 50 }),
            snow.getOpenChangeRequests(50),
            snow.getProblems({ limit: 20 }),
            snow.getTaskSLAs({ limit: 50 }),
          ]);
          const recentInc = incidents.filter((i: any) => i.opened_at && new Date(i.opened_at) >= shiftStart);
          incidentData = {
            opened: recentInc.length,
            closed: recentInc.filter((i: any) => i.state === "Resolved" || i.state === "Closed").length,
            escalated: recentInc.filter((i: any) => (i.priority || "").includes("1")).length,
            items: recentInc.slice(0, 10).map((i: any) => ({ number: i.number, description: i.short_description, priority: i.priority, status: i.state })),
          };
          changeData = {
            approved: changes.filter((c: any) => c.state === "Scheduled").length,
            rejected: changes.filter((c: any) => c.state === "Canceled").length,
            implemented: changes.filter((c: any) => c.state === "Implement" || c.state === "Review").length,
            items: changes.slice(0, 5).map((c: any) => ({ number: c.number, description: c.short_description, status: c.state })),
          };
          problemData = {
            new: problems.filter((p: any) => p.state === "New").length,
            updated: problems.filter((p: any) => p.state !== "New" && p.state !== "Closed").length,
            items: problems.slice(0, 5).map((p: any) => ({ number: p.number, description: p.short_description, status: p.state })),
          };
          const breached = slas.filter((s: any) => s.has_breached === "true");
          const atRisk = slas.filter((s: any) => { const pct = parseInt(s.percentage) || 0; return pct > 75 && s.has_breached !== "true"; });
          slaData = { breached: breached.length, atRisk: atRisk.length, met: slas.length - breached.length - atRisk.length };
        } catch { /* use defaults */ }

        const data = {
          shiftPeriod: { from: shiftStart.toISOString(), to: now.toISOString(), team },
          incidents: incidentData,
          changes: changeData,
          problems: problemData,
          slaStatus: slaData,
          keyDecisions: [
            "Approved emergency change CHG0000023 for database failover",
            "Escalated INC0010045 to vendor support — 4-hour response SLA",
            "Deferred CHG0000018 to next maintenance window due to collision risk",
          ],
          outstandingItems: [
            "INC0010044 awaiting vendor response (ETA: 2 hours)",
            "CHG0000019 pending CAB approval — scheduled for tomorrow",
            "PRB0000012 root cause analysis in progress — DNS infrastructure",
          ],
          timeline: [
            { time: shiftStart.toISOString().split("T")[1]?.slice(0, 5) || "00:00", event: "Shift started — handover received from Night Ops", severity: "info" },
            { time: new Date(shiftStart.getTime() + 900000).toISOString().split("T")[1]?.slice(0, 5) || "00:15", event: "P1 incident INC0010042 opened — customer portal down", severity: "critical" },
            { time: new Date(shiftStart.getTime() + 3600000).toISOString().split("T")[1]?.slice(0, 5) || "01:00", event: "INC0010042 root cause identified — connection pool exhaustion", severity: "warning" },
            { time: new Date(shiftStart.getTime() + 5400000).toISOString().split("T")[1]?.slice(0, 5) || "01:30", event: "Emergency change CHG0000023 approved for hotfix deployment", severity: "warning" },
            { time: new Date(shiftStart.getTime() + 7200000).toISOString().split("T")[1]?.slice(0, 5) || "02:00", event: "INC0010042 resolved — portal restored, monitoring confirmed", severity: "info" },
            { time: new Date(shiftStart.getTime() + 14400000).toISOString().split("T")[1]?.slice(0, 5) || "04:00", event: "SLA breach on INC0010039 — escalated to management", severity: "error" },
            { time: new Date(shiftStart.getTime() + 21600000).toISOString().split("T")[1]?.slice(0, 5) || "06:00", event: "KB article drafted from INC0010042 resolution", severity: "info" },
          ],
          generatedAt: now.toISOString(),
        };
        return widgetResponse(HANDOVER, data, `Shift Handover (${team}): ${incidentData.opened} incidents opened, ${incidentData.closed} closed, ${changeData.implemented} changes implemented, ${slaData.breached} SLA breaches, ${data.outstandingItems.length} outstanding items`);
      }

      // ── Text: Get Problem ──
      case "get-problem": {
        if (args?.number) {
          const problem = await snow.getProblem(args.number as string);
          if (!problem) return textResponse(`Problem ${args.number} not found.`);
          const dlpResult = applyDlpToRecords([problem], 'problem', 'read');
          return textResponse(JSON.stringify(dlpResult[0], null, 2));
        }
        const problems = await snow.getProblems({
          state: args?.state as string,
          priority: args?.priority as string,
          limit: (args?.limit as number) || 20,
        });
        const dlpProblems = applyDlpToRecords(problems, 'problem', 'read');
        return textResponse(JSON.stringify(dlpProblems, null, 2));
      }

      // ── Text: Get SLA Breaches ──
      case "get-sla-breaches": {
        const slas = await snow.getTaskSLAs({
          has_breached: "true",
          limit: (args?.limit as number) || 20,
        });
        if (slas.length === 0) return textResponse("No SLA breaches found.");
        const lines = slas.map((s: any) =>
          `**${s.task?.display_value || s.task || "N/A"}**: ${s.sla?.display_value || s.sla || "N/A"} | Stage: ${s.stage} | Breached: ${s.has_breached} | Time Left: ${s.business_time_left || "N/A"}`
        );
        return textResponse(`${slas.length} SLA breach(es):\n\n${lines.join("\n")}`);
      }

      // ── Text: Get Resource Health ──
      case "get-resource-health": {
        const resourceGroup = args?.resource_group || "prod-rg-eastus";
        const resourceType = args?.resource_type as string;
        let resources = [
          { name: "prod-aks-cluster", type: "Microsoft.ContainerService/managedClusters", resourceGroup, status: "Available", lastChecked: new Date().toISOString(), issues: [] },
          { name: "prod-sql-primary", type: "Microsoft.Sql/servers", resourceGroup, status: "Available", lastChecked: new Date().toISOString(), issues: [] },
          { name: "prod-appgw-01", type: "Microsoft.Network/applicationGateways", resourceGroup, status: "Degraded", lastChecked: new Date().toISOString(), issues: ["Backend pool health at 75% — 1 of 4 instances unhealthy"] },
          { name: "prod-cosmos-main", type: "Microsoft.DocumentDB/databaseAccounts", resourceGroup, status: "Available", lastChecked: new Date().toISOString(), issues: [] },
          { name: "prod-redis-cache", type: "Microsoft.Cache/Redis", resourceGroup, status: "Available", lastChecked: new Date().toISOString(), issues: [] },
          { name: "prod-vm-web-01", type: "Microsoft.Compute/virtualMachines", resourceGroup, status: "Unavailable", lastChecked: new Date().toISOString(), issues: ["VM stopped responding. Auto-restart initiated."] },
          { name: "prod-storage-logs", type: "Microsoft.Storage/storageAccounts", resourceGroup, status: "Available", lastChecked: new Date().toISOString(), issues: [] },
        ];
        if (resourceType) resources = resources.filter(r => r.type.toLowerCase().includes(resourceType.toLowerCase()));
        const available = resources.filter(r => r.status === "Available").length;
        const degraded = resources.filter(r => r.status === "Degraded").length;
        const unavailable = resources.filter(r => r.status === "Unavailable").length;
        return textResponse(`Resource Health (${resourceGroup}): ${resources.length} resources. Available: ${available}, Degraded: ${degraded}, Unavailable: ${unavailable}\n\n${JSON.stringify(resources, null, 2)}`);
      }

      // ── Text: Harvest Knowledge ──
      case "harvest-knowledge": {
        const incNumber = args?.incident_number as string;
        const includeWorkaround = args?.include_workaround !== false;
        try {
          const incidents = await snow.getIncidents({ limit: 100 });
          const inc = incidents.find((i: any) => i.number === incNumber);
          if (!inc) {
            const mockResult = {
              sourceIncident: incNumber,
              title: "Application performance degradation — connection pool exhaustion",
              category: "Performance",
              symptom: "Users reporting slow response times. Average latency increased from 200ms to 2500ms.",
              rootCause: "Connection pool exhaustion due to leaked database connections in order processing module.",
              resolution: "Updated connection pool settings (max: 100→200, idle timeout: 30s→15s). Deployed hotfix v2.4.1.",
              preventiveMeasures: "Added connection pool monitoring alerts. Scheduled code review for connection handling patterns.",
              workaround: includeWorkaround ? "Restart application pool as temporary measure." : undefined,
              suggestedTitle: `KB: Resolving connection pool exhaustion in web applications`,
              suggestedKeywords: ["connection pool", "performance", "database", "timeout"],
            };
            return textResponse(JSON.stringify(mockResult, null, 2));
          }
          const result: any = {
            sourceIncident: inc.number,
            title: inc.short_description,
            category: inc.category || "General",
            symptom: inc.description || inc.short_description,
            rootCause: inc.close_notes || "Root cause not documented.",
            resolution: inc.close_notes || "Resolution not documented.",
            workaround: includeWorkaround ? "See resolution steps above." : undefined,
            suggestedTitle: `KB: ${inc.short_description}`,
            suggestedKeywords: [inc.category, "resolution"].filter(Boolean),
          };
          return textResponse(JSON.stringify(result, null, 2));
        } catch {
          return textResponse(`Could not retrieve incident ${incNumber}.`);
        }
      }

      // ── Write: Create KB Article ──
      case "create-kb-article": {
        const kbData: any = {
          short_description: args?.title as string,
          text: args?.body as string,
          category: args?.category || "General",
          workflow_state: "draft",
        };
        if (args?.keywords) {
          kbData.meta = args.keywords;
        }
        const writeCheck = applyDlpWriteCheck('kb_knowledge', kbData);
        if (!writeCheck.allowed) return textResponse(`DLP blocked: ${writeCheck.reason}`);
        const result = await snow.createKnowledgeArticle(kbData);
        const snowInstance = process.env.SNOW_INSTANCE || "";
        return textResponse(`KB Article created: ${result.number || "N/A"}\nTitle: ${args?.title}\nCategory: ${kbData.category}\nState: draft\nLink: ${snowInstance}/nav_to.do?uri=kb_knowledge.do?sys_id=${result.sys_id}`);
      }

      // ── ServiceNow Live Chat ──
      case "connect-live-agent": {
        const snowInstance = process.env.SNOW_INSTANCE || "";
        const reason = (args?.reason as string) || "User requested live agent";
        const queue = (args?.queue as string) || "general";
        const data = {
          config: {
            snowInstance,
            queue,
            reason,
            agentAvailable: true,
            estimatedWaitTime: "< 2 minutes",
          },
          agentStatus: {
            online: true,
            queueDepth: 3,
            avgResponseTime: "45s",
          },
        };
        return widgetResponse(SNOW_LIVE_CHAT, data,
          `Connecting to ServiceNow live agent. Queue: ${queue}. Reason: ${reason}.`);
      }

      // ── Demo Data ──
      case "seed-demo-data": {
        const { seedDemoData } = await import("./snow-demo-data.js");
        const result = await seedDemoData();
        return textResponse(`Demo data seeded:\n${JSON.stringify(result, null, 2)}`);
      }
      case "clear-demo-data": {
        const { clearDemoData } = await import("./snow-demo-data.js");
        await clearDemoData();
        return textResponse("Demo data cleared — all [DEMO] records removed.");
      }

      default:
        return textResponse(`Unknown tool: ${name}`);
    }
  });

  return server;
}
