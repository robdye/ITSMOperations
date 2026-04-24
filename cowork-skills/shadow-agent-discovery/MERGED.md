# Merged Into: asset-cmdb-manager

## Merge Date
2025-07-16

## Target Worker
`cowork-skills/asset-cmdb-manager/` — ITIL 4 IT Asset Management & Service Configuration Management

## Why
The shadow-agent-discovery skill covered detection of unauthorized or unregistered Copilot agents by comparing tenant inventory against an approved registry. These capabilities align with the Asset & CMDB Manager's responsibility for discovery, reconciliation, shadow IT identification, and compliance reporting under ITIL 4.

## What Was Merged
- **Assets copied to `asset-cmdb-manager/assets/`:**
  - `shadow-agent-card.json` — Adaptive Card template for shadow agent alerts
  - `shadow-report-template.md` — Shadow IT risk report template
- **References copied to `asset-cmdb-manager/references/`:**
  - `approved-registry.json` — Approved agent/package registry
  - `remediation-procedures.md` — Shadow IT remediation procedures
  - `shadow-it-policy.md` — Shadow IT policy documentation
  - `tenant-packages.json` — Tenant package data reference
  - `vendor-risk-assessment.md` — Vendor risk assessment criteria

## Backward Compatibility
This directory is preserved as-is. The original SKILL.md, assets, references, and scripts remain intact for any existing references or automation that depends on this path.
