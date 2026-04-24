// ITSM Operations — Tool Registry
// Maps tools to ITIL 4 practice domains and provides worker-scoped tool sets.
// Each worker gets: its domain tools + shared capability packs (comms, m365, briefing).

import { incidentTools } from './incident-tools';
import { changeTools } from './change-tools';
import { problemTools } from './problem-tools';
import { assetCmdbTools } from './asset-cmdb-tools';
import { slaTools } from './sla-tools';
import { knowledgeTools } from './knowledge-tools';
import { commsTools } from './comms-tools';
import { m365Tools } from './m365-tools';
import { briefingTools } from './briefing-tools';
import { serviceDeskTools } from './service-desk-tools';
import { monitoringTools } from './monitoring-tools';
import { releaseTools } from './release-tools';

// ── Domain tool sets (practice-specific) ──
export {
  incidentTools,
  changeTools,
  problemTools,
  assetCmdbTools,
  slaTools,
  knowledgeTools,
  commsTools,
  m365Tools,
  briefingTools,
  serviceDeskTools,
  monitoringTools,
  releaseTools,
};

// ── Shared capability packs (available to all workers) ──
export const sharedReadTools = [
  ...knowledgeTools,  // Any worker may need to search KB
  ...m365Tools,       // Any worker may need M365 intelligence
  ...briefingTools,   // Any worker may need the aggregate briefing
];

export const sharedWriteTools = [
  ...commsTools,      // Email and Teams — gated by confirmation
];

// ── Cross-domain tools (used by multiple practices) ──
// These are included in their primary domain AND shared where needed
export const infrastructureContextTools = [
  ...assetCmdbTools,  // CI lookup is useful across incident/change/problem
];

// ── Worker tool sets ──
// Each returns: domain tools + relevant shared packs + cross-domain tools

export function getIncidentManagerTools() {
  return [
    ...incidentTools,
    ...assetCmdbTools,   // CI context for incidents
    ...slaTools,         // SLA impact
    ...sharedReadTools,
    ...sharedWriteTools,
  ];
}

export function getChangeManagerTools() {
  return [
    ...changeTools,
    ...assetCmdbTools,   // CI context for blast radius
    ...sharedReadTools,
    ...sharedWriteTools,
  ];
}

export function getProblemManagerTools() {
  return [
    ...problemTools,
    ...incidentTools,    // Link incidents to problems
    ...assetCmdbTools,   // CI context
    ...sharedReadTools,
    ...sharedWriteTools,
  ];
}

export function getAssetCmdbManagerTools() {
  return [
    ...assetCmdbTools,
    ...sharedReadTools,
    ...sharedWriteTools,
  ];
}

export function getSlaManagerTools() {
  return [
    ...slaTools,
    ...incidentTools,    // Incident context for SLA analysis
    ...sharedReadTools,
    ...sharedWriteTools,
  ];
}

export function getKnowledgeManagerTools() {
  return [
    ...knowledgeTools,
    ...incidentTools,    // Incident data for KB gap analysis
    ...m365Tools,        // Document search
    ...sharedWriteTools,
  ];
}

export function getVendorManagerTools() {
  // Vendor tools will come from the MCP plugin; for now share read tools
  return [
    ...assetCmdbTools,   // Asset context
    ...sharedReadTools,
    ...sharedWriteTools,
  ];
}

// ── Tier 2 Worker tool sets ──

export function getServiceDeskManagerTools() {
  return [
    ...serviceDeskTools,
    ...incidentTools,     // Create incidents from service desk
    ...knowledgeTools,    // KB search for first-contact resolution
    ...sharedWriteTools,
  ];
}

export function getMonitoringManagerTools() {
  return [
    ...monitoringTools,
    ...incidentTools,     // Auto-create incidents from exceptions
    ...assetCmdbTools,    // CI context for events
    ...sharedReadTools,
    ...sharedWriteTools,
  ];
}

export function getReleaseManagerTools() {
  return [
    ...releaseTools,
    ...changeTools,       // Change lifecycle management
    ...assetCmdbTools,    // CI context for releases
    ...sharedReadTools,
    ...sharedWriteTools,
  ];
}

// ── Tier 3 Worker tool sets ──

export function getCapacityManagerTools() {
  return [
    ...assetCmdbTools,    // Infrastructure inventory
    ...monitoringTools,   // Performance monitoring
    ...sharedReadTools,
    ...sharedWriteTools,
  ];
}

export function getContinuityManagerTools() {
  return [
    ...assetCmdbTools,    // Critical asset inventory
    ...incidentTools,     // Major incident context for DR
    ...sharedReadTools,
    ...sharedWriteTools,
  ];
}

export function getSecurityManagerTools() {
  return [
    ...changeTools,       // Security change assessment
    ...assetCmdbTools,    // Asset vulnerability context
    ...incidentTools,     // Security incident response
    ...sharedReadTools,
    ...sharedWriteTools,
  ];
}

// ── Orchestrator (Command Center) gets everything ──
export function getOrchestratorTools() {
  return [
    ...briefingTools,
    ...incidentTools,
    ...changeTools,
    ...problemTools,
    ...assetCmdbTools,
    ...slaTools,
    ...knowledgeTools,
    ...commsTools,
    ...m365Tools,
    ...serviceDeskTools,
    ...monitoringTools,
    ...releaseTools,
  ];
}

// ── All tools (backward compatibility with monolithic agent) ──
export const allTools = getOrchestratorTools();
