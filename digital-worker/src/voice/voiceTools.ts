// ITSM Operations Digital Worker — Voice tools for Voice Live session

import { ItsmMcpClient } from '../mcp-client';

const mcp = new ItsmMcpClient();

export const VOICE_TOOLS = [
  // Incident Management
  { type: 'function', name: 'get_incident_dashboard', description: 'Get the incident dashboard showing all active incidents by priority.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'get_incidents', description: 'Query incidents. Returns incident data.', parameters: { type: 'object', properties: { priority: { type: 'string', description: 'Filter by priority: 1, 2, 3, 4, 5' } }, additionalProperties: false } },
  { type: 'function', name: 'get_incidents_for_ci', description: 'Check active incidents on a Configuration Item.', parameters: { type: 'object', properties: { ci_name: { type: 'string' } }, required: ['ci_name'], additionalProperties: false } },
  // Problem Management
  { type: 'function', name: 'get_problem_dashboard', description: 'Get the problem dashboard with open problems and known errors.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  // Change Management
  { type: 'function', name: 'get_change_dashboard', description: 'Get all open change requests with risk scores.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'get_change_request', description: 'Get details for a specific change request.', parameters: { type: 'object', properties: { number: { type: 'string' } }, required: ['number'], additionalProperties: false } },
  { type: 'function', name: 'get_blast_radius', description: 'Get the blast radius and dependency graph for a Configuration Item.', parameters: { type: 'object', properties: { ci_name: { type: 'string' } }, required: ['ci_name'], additionalProperties: false } },
  { type: 'function', name: 'get_change_metrics', description: 'Get change management KPIs: success rate, pipeline breakdown.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'detect_collisions', description: 'Detect change collisions. Multiple changes on the same CI.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'generate_cab_agenda', description: 'Generate a CAB meeting agenda with all pending changes.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'post_implementation_review', description: 'Run a post-implementation review for a completed change.', parameters: { type: 'object', properties: { number: { type: 'string' } }, required: ['number'], additionalProperties: false } },
  // SLA
  { type: 'function', name: 'get_sla_dashboard', description: 'Get SLA compliance dashboard with breaches and at-risk SLAs.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  // Knowledge
  { type: 'function', name: 'search_knowledge', description: 'Search the knowledge base for articles and runbooks.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
  // CMDB
  { type: 'function', name: 'get_cmdb_ci', description: 'Look up a Configuration Item in the CMDB.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false } },
  // EOL
  { type: 'function', name: 'check_eol_status', description: 'Check end-of-life status for a product version.', parameters: { type: 'object', properties: { product: { type: 'string' }, version: { type: 'string' } }, required: ['product', 'version'], additionalProperties: false } },
  // ITSM Briefing
  { type: 'function', name: 'get_itsm_briefing', description: 'Get the holistic ITSM operations briefing across all practices.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  // Asset
  { type: 'function', name: 'get_asset_lifecycle', description: 'Get the asset lifecycle compliance dashboard.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'get_expired_warranties', description: 'Get assets with expired warranties.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
];

/** Execute a voice tool call and return a voice-friendly text summary */
export async function executeVoiceTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    let result: unknown;
    switch (name) {
      case 'get_incident_dashboard': result = await mcp.getIncidentDashboard(); break;
      case 'get_incidents': result = await mcp.getIncidents(args); break;
      case 'get_incidents_for_ci': result = await mcp.getIncidentsForCi(args.ci_name as string); break;
      case 'get_problem_dashboard': result = await mcp.getProblems(); break;
      case 'get_change_dashboard': result = await mcp.getChangeDashboard(); break;
      case 'get_change_request': result = await mcp.getChangeRequest(args.number as string); break;
      case 'get_blast_radius': result = await mcp.getBlastRadius(args.ci_name as string); break;
      case 'get_change_metrics': result = await mcp.getChangeMetrics(); break;
      case 'detect_collisions': result = await mcp.detectCollisions(); break;
      case 'generate_cab_agenda': result = await mcp.generateCabAgenda(); break;
      case 'post_implementation_review': result = await mcp.postImplementationReview(args.number as string); break;
      case 'get_sla_dashboard': result = await mcp.getSlaDashboard(); break;
      case 'search_knowledge': result = await mcp.searchKnowledge(args.query as string); break;
      case 'get_cmdb_ci': result = await mcp.getCmdbCi(args.name as string); break;
      case 'check_eol_status': result = await mcp.checkEolStatus(args.product as string, args.version as string); break;
      case 'get_itsm_briefing': result = await mcp.getItsmBriefing(); break;
      case 'get_asset_lifecycle': result = await mcp.getAssetLifecycle(); break;
      case 'get_expired_warranties': result = await mcp.getExpiredWarranties(); break;
      default: return `Unknown tool: ${name}`;
    }
    // Extract voice-friendly text from result
    if (typeof result === 'string') return result.substring(0, 2000);
    return JSON.stringify(result).substring(0, 2000);
  } catch (err) {
    return `Error calling ${name}: ${(err as Error).message}`;
  }
}
