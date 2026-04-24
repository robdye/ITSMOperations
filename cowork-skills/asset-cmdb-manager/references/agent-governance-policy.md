# Agent Governance Policy — ABSx Financial Services

**Policy ID:** AGP-001  
**Classification:** Internal  
**ITIL Practice:** Service Configuration Management  
**NIST Controls:** CM-2, CM-8, CM-9

## 1. Purpose

This policy establishes governance requirements for all Microsoft 365 Copilot
agents and apps deployed within the ABSx tenant. All agents — whether declarative
or custom engine — are treated as IT assets subject to CMDB registration, lifecycle
management, and periodic audit.

## 2. Agent Classification

| Type | Approval Required | Review Cadence | Max Scope |
|---|---|---|---|
| Microsoft (1st party) | None | Annual | All users |
| External (partner) | IT Security review | Quarterly | Approved groups only |
| Shared (org) | Department head | Quarterly | Department groups |
| Custom (LOB) | IT Governance board | Monthly | Named groups only |

## 3. Lifecycle Requirements

### 3.1 Registration
Every custom agent MUST be registered in the CMDB as a Configuration Item (CI)
with class `cmdb_ci_copilot_agent` (or `cmdb_ci_application` if class unavailable).

### 3.2 Staleness Policy
- Agents not updated within **90 days** are flagged for review.
- Agents not updated within **180 days** are candidates for decommission.
- Agents not updated within **365 days** MUST be blocked pending owner confirmation.

### 3.3 Scope Policy
- Custom agents MUST NOT have `availableTo: all` without CISO approval.
- External agents MUST NOT have `availableTo: all` without vendor risk assessment.
- Blocked agents MUST have a documented reason in the CMDB.

### 3.4 Ownership
- Every agent package MUST have an assigned owner (individual, not team).
- Owner departure triggers mandatory reassignment within 5 business days.
- Orphaned agents (no owner) are escalated to IT Governance board.

## 4. Audit Requirements
- Full inventory audit: **Monthly**
- Risk scoring recalculation: **Weekly** (automated)
- Compliance report to CISO: **Quarterly**
- Board notification for Critical risk agents: **Immediate**

## 5. NIST Alignment

| Control | Application |
|---|---|
| CM-2 Baseline Configuration | Agent inventory is part of the configuration baseline |
| CM-8 Component Inventory | All agents registered as CIs in CMDB |
| CM-9 Configuration Management Plan | This policy is the CMP for agents |
