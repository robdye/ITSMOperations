# Staleness Remediation Guide

## When an Agent Hasn't Been Updated

Stale agents pose several risks:
- Unpatched vulnerabilities in underlying plugins or API connections
- References to deprecated API endpoints
- Outdated instructions that may produce incorrect or harmful outputs
- Orphaned resources consuming tenant capacity

### Remediation by Staleness Tier

#### 90–180 Days (Warning)

1. Contact the agent owner via email
2. Request a review and update within 30 days
3. Owner must confirm one of:
   - Agent updated with current review date
   - Agent scheduled for decommission
   - Exemption requested with justification

#### 180–365 Days (Non-Compliant)

1. Escalate to IT Governance board
2. Agent owner has 14 days to respond
3. If no response:
   - Lock the agent (restrict scope to owner only)
   - Notify the owner's manager
4. If owner has left the organization, trigger the Agent Ownership Transfer skill

#### 365+ Days (Critical — Recommend Block)

1. Block the agent via:
   ```
   POST /beta/copilot/admin/catalog/packages/{id}/block
   ```
2. Notify the last known owner and their manager
3. Create an incident to track remediation
4. If the agent is still needed, require a fresh deployment under change control
5. Delete the blocked package after 90 days if no owner claims it

### Freshness Verification

When an owner "updates" a stale agent, verify:
1. The manifest version has actually changed
2. The agent description reflects current capabilities
3. Any API plugins are still functional
4. The sensitivity classification is still accurate
