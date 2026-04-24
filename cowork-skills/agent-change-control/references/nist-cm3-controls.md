# NIST SP 800-53 CM-3 — Configuration Change Control

## CM-3 Requirements Applied to Agent Lifecycle

### CM-3(a) — Determine Types of Changes
Classify agent lifecycle events (deploy, update, block, unblock, scope change,
reassign) and determine the appropriate level of review and approval.

### CM-3(b) — Review Proposed Changes
Review each proposed agent change for security impact, including:
- Data access scope of the agent's actions/plugins
- User population affected by scope changes
- Compliance implications of agent capabilities

### CM-3(c) — Security Impact Analysis
For High and Critical risk changes, conduct a formal security impact analysis:
- What data can the agent access via its plugins/actions?
- What actions can the agent take on behalf of users?
- Does the agent interact with external systems?
- What is the blast radius if the agent is compromised?

### CM-3(d) — Document Change Decisions
All agent change decisions must be documented with:
- Change ID (ServiceNow CR number)
- Decision (approved/rejected/deferred)
- Rationale
- Conditions or restrictions

### CM-3(e) — Retain Records
Retain all agent change records for the duration specified by the
organization's records retention policy (minimum 3 years for financial services).

### CM-3(f) — Audit Activities
Maintain an auditable log of all agent configuration changes including:
- Package creation and deletion
- Metadata updates (PATCH operations)
- Block and unblock actions
- Ownership reassignments
- Scope changes
