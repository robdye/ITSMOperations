# Merged Into: asset-cmdb-manager

## Merge Date
2025-07-16

## Target Worker
`cowork-skills/asset-cmdb-manager/` — ITIL 4 IT Asset Management & Service Configuration Management

## Why
The agent-ownership-transfer skill covered CI ownership handover workflows, manager approval chains, and reassignment automation when employees leave. These capabilities align with the Asset & CMDB Manager's responsibility for CI lifecycle management, ownership tracking, and governance under ITIL 4.

## What Was Merged
- **Assets copied to `asset-cmdb-manager/assets/`:**
  - `handover-template.md` — Ownership handover document template
  - `manager-approval-email.md` — Manager approval email template
  - `transfer-dashboard-card.json` — Adaptive Card template for transfer dashboard
- **References copied to `asset-cmdb-manager/references/`:**
  - `offboarding-checklist.md` — Employee offboarding checklist for asset transfer
  - `ownership-criteria.md` — CI ownership criteria and assignment rules
  - `tenant-packages.json` — Tenant package data reference

## Backward Compatibility
This directory is preserved as-is. The original SKILL.md, assets, references, and scripts remain intact for any existing references or automation that depends on this path.
