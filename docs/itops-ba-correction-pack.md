# ITSMOperations BA Correction Pack

Date: 2026-06-10

## Problem statement

The IT Ops Manager digital worker currently presents a mature ITIL operations story, but live verification has not yet proven authenticated ServiceNow incident/change/CMDB reads. There is risk that demo scenarios or synthetic data are masking missing source-of-truth wiring.

## Required business outcome

Make the worker credible as an ITIL v4 operations manager by proving it can read live ServiceNow operational data, label source truth, and require human approval for operational writes.

## Non-negotiables

- ServiceNow is the operational source of truth.
- CRM/MSX is enrichment only.
- Synthetic/demo data must be clearly labelled.
- No silent fallback.
- Auth state must be visible.
- Writes/sends/escalations require approval.

## Next build stories

1. As an IT Ops lead, I need to see whether Alex is connected to live ServiceNow, so I can trust the dashboard.
2. As an IT Ops lead, I need live incident reads to show source-labelled ServiceNow records.
3. As an IT Ops lead, I need live change reads and CAB prep to use ServiceNow change records.
4. As a demo operator, I need synthetic scenarios clearly labelled, so I can avoid misrepresenting demo data as live.
5. As a governance reviewer, I need all write actions to require explicit approval and audit.
