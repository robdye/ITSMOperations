# Live ServiceNow Connectivity and Source Truth Audit

Date: 2026-06-10

## Executive finding

The live ITSMOperations deployment is reachable and healthy, but the operational ServiceNow data path is not yet proven end-to-end.

Verified live:
- Worker `/api/health` returns healthy.
- Mission Control loads.
- MCP server `/health` returns ok.
- Worker registry and governance endpoints return data.

Not yet proven:
- Authenticated incident reads.
- Authenticated change reads.
- Authenticated CMDB reads.
- Authenticated briefing / agent mind state.
- Worker-to-MCP-to-ServiceNow source truth.
- Absence of silent synthetic or CRM fallback.

Observed issue:
- Protected worker endpoints return `401 authorization header not found` from Mission Control/browser fetch context.

## Working hypothesis

The ServiceNow MCP server may be live, but Mission Control and/or the digital worker is not correctly passing authenticated context to protected worker APIs and live ServiceNow tool calls. The UI can look operational while real ITSM data access is unproven.

## Required source-of-truth model

| Data | Source of truth | Allowed fallback |
| --- | --- | --- |
| Incidents | ServiceNow | Synthetic ServiceNow-labelled demo data only |
| Changes | ServiceNow | Synthetic ServiceNow-labelled demo data only |
| Problems | ServiceNow | Synthetic ServiceNow-labelled demo data only |
| CMDB / CIs | ServiceNow | Synthetic ServiceNow-labelled demo data only |
| SLAs | ServiceNow | Synthetic ServiceNow-labelled demo data only |
| Customer/account enrichment | CRM/MSX | Enrichment only, never incident source |
| Demo scenarios | Scenario store | Must be visibly labelled as scenario/synthetic |

## Required source labels

Every operational response/card/tool result must display one of:

- Live ServiceNow
- Synthetic ServiceNow
- Scenario-injected
- Cached
- Auth failed
- MCP unavailable
- CRM enrichment only

## Verification checklist

| Test | Required result | Status |
| --- | --- | --- |
| Worker health | 200 healthy with build SHA | Partial, build reports `dev` |
| Mission Control loads | UI loads | Pass |
| Mission Control protected state | Authenticated 200 | Fail, 401 observed |
| Incident read | Live ServiceNow incident response | Not proven |
| Change read | Live ServiceNow change response | Not proven |
| CMDB read | Live ServiceNow CI response | Not proven |
| MCP health | 200 ok | Pass |
| MCP ServiceNow read | Real ServiceNow data | Not proven |
| Synthetic fallback | Visible source label | Not proven |
| CRM incident source | Must not exist | Not proven |
| Writes/sends/escalations | Explicit approval required | Needs test |

## Remediation priorities

1. Add `/api/source-status` returning auth state, MCP state, ServiceNow state and source mode.
2. Fix Mission Control auth so protected API calls include the required bearer/OBO token or clearly show unauthenticated state.
3. Add server-side live ServiceNow read diagnostics for incidents, changes, CMDB and SLAs.
4. Add source labels to every operational card and tool result.
5. Add tests proving no silent fallback to CRM/synthetic incident data.
6. Add API handling standard for scoped calls, paging, retries, timeouts and token-efficient payloads.
