# Merged Into: asset-cmdb-manager

## Merge Date
2025-07-16

## Target Worker
`cowork-skills/asset-cmdb-manager/` — ITIL 4 IT Asset Management & Service Configuration Management

## Why
The agent-compliance-dashboard skill covered compliance scoring, regulatory audit workflows, and remediation guidance for Copilot agent packages. These capabilities align with the Asset & CMDB Manager's responsibility for audit support, compliance reporting, and configuration baseline management under ITIL 4.

## What Was Merged
- **Assets copied to `asset-cmdb-manager/assets/`:**
  - `compliance-dashboard-card.json` — Adaptive Card template for compliance dashboard
  - `remediation-email-template.md` — Email template for compliance remediation notifications
- **References copied to `asset-cmdb-manager/references/`:**
  - `approved-registry.json` — Approved agent/package registry
  - `compliance-rules.md` — Compliance scoring rules
  - `scope-remediation-guide.md` — Scope remediation guidance
  - `staleness-remediation-guide.md` — Stale CI remediation guidance
  - `tenant-packages.json` — Tenant package data reference

## Backward Compatibility
This directory is preserved as-is. The original SKILL.md, assets, references, and scripts remain intact for any existing references or automation that depends on this path.
