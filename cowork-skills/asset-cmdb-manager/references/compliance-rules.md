# Agent Compliance Rules — Full Definitions

**Policy:** AGP-001 Agent Governance Policy  
**NIST Alignment:** CM-2 (Baseline), CM-8 (Component Inventory), CM-9 (Config Management Plan)

## Rule Definitions

### R1 — Sensitivity Classification (15 points)

Every agent package MUST have a `sensitivity` classification that indicates data
handling requirements. This aligns with NIST CM-2 baseline configuration.

**Pass criteria:** `sensitivity` field is non-empty  
**Fail:** Missing classification  
**Remediation:** Admin must set sensitivity via PATCH /copilot/admin/catalog/packages/{id}

### R2 — Scope Appropriateness (20 points)

Custom (LOB) agents MUST be scoped to named groups only. Organization-wide
deployment of custom agents requires CISO approval with documented justification.

**Pass:** `availableTo` = "none" or properly scoped groups  
**Warn:** `availableTo` = "some" (10 points — verify groups are appropriate)  
**Fail:** `availableTo` = "all" for custom agents  
**Exemption:** Documented CISO approval stored in compliance registry

### R3 — Staleness (15 points)

Agents must be actively maintained. Stale agents pose security and operational risk
as they may reference deprecated APIs or contain unpatched vulnerabilities.

**Pass:** Updated within 90 days  
**Warn:** 90–180 days since update (10 points)  
**Fail:** 180+ days without update  
**Remediation:** Owner must review and update, or decommission

### R4 — CMDB Registration (15 points)

Per NIST CM-8, every organizational IT component must be inventoried. Agents are
IT assets and MUST be registered in the CMDB.

**Pass:** Agent's `appId` matches a CI in ServiceNow CMDB  
**Fail:** No matching CI found  
**Skip:** CMDB data not available (not counted against score)

### R5 — Owner Assignment (15 points)

Every agent must have an identifiable owner who is responsible for its lifecycle,
security posture, and compliance.

**Pass:** `acquireUsersAndGroups` contains assigned owner  
**Warn:** Only `publisher` set, no explicit owner (10 points)  
**Fail:** No ownership information  

### R6 — Description Quality (10 points)

Clear descriptions enable governance review and user understanding.

**Pass:** Both `shortDescription` and `longDescription` populated  
**Warn:** Only short description (5 points)  
**Fail:** No description

### R7 — Version Hygiene (10 points)

Proper versioning enables change tracking and rollback capability.

**Pass:** `version` follows semantic versioning (x.y.z)  
**Warn:** Version present but non-standard format (5 points)  
**Fail:** No version specified
