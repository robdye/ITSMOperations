# ITSM Operations — Customer Demo Script
## "AI-Powered IT Service Management for M365 Copilot"

---

## Pre-Demo Setup

1. **Seed demo data** — Open the ITSM Operations agent in M365 Copilot and type:
   ```
   Seed the ServiceNow dev instance with demo data
   ```
   This creates 49 realistic ITSM records (incidents, changes, problems, CMDB CIs, SLAs) prefixed with `[DEMO]` for easy cleanup.

2. **Verify services are running:**
   - ITSM Digital Worker: `https://YOUR_CONTAINER_APP.azurecontainerapps.io/api/health`
   - MCP Server: `https://YOUR_MCP_APP.azurecontainerapps.io/health`

3. **Open surfaces:**
   - [M365 Copilot](https://m365.cloud.microsoft/chat) → Select **ITSM Operations** from the agent sidebar
   - [Teams](https://teams.microsoft.com) → Chat with **Alex IT Ops** (the Bot Framework channel)
   - Voice demo: Open `/voice` page in a separate tab with headset ready

4. **ServiceNow:** Ensure dev instance is awake: `https://YOUR_INSTANCE.service-now.com/`

> **Post-demo cleanup:** Type `Clear all demo data from ServiceNow` to remove all `[DEMO]` records.

---

## Act 1: The ITSM Operations Briefing (2 min)
### *"It's 08:00. The night shift just ended. What happened?"*

**[NARRATIVE]**
> "Imagine you're the IT Operations Manager at a Tier 1 bank. You've just arrived for the day shift. Instead of opening ServiceNow, checking Slack, reading emails, and cross-referencing 5 different dashboards, you ask your AI ops agent one question."

**[PROMPT]**
```
Give me my ITSM operations briefing. What's happening across incidents, problems, changes, and SLAs?
```

**[TALK TRACK]** *(while widget loads)*
> "The agent queries ServiceNow across ALL ITSM practices simultaneously — incidents, problems, changes, and SLAs — and synthesizes everything into a single operations briefing. This replaces the morning standup."

**[POINT OUT]**
- **Pulse KPIs** — 5 cards: P1 Incidents, Open Problems, SLA Breaches, Open Changes, Change Success Rate
- **Major Incidents** — each card clickable → opens directly in ServiceNow
- **SLA Breaches** — the most impactful ones surfaced first
- **Change Collisions** — multiple changes targeting the same CI that need sequencing
- **Action Items** — numbered, prioritized recommendations: *"The agent doesn't just show data — it tells you what to DO."*

> *"This shift handover briefing would take 30 minutes to compile manually — delivered in 10 seconds."*

---

## Act 2: Incident Management — "What's on fire?" (2 min)
### *"The briefing flagged P1/P2 incidents. Let's drill in."*

**[PROMPT 2a — Incident Dashboard]**
```
Show me the incident dashboard
```

**[POINT OUT]**
- **Priority KPIs** — P1 Critical (red), P2 High (orange), P3 Moderate (yellow), P4 Low, P5 Planning
- **Incident cards** — number, description, category, assignment group, opened date
- **State badges** — New, In Progress, On Hold
- **Click any card** → opens directly in ServiceNow

**[PROMPT 2b — Drill into a CI]**
```
Show me all incidents on the Java Application Server
```

> *"Cross-references the CMDB — every incident linked to this CI."*

**[PROMPT 2c — Change-Incident Correlation]**
```
Are there any recent changes on the CIs affected by these P1 incidents?
```

> *"If a change was implemented on the same CI within 48 hours of the incident, the agent flags the correlation. THIS is how you catch change-induced outages."*

---

## Act 3: Problem Management — "What keeps breaking?" (1 min)
### *"Three incidents on the same CI. That's a problem."*

**[PROMPT 3a — Problem Dashboard]**
```
Show me the problem dashboard
```

**[POINT OUT]**
- **KPIs** — Total, Open, Known Errors, Resolved
- **Known Error badge** (purple) — documented workaround for the Service Desk
- **Workaround text** — shown inline on each problem card

**[PROMPT 3b — Create a Problem]**
```
We have 3 recurring incidents on the Oracle FLX database. Create a problem record.
```

> *"Creates the problem directly in ServiceNow — returns the number with a deep link."*

---

## Act 4: SLA Compliance — "Are we meeting our commitments?" (1 min)

**[PROMPT]**
```
Show me the SLA compliance dashboard
```

**[POINT OUT]**
- **Compliance Rate** — percentage against target
- **Breached SLAs** (red tag) — escalation overdue
- **At Risk** — SLAs above 75% elapsed but not yet breached
- **Progress bars** — visual fill showing proximity to breach

> *"The Digital Worker monitors SLAs every 5 minutes and sends Teams alerts BEFORE they breach — proactive, not reactive."*

---

## Act 5: Change Enablement — "The Full Workflow" (3 min)

**[PROMPT 5a — Change Dashboard]**
```
Show me the change dashboard
```

> *"Full change pipeline: open CRs, risk distribution, collision detection, stale backlog."*

**[PROMPT 5b — Change Metrics]**
```
Show me our change management KPIs
```

> *"Success rate, emergency %, pipeline breakdown, average age."*

**[PROMPT 5c — Change Risk Briefing]**
```
Show me the change risk briefing
```

> *"Morning briefing for the Change Manager: collisions, stale CRs, high-risk changes, incident risks, actionable recommendations."*

**[PROMPT 5d — CAB Agenda]**
```
Generate the CAB meeting agenda for all pending changes
```

> *"Every change scored, classified, flagged for missing governance. The agent recommends approve/defer for each."*

**[PROMPT 5e — Blast Radius]**
```
Show me the blast radius for CMS App FLX
```

> *"Dependency graph — upstream and downstream systems. Every node clickable to ServiceNow."*

**[PROMPT 5f — Create Change Request]**
```
Create a change request for patching our database servers this weekend
```

> *"Interactive form with NIST CM-3 governance: business justification, backout plan, test plan."*

**[PROMPT 5g — Historical Check]**
```
Have we done similar database patches before? What was the success rate?
```

> *"Past changes with success/failure rates and lessons learned from close notes."*

---

## Act 6: Knowledge Base — "Where's the runbook?" (1 min)

**[PROMPT 6a — Knowledge Search]**
```
Search the knowledge base for email configuration procedures
```

**[POINT OUT]**
- Articles with KB numbers, view counts, topics, direct links
- *"Uses Azure AI semantic search when configured, auto-fallback to keyword search."*

**[PROMPT 6b — Similar Resolutions]**
```
Find past resolutions for Oracle database connection timeout incidents
```

> *"Semantic search across close notes of previously resolved incidents — surfaces patterns."*

**[PROMPT 6c — KB Gap Analysis]**
```
Run a knowledge base gap analysis
```

> *"Identifies incident categories with NO matching KB articles. Drives KCS article creation."*

**[PROMPT 6d — KB Analytics]**
```
Show me knowledge base analytics
```

> *"Total articles, published/draft/retired, average views, top categories."*

---

## Act 7: Asset & CMDB Management (1 min)

**[PROMPT 7a — Asset Compliance]**
```
Show me all end-of-life Configuration Items currently in use
```

> *"Non-compliant assets. Per NIST CM-3, remediation required."*

**[PROMPT 7b — EOL Risk Forecast]**
```
Show me assets approaching end of life in the next 12 months
```

> *"Timeline of upcoming EOL dates — plan procurement proactively."*

**[PROMPT 7c — Expired Warranties]**
```
Show me assets with expired warranties
```

> *"Hardware warranty tracking from the alm_asset table."*

**[PROMPT 7d — CMDB Lookup]**
```
Look up the Configuration Item called Oracle FLX in the CMDB
```

**[PROMPT 7e — CI Dependencies]**
```
Show me all the dependencies for the Java Application Server
```

---

## Act 8: Post-Implementation Review (1 min)
### *"A change closed yesterday. Did it cause problems?"*

**[PROMPT]**
```
Run a post-implementation review for CHG0000020. Did it cause any incidents?
```

**[POINT OUT]**
- **PIR Window** — work_end to +48 hours
- **Correlation** — incidents on the same CI within the window
- **ITIL recommendation** — rollback review if correlated

> *"The PIR that ITIL 4 mandates for every change — automated in seconds."*

---

## Act 9: FinOps Dashboard — "Where's the money going?" (1 min)

**[PROMPT]**
```
Show me the FinOps dashboard with cost anomalies and right-sizing candidates
```

**[POINT OUT]**
- **Cost trends** — monthly spend with trendlines
- **Top cost drivers** — resource groups ranked by spend
- **Right-sizing recommendations** — underutilized VMs flagged
- **Budget status** — forecast vs budget with variance
- **Anomalies** — unusual spending spikes flagged

> *"Links Azure Cost Management back to CMDB CIs — the CI that's costing the most is the CI that needs right-sizing."*

---

## Act 10: Shadow Agent Discovery — "Who's running rogue agents?" (1 min)

**[PROMPT]**
```
Run a shadow agent discovery sweep across our tenant
```

**[POINT OUT]**
- **Unregistered agents** found across the tenant
- **Risk classification** — critical, high, medium, low
- **Owner, created date, last activity**
- **Remediation actions** — register, decommission, quarantine

> *"For FS governance — DORA and FCA require you to know every autonomous system in your estate. This finds the shadow agents nobody registered."*

---

## Act 11: Shift Handover — "What happened overnight?" (1 min)

**[PROMPT]**
```
Generate a shift handover report covering the last 8 hours
```

**[POINT OUT]**
- **Incident summary** — opened, closed, escalated during the shift
- **Change activity** — implemented, rolled back, scheduled
- **SLA status** — breached or at risk during the shift
- **Key decisions** — approvals, escalations, emergency changes
- **Outstanding items** — what the next shift needs to action
- **Timeline** — chronological event log

> *"This runs automatically at 08:00 and 20:00 — posted to Teams and emailed to the ops manager."*

---

## Act 12: Audit Trail — "What did Alex do?" (1 min)

**[PROMPT]**
```
Show me the audit trail for the last 24 hours
```

**[POINT OUT]**
- **Every action** — worker, tool, resource, outcome, timestamp
- **Filterable** — by worker, action type, severity, date range
- **Searchable** — find specific incidents, changes, or CIs

> *"Full audit trail of every action the digital worker has taken. For regulators: every agent action is queryable, traceable, and attributable."*

---

## Act 13: Schedule Control — "What's running automatically?" (1 min)

**[PROMPT]**
```
Show me the scheduled routine control panel
```

**[POINT OUT]**
- **Active scheduled jobs** — incident monitoring, SLA checks, shift handover, etc.
- **Status** — active, paused, error
- **Last run / Next run** — timing visibility
- **Run history** — success/failure timeline

> *"Every automated routine the digital worker runs. Pause any job with one click."*

---

## Act 14: Vendor & Contract Management (1 min)

**[PROMPT 14a — Vendors]**
```
List our IT vendors
```

**[PROMPT 14b — Expiring Contracts]**
```
Show me contracts expiring in the next 90 days
```

> *"Proactive renewal management — flag contracts before they lapse."*

**[PROMPT 14c — License Compliance]**
```
Run a software license compliance check
```

> *"Compares entitled vs installed — identifies over-deployed and under-utilized licenses."*

---

## Act 15: ServiceNow Live Chat — "I need a human" (1 min)

**[PROMPT]**
```
Connect me to a ServiceNow live agent for help with a complex network issue
```

**[POINT OUT]**
- **Escalation path** — from AI agent to human agent seamlessly
- **Context preservation** — conversation history passed to the human agent
- **Queue selection** — general, network, security, database

> *"The AI knows when to escalate. Human-in-the-loop is built in, not bolted on."*

---

## Act 16: Mission Control — "What's Alex doing right now?" (1 min)

**[PROMPT]**
```
Show me Mission Control
```

**[POINT OUT]**
- **Active workers** — which ITIL workers are currently running
- **Tool-call waterfall** — live feed of every MCP tool call
- **HITL queue** — pending human approvals
- **Schedule heartbeat** — next scheduled job and countdown
- **Worker capabilities** — what each worker can do

> *"The Operations Manager's view into the digital workforce. Think of it as the NOC for the agents."*

---

## Act 17: Voice Operations — "Hands-free NOC" (1 min)

**[TALK TRACK]**
> "The same agent, the same tools, accessible via voice. Perfect for NOC analysts working on a keyboard while monitoring screens."

**[SHOW — open `/voice` in browser]**

**Say:**
```
Give me the ITSM briefing
```

**Say:**
```
Are there any P1 incidents?
```

**Say:**
```
What's the blast radius for CMS App FLX?
```

**Say:**
```
Connect me to a live agent
```

> *"Voice calls the same ServiceNow MCP tools server-side. Audio in, intelligence out."*

---

## Act 18: Cross-Channel Consistency — "Same agent, same answer" (1 min)
### *"Ask the same question in both surfaces — see the same data."*

**[DEMO — Side by side: M365 Copilot DA (left) + Teams Alex IT Ops chat (right)]**

**Ask both:**
```
How many active incidents do we have?
```

> *"Both channels query the same MCP server, same SNOW filters, same data. The declarative agent renders a widget; Alex returns text. Same numbers, different presentation."*

**[TALK TRACK]**
> *"Consistency across channels was a hard problem — we solved it by centralizing ALL queries through a single MCP server with deterministic filters. No LLM-controlled query parameters on dashboards — the agent sees exactly what SNOW returns."*

---

## Act 19: The Digital Worker — Autonomous Operations (1 min)
### *"What happens when I'm not in the chat?"*

**[TALK TRACK]**
> "Everything we've shown is interactive. But the Digital Worker runs 24/7 autonomously."

**[POINT OUT]**
- **Shift Handover** — auto-generated at 08:00/20:00
- **Incident Monitor** — polls every 5 min for new P1/P2, posts to Teams with triage suggestions
- **Change-Incident Correlation** — when a new P1 opens, checks recent changes on the same CI
- **Recurring Pattern Detection** — 3+ incidents on the same CI → suggests creating a problem
- **SLA Breach Alerts** — proactive Teams notifications before SLAs breach

**[SHOW — health endpoint]**
```
https://YOUR_CONTAINER_APP.azurecontainerapps.io/api/health
```

---

## Act 20: DLP & Governance (1 min)

**[PROMPT]**
```
What's the current DLP classification status?
```

**[TALK TRACK]**
> "Every tool call is classified: read, write, or admin. Write operations require human-in-the-loop confirmation. Admin operations are restricted to authorized operators."

**[POINT OUT]**
- **Read operations** — unrestricted (get-incidents, search-knowledge, dashboards)
- **Write operations** — HITL confirmation required (create-incident, update-change)
- **PII handling** — Purview-style sensitivity classification on data responses
- **Audit trail** — every action logged with user, worker, tool, resource, outcome

---

## Enhancement Acts (optional — pick what fits your audience)

### Act E1: Multi-Agent Major Incident Command (3 min)

**[PROMPT]**
```
A new P1 has been raised: "Online banking login failures spiking, 30% of users affected." Spin up Major Incident Command.
```

> *"Magentic-One orchestration: Task Ledger + Progress Ledger. Parallel agents: Incident Manager, Monitoring, Change, SecOps, Comms, Knowledge. Magentic-UI plan approval gate."*

### Act E2: Computer Use Agent — Legacy Console (2 min)

**[PROMPT]**
```
The Glasgow print queue is stuck. Restart it on the Citrix admin console.
```

> *"Anthropic-style computer-use for legacy consoles with no API. Purview-governed, video-audited."*

### Act E3: Copilot Tuning + Reasoning RCA (2 min)

**[PROMPT]**
```
Write the resolution notes for INC0012345 — Oracle FLX failover triggered 03:42.
```

> *"Fine-tuned on your runbooks and KEDB — writes in your house style."*

**[PROMPT]**
```
Run a full root cause analysis on Problem PRB0001022. Show your reasoning.
```

> *"o-series reasoning model with visible chain-of-thought."*

### Act E4: CAB-as-an-Agent + Loop + Fabric (2 min)

**[PROMPT]**
```
Open the CAB for this week. Table all RFCs, score risk, collect votes by Thursday.
```

> *"Loop component in Teams + Outlook. Adaptive Card Universal Actions."*

### Act E5: Governance — Purview + Entra Agent ID (2 min)

> *"Each worker has its own Entra Agent ID. Conditional Access per worker. Purview Agent DLP prevents PII leakage. Every action auditable."*

---

## Closing (30 sec)

> "What you've seen today is a **full ITSM Operations platform** built on M365 Copilot:
>
> - **18 interactive Fluent UI v9 widgets** with dark mode support
> - **50+ tools** across 12 ITIL 4 practices with NIST 800-53 governance
> - **23 ITIL specialist workers** — Incident, Problem, Change, Knowledge, Asset/CMDB, SLA, Security, FinOps, Release, Monitoring, Service Desk, Shift Handover, Vendor, Capacity, Continuity, and more
> - **Voice interface** for hands-free NOC operations
> - **ServiceNow live chat** escalation to human agents
> - **Live ServiceNow data** — every dashboard pulls real data, not mock-ups
> - **Autonomous Digital Worker** running 24/7 — shift handover, incident monitoring, SLA alerts
> - **Cross-channel consistency** — DA, Teams chat, and voice all query the same MCP server
> - **Full audit trail** — every agent action queryable, traceable, attributable
>
> Three layers: **Declarative Agent** (interactive) + **Digital Worker** (autonomous) + **Voice** (hands-free). All governed by Entra + Purview."

---

## Quick Reference — All Demo Prompts

| # | Capability | Prompt |
|---|-----------|--------|
| 1 | ITSM Briefing | `Give me my ITSM operations briefing` |
| 2 | Incident Dashboard | `Show me the incident dashboard` |
| 3 | Incidents by CI | `Show me all incidents on the Java Application Server` |
| 4 | Problem Dashboard | `Show me the problem dashboard` |
| 5 | Create Problem | `We have 3 recurring incidents on Oracle FLX. Create a problem record.` |
| 6 | SLA Dashboard | `Show me the SLA compliance dashboard` |
| 7 | Change Dashboard | `Show me the change dashboard` |
| 8 | Change Metrics | `Show me our change management KPIs` |
| 9 | Change Risk Briefing | `Show me the change risk briefing` |
| 10 | CAB Agenda | `Generate the CAB meeting agenda` |
| 11 | Blast Radius | `Show me the blast radius for CMS App FLX` |
| 12 | Create Change | `Create a change request for patching our database servers` |
| 13 | Change History | `Have we done similar database patches before?` |
| 14 | PIR | `Run a post-implementation review for CHG0000020` |
| 15 | Knowledge Search | `Search the knowledge base for email configuration` |
| 16 | Similar Resolutions | `Find past resolutions for Oracle connection timeout` |
| 17 | KB Gap Analysis | `Run a knowledge base gap analysis` |
| 18 | KB Analytics | `Show me knowledge base analytics` |
| 19 | Asset Compliance | `Show me end-of-life CIs currently in use` |
| 20 | EOL Risk Forecast | `Show me assets approaching end of life` |
| 21 | Expired Warranties | `Show me assets with expired warranties` |
| 22 | CMDB Lookup | `Look up Oracle FLX in the CMDB` |
| 23 | CI Dependencies | `Show me dependencies for the Java Application Server` |
| 24 | FinOps Dashboard | `Show me the FinOps dashboard` |
| 25 | Shadow Agent Sweep | `Run a shadow agent discovery sweep` |
| 26 | Shift Handover | `Generate a shift handover report` |
| 27 | Audit Trail | `Show me the audit trail for the last 24 hours` |
| 28 | Schedule Control | `Show me the scheduled routine control panel` |
| 29 | Vendors | `List our IT vendors` |
| 30 | Expiring Contracts | `Show me contracts expiring in the next 90 days` |
| 31 | License Compliance | `Run a software license compliance check` |
| 32 | Live Agent | `Connect me to a ServiceNow live agent` |
| 33 | Mission Control | `Show me Mission Control` |
| 34 | DLP Status | `What's the current DLP classification status?` |
| 35 | Service Catalog | `What items are available in the service catalog?` |
| 36 | Create Incident | `Create an incident for email service degradation` |
| 37 | Azure Alerts | `Show me Azure Monitor alerts` |
| 38 | Seed Demo Data | `Seed the ServiceNow dev instance with demo data` |
| 39 | Clear Demo Data | `Clear all demo data from ServiceNow` |
| 40 | Voice Briefing | *(voice)* `Give me the ITSM briefing` |
| 41 | Cross-Channel | `How many active incidents do we have?` *(ask in both DA and Teams)* |

---

## Architecture

```
+-----------------------------------------------------------------------+
|   M365 Copilot (DA)        |   Teams Chat (Alex)  |   Voice (/voice)  |
|   18 Fluent UI v9 Widgets  |   Bot Framework      |   WebSocket Proxy |
+-----------------------------------------------------------------------+
|                    MCP Server (50+ tools)                              |
|   ServiceNow REST API | Azure AI Search | Azure Monitor               |
|   endoflife.date | Demo Data Seeder | Live Chat | DLP                 |
+-----------------------------------------------------------------------+
|                 Digital Worker (23 ITIL workers)                       |
|   Incident | Problem | Change | Release | Deployment | Knowledge     |
|   Service Desk | Asset/CMDB | SLA | Service Validation | Monitoring  |
|   FinOps | Security | Vendor | Capacity | Continuity | Shift Handover|
|   Knowledge Harvester | Computer Use | Shadow Agent Discovery         |
+-----------------------------------------------------------------------+
|   GOVERNANCE: Entra Agent ID | Purview DLP | HITL | Audit Trail       |
+-----------------------------------------------------------------------+
|   INFRA: Azure Container Apps | ACR | Service Bus | Key Vault         |
+-----------------------------------------------------------------------+
```
