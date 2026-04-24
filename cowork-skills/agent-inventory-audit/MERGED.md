# Merged Into: asset-cmdb-manager

## Merge Date
2025-07-16

## Target Worker
`cowork-skills/asset-cmdb-manager/` — ITIL 4 IT Asset Management & Service Configuration Management

## Why
The agent-inventory-audit skill covered tenant-wide agent and app inventory reporting, Excel audit workbook generation, and risk-scored dashboard creation. These capabilities align with the Asset & CMDB Manager's responsibility for discovery, reconciliation, asset tracking, and audit support under ITIL 4.

## What Was Merged
- **Assets copied to `asset-cmdb-manager/assets/`:**
  - `audit-email-template.md` — Email template for governance audit notifications
  - `inventory-dashboard-card.json` — Adaptive Card template for inventory dashboard
- **References copied to `asset-cmdb-manager/references/`:**
  - `agent-governance-policy.md` — Agent governance policy documentation
  - `package-api-reference.md` — Package Management API reference
  - `tenant-packages.json` — Tenant package data reference

## Backward Compatibility
This directory is preserved as-is. The original SKILL.md, assets, references, and scripts remain intact for any existing references or automation that depends on this path.
