# M365 MCP Server Wiring Plan

## Status: BLOCKED — SDK URL Generation Bug

The M365 MCP servers are registered in `ToolingManifest.json` but cannot be wired to workers due to an SDK bug in `client.ts` (approximately lines 108–113) where the MCP client generates invalid URLs when constructing server endpoints. Until this is fixed in the `@copilot-extensions/preview-sdk` or equivalent, these servers remain registered but unused.

## Current Blocker

**File:** `digital-worker/src/client.ts` (~line 108–113)  
**Issue:** The SDK's MCP client URL construction produces malformed endpoint URLs when resolving MCP server addresses from the ToolingManifest. This causes connection failures to all M365 MCP servers.  
**Tracking:** Monitor SDK releases for URL generation fixes. Once patched, follow the wiring steps below.

## MCP Server → Worker Mapping

### Universal (All Workers)
| MCP Server | Capability | Use Case |
|---|---|---|
| `mcp_MailTools` | Email send/read/search | Notification emails, escalation emails, report distribution |
| `mcp_TeamsServer` | Teams channel posting | Status updates, alerts, collaboration messages |
| `mcp_PlannerTools` | Planner task management | Action item tracking, task assignment, follow-up tracking |
| `mcp_SharePointRemoteServer` | SharePoint document library | Policy documents, shared templates, published reports |
| `mcp_OneDriveRemoteServer` | OneDrive file storage | Working documents, draft reports, temporary file storage |

### Change Manager
| MCP Server | Capability | Use Case |
|---|---|---|
| `mcp_CalendarTools` | Calendar management | CAB meeting scheduling, change window booking, freeze calendar |
| `mcp_WordServer` | Word document generation | Risk assessment memos, change proposals, CAB briefing docs |

### Service Desk Manager
| MCP Server | Capability | Use Case |
|---|---|---|
| `mcp_CalendarTools` | Calendar management | Customer meeting booking, escalation meeting scheduling |

### Incident Manager
| MCP Server | Capability | Use Case |
|---|---|---|
| `mcp_WordServer` | Word document generation | Post-Incident Review (PIR) reports, major incident summaries |

### Knowledge Manager
| MCP Server | Capability | Use Case |
|---|---|---|
| `mcp_WordServer` | Word document generation | Runbook authoring, knowledge article formatting |
| `mcp_SharePointRemoteServer` | SharePoint document library | Knowledge base document library, published runbooks |
| `mcp_KnowledgeTools` | M365 Knowledge operations | KB article CRUD, search, topic management |

### SLA Manager
| MCP Server | Capability | Use Case |
|---|---|---|
| `mcp_ExcelServer` | Excel workbook operations | SLA compliance workbooks, performance trend spreadsheets |

### Vendor Manager
| MCP Server | Capability | Use Case |
|---|---|---|
| `mcp_ExcelServer` | Excel workbook operations | License audit workbooks, contract tracking spreadsheets |

### Asset & CMDB Manager
| MCP Server | Capability | Use Case |
|---|---|---|
| `mcp_ExcelServer` | Excel workbook operations | Inventory export workbooks, asset reconciliation reports |

## Steps to Wire When SDK Bug Is Fixed

1. **Verify SDK fix:** Update `@copilot-extensions/preview-sdk` (or equivalent) and confirm MCP client URL generation produces valid endpoints.

2. **Update `client.ts`:** In the MCP client initialization section (~line 108–113), ensure the corrected SDK is used. Test connectivity to at least one MCP server (e.g., `mcp_MailTools`).

3. **Wire universal servers first:** Add `mcp_MailTools`, `mcp_TeamsServer`, `mcp_PlannerTools`, `mcp_SharePointRemoteServer`, and `mcp_OneDriveRemoteServer` to the base worker tool set in `worker-definitions.ts` or `agent-tools.ts`.

4. **Wire worker-specific servers:** For each worker, add the relevant MCP server tools to that worker's tool configuration:
   - Change Manager: `mcp_CalendarTools`, `mcp_WordServer`
   - Service Desk: `mcp_CalendarTools`
   - Incident Manager: `mcp_WordServer`
   - Knowledge Manager: `mcp_WordServer`, `mcp_SharePointRemoteServer`, `mcp_KnowledgeTools`
   - SLA Manager: `mcp_ExcelServer`
   - Vendor Manager: `mcp_ExcelServer`
   - Asset Manager: `mcp_ExcelServer`

5. **Test each integration:** Use the agent harness to validate that each worker can successfully call its assigned MCP servers.

6. **Update ToolingManifest.json:** If new MCP servers are added (e.g., `mcp_PowerPointServer`), register them following the existing pattern.
