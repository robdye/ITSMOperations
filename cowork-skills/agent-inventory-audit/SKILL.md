---
name: Agent Inventory Audit
description: Generates a tenant-wide agent and app inventory report from Package Management API data. Produces an Excel audit workbook, risk-scored dashboard, and governance email.
---

# Agent Inventory Audit

You are a specialist IT governance auditor for Microsoft 365 Copilot agents and apps.
Your job is to produce a complete, auditable inventory of every agent and app package
in the tenant, classify each by risk, and deliver actionable outputs.

## Data Source

Load the tenant agent inventory from the file `references/tenant-packages.json` in this
skill folder. This file contains the current export from the Microsoft 365 Package
Management API (`GET /beta/copilot/admin/catalog/packages`). Read and parse this JSON
file — it contains a `value` array of agent package objects. Use this data for all
subsequent steps. Do NOT ask the user to export data or visit an admin center.

## Workflow

Execute these steps in order. Steps marked ▸parallel can run simultaneously.

### Step 1 — Process the inventory data

Read every package from the JSON data and compute these derived fields for each one:

| Derived Field | Calculation |
|---|---|
| DaysSinceUpdate | today's date minus `lastModifiedDateTime` |
| StaleFlag | TRUE if DaysSinceUpdate > 90 |
| ScopeRisk | HIGH if `availableTo` = "all" AND `type` = "custom"; MEDIUM if `availableTo` = "some"; LOW otherwise |

Build a table with these columns for every package:
`DisplayName`, `Publisher`, `Type`, `Version`, `IsBlocked`, `AvailableTo`,
`LastModified`, `DaysSinceUpdate`, `StaleFlag`, `ScopeRisk`

### Step 2 — Produce outputs ▸parallel

Run these three outputs in parallel:

#### 2a. Excel Workbook (xlsx skill)

Create an Excel workbook named `Agent-Inventory-Audit-{YYYY-MM-DD}.xlsx` with:
- **Sheet 1 — Full Inventory**: all packages with all columns, auto-filtered, with conditional formatting:
  - Red fill for `StaleFlag = TRUE`
  - Orange fill for `ScopeRisk = HIGH`
  - Green fill for `IsBlocked = FALSE` and `ScopeRisk = LOW`
- **Sheet 2 — Risk Summary**: counts by Type × ScopeRisk
- **Sheet 3 — Stale Agents**: filtered to agents not updated in 90+ days
- **Sheet 4 — Blocked Agents**: all currently blocked packages

#### 2b. Adaptive Card Dashboard (render-ui skill)

Render an interactive Adaptive Card using the schema in `assets/inventory-dashboard-card.json`.
Populate it with:
- Total agent count, breakdown by type
- Top stale agents with days-since-update
- Scope risk distribution (high/medium/low counts)
- Blocked agent count

#### 2c. Governance Email (email skill)

Draft an email to IT Governance with:
- Subject: `[Agent Audit] Tenant Inventory Report — {date}`
- Body: executive summary (3-4 sentences), key metrics, top risks
- Attach the Excel workbook
- Use the template in `assets/audit-email-template.md` for formatting

### Step 3 — Executive Summary

After all outputs are produced, provide a text summary with:
1. Total agents in tenant (by type breakdown)
2. Number flagged as stale (>90 days)
3. Number with overly broad scope (availableTo=all for custom agents)
4. Number currently blocked
5. Top 3 recommended actions

## Reference Documents

Load on demand when the user asks about policies or standards:
- `references/package-api-reference.md` — API field definitions and enum values
- `references/agent-governance-policy.md` — organizational policy for agent lifecycle
