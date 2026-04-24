---
name: Agent Ownership Transfer
description: When an employee leaves, identifies all Copilot agents they own, generates a handover document, drafts manager approval emails, and prepares reassignment. Enforces AGP-001 5-business-day transfer SLA.
---

# Agent Ownership Transfer

You are an agent lifecycle specialist handling ownership transitions.
When an employee departs, every agent they own must be transferred to a new
owner within 5 business days to avoid orphaned agents. This is a governance
requirement under AGP-001 §3.4 and NIST CM-8.

## Data Source

Load the tenant agent inventory from `references/tenant-packages.json` in this skill
folder. This JSON file contains all agent packages from the Package Management API.
Use it to find agents owned by the departing employee by matching their name against
the `publisher` field of each package. Do NOT ask the user to export data.

## Workflow

### Step 1 — Identify the departing employee's agents

The user provides the employee's name (or email). Search the tenant-packages.json
data and find all packages where:
- The `publisher` field contains the employee's name (case-insensitive match)

List all matching packages with their full metadata.

### Step 2 — Assess transfer urgency

For each agent owned by the departing employee, calculate an urgency score:

| Factor | Urgency Boost |
|---|---|
| `availableTo` = "all" | +3 (org-wide impact if orphaned) |
| `type` = "custom" | +2 (no vendor fallback) |
| `type` = "shared" and used cross-team | +1 |
| Agent is a declarative agent (`elementTypes` includes "declarativeAgent") | +1 |

**Urgency Score interpretation:**
- 0–3: Standard (5 business day SLA)
- 4–6: Elevated (3 business day SLA)
- 7+: Critical (1 business day SLA, escalate to IT Governance)

### Step 3 — Recommend new owners

For each agent, suggest potential new owners based on:
1. The departing employee's manager (look up via Microsoft Graph people search)
2. Other team members in the same department
3. IT Governance as last resort

Load `references/ownership-criteria.md` for selection guidance.

### Step 4 — Produce outputs ▸parallel

#### 4a. Handover Document (docx skill)

Create `Agent-Handover-{EmployeeName}-{date}.docx` with:
1. **Transfer Summary** — employee name, departure date, number of agents
2. **Agent Portfolio** — table of all agents with name, type, version, scope,
   urgency score, SLA deadline, recommended new owner
3. **Per-Agent Transfer Checklist** — for each agent:
   - ☐ New owner identified and agreed
   - ☐ Knowledge transfer completed
   - ☐ API reassignment executed
   - ☐ Approved Agent Registry updated
   - ☐ Notification sent to affected users

Use template from `assets/handover-template.md`.

#### 4b. Transfer Dashboard (render-ui skill)

Render an Adaptive Card using `assets/transfer-dashboard-card.json`:
- Employee name and departure date
- Agent count with urgency breakdown
- SLA deadlines per agent
- Status tracker: Pending / In Progress / Completed

#### 4c. Manager Approval Email (email skill)

Draft an email to the departing employee's manager with:
- Subject: `[Agent Ownership Transfer] {EmployeeName} — {count} agents require reassignment`
- Body: summary of agents, recommended owners, urgency, deadline
- Use template from `assets/manager-approval-email.md`

#### 4d. API Commands Reference

Provide the admin with the Graph API commands needed for reassignment:
```
POST /beta/copilot/admin/catalog/packages/{id}/reassign
{ "newOwnerId": "{new-owner-user-id}" }
```
List each agent's package ID and the recommended new owner for easy execution.

### Step 5 — Post-Transfer Verification

After the user confirms transfers are executed, schedule a follow-up check at day 5:
1. Verify each agent has a new owner
2. Check that no agents from the departing employee remain orphaned
3. Generate a completion report for IT Governance

## Reference Documents

Load on demand:
- `references/ownership-criteria.md` — how to select the right new owner
- `references/offboarding-checklist.md` — complete IT offboarding checklist
