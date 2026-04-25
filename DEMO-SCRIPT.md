# ITSM Operations — Customer Demo Script
## "AI-Powered IT Service Management for M365 Copilot"

---

## Pre-Demo Setup
- Open [M365 Copilot](https://m365.cloud.microsoft/chat) in your browser
- Select **ITSM Operations** from the agent sidebar
- Ensure ServiceNow dev instance is active: https://dev336844.service-now.com/
- ITSM Digital Worker running: https://itsm-operations-worker.jollysand-88b78b02.eastus.azurecontainerapps.io/api/health
- Recommended: full-screen browser for widget impact
- Voice demo: have headset ready, open /voice page in separate tab

---

## Act 1: The ITSM Operations Briefing (2 min)
### *"It's 08:00. The night shift just ended. What happened?"*

**[NARRATIVE]**
> "Imagine you're the IT Operations Manager at a Tier 1 bank. You've just arrived for the day shift. Instead of opening ServiceNow, checking Slack, reading emails, and cross-referencing 5 different dashboards, you ask your AI ops agent one question."

**[PROMPT 1 — ITSM Operations Briefing]**
```
Give me my ITSM operations briefing. What's happening across incidents, problems, changes, and SLAs?
```

**[TALK TRACK]** *(while widget loads)*
> "The agent queries ServiceNow across ALL ITSM practices simultaneously — incidents, problems, changes, and SLAs — and synthesizes everything into a single operations briefing. This replaces the morning standup."

**[POINT OUT]**
- **Pulse KPIs** — 5 cards in one row: P1 Incidents, Open Problems, SLA Breaches, Open Changes, Change Success Rate
- **Major Incidents** — *"31 P1/P2 incidents. Each card is clickable — takes you straight to the incident in ServiceNow."*
- **SLA Breaches** — *"12 SLAs breached. The agent surfaces the most impactful ones."*
- **Change Collisions** — *"12 collisions — multiple changes targeting the same CI. These need sequencing."*
- **Action Items** — *"Numbered, prioritized recommendations. The agent doesn't just show data — it tells you what to DO."*

> *"This is the shift handover briefing that would take 30 minutes to compile manually — delivered in 10 seconds. And the Digital Worker sends this automatically at 08:00 and 20:00 every day via email and Teams."*
- **Stale Changes** — *"82 CRs open more than 30 days. Click any card to open directly in ServiceNow."*
- **High Risk Changes** — changes with risk score 13+ requiring mandatory CAB review
- **Recommendations** — numbered action items: escalate P1s, resolve SLA breaches, sequence collisions

---

## Act 2: Incident Management — "What's on fire?" (2 min)
### *"The briefing flagged 31 P1/P2 incidents. Let's drill in."*

**[PROMPT 2 — Incident Dashboard]**
```
Show me all active incidents. Are there any P1s or P2s?
```

**[TALK TRACK]**
> "The agent pulls every open incident from ServiceNow, organised by priority. Each card is clickable — one click takes you straight into the incident record."

**[POINT OUT]**
- **Priority KPIs** — P1 Critical, P2 High, P3 Moderate, P4 Low, P5 Planning
- **Incident cards** — number, description, category, assignment group, opened date
- **Priority color coding** — red = P1, orange = P2, yellow = P3, green = P4
- **State badges** — New, In Progress, On Hold, Resolved
- **Click any card** → *"Opens directly in ServiceNow. No tab-switching."*

**[PROMPT 2b — Check for related changes]**
```
Are there any recent changes on the CIs affected by these P1 incidents?
```

> *"The agent cross-references incidents with recently closed changes. If a change was implemented on the same CI within 48 hours of the incident opening, it flags the correlation. THIS is how you catch change-induced outages."*

---

## Act 3: Problem Management — "What keeps breaking?" (1 min)
### *"Three incidents on the same CI. That's a problem."*

**[PROMPT 3 — Problem Dashboard]**
```
Show me the problem dashboard. How many known errors do we have?
```

**[TALK TRACK]**
> "The problem dashboard shows all open problems with known error flags. Known errors have documented workarounds — these are critical for the Service Desk."

**[POINT OUT]**
- **KPIs** — Total, Open, Known Errors, Resolved
- **Known Error badge** (purple) — *"These have a documented workaround. The Service Desk should apply the workaround while the permanent fix is in progress."*
- **Workaround text** — shown inline on each problem card
- **Click any problem** → opens in ServiceNow

**[PROMPT 3b — Create a problem]**
```
We have 3 recurring incidents on the Oracle FLX database. Create a problem record.
```

> *"The agent creates the problem directly in ServiceNow and returns the problem number with a link."*

---

## Act 4: SLA Compliance — "Are we meeting our commitments?" (1 min)
### *"The briefing showed 12 SLA breaches. That's a red flag."*

**[PROMPT 4 — SLA Dashboard]**
```
Show me the SLA compliance dashboard. Are any SLAs breached or at risk?
```

**[TALK TRACK]**
> "This is the SLA auditor's view. Every tracked SLA with its completion percentage, breach status, and time remaining."

**[POINT OUT]**
- **Compliance Rate** — *"20%. That's well below the 95% target. The dev instance has old data, but in production this immediately surfaces which teams are underperforming."*
- **Breached SLAs** (red tag) — *"These have already breached. Escalation is overdue."*
- **At Risk** — SLAs above 75% elapsed but not yet breached
- **Progress bars** — visual fill showing how close each SLA is to breach
- *"In production, the Digital Worker monitors this every 5 minutes and sends Teams alerts BEFORE SLAs breach — proactive, not reactive."*

---

## Act 5: Change Enablement — "The Full Workflow" (3 min)
### *"Now let's see the change management workflow end-to-end."*

**[PROMPT 5a — Change Metrics]**
```
Show me our change management KPIs
```

> *"90% success rate, 5% emergency changes, 89 open CRs, 695 days average age. The stale backlog is dragging that number up."*

**[PROMPT 5b — CAB Agenda]**
```
Generate the CAB meeting agenda for all pending changes
```

> *"44 changes for review. Each one scored, classified, and flagged for missing governance fields. The agent recommends approve/defer for each. Ask it to email the agenda to the CAB distribution list."*

**[PROMPT 5c — Blast Radius]**
```
Show me the blast radius for CMS App FLX
```

> *"6 systems in the blast radius. Workstation FLX upstream, Java App Server, MySQL, Oracle, Webserver downstream. Every node clickable to ServiceNow."*

**[PROMPT 5d — Create Change Request]**
```
I need to create a change request for patching our database servers this weekend
```

> *"Interactive form with NIST CM-3 governance fields. Business justification, backout plan, test plan — all mandatory."*

**[PROMPT 5e — Historical Check]**
```
Have we done similar database patches before? What was the success rate?
```

> *"Past changes shown with success/failure rates and lessons learned from close notes."*

---

## Act 6: Knowledge Base + Asset Management (1 min)
### *"Where's the runbook? And what about our asset inventory?"*

**[PROMPT 6a — Knowledge Search]**
```
Search the knowledge base for email configuration procedures
```

**[TALK TRACK]**
> "The agent searches ServiceNow's knowledge base and returns published articles with view counts, topics, and direct links."

**[POINT OUT]**
- Articles with numbers (KB0000028, KB0000024)
- View counts — *"Most-viewed articles surface first"*
- **Click any article** → opens in ServiceNow

**[PROMPT 6b — Asset Compliance]**
```
Show me all end-of-life Configuration Items currently in use
```

> *"12 non-compliant assets — Windows XP, Windows 2000, Red Hat Enterprise 3. All clickable to CMDB. Per NIST CM-3, remediation required."*

**[PROMPT 6c — Expired Warranties]**
```
Show me assets with expired warranties
```

> *"Hardware warranty tracking from the alm_asset table. Flag for procurement."*

---

## Act 7: Post-Implementation Review + Audit (1 min)
### *"A change closed yesterday. Did it cause problems?"*

**[PROMPT 7 — PIR]**
```
Run a post-implementation review for CHG0000020. Did it cause any incidents?
```

**[TALK TRACK]**
> "The agent checks what happened in the 48 hours after the change was implemented."

**[POINT OUT]**
- **PIR Window** — work_end to +48 hours
- **Result** — no incidents or correlated incidents with links
- **ITIL recommendation** — if correlated, recommend rollback review
- *"This is the PIR that ITIL V4 mandates for every change — automated in seconds."*

---

## Act 8: The Digital Worker — Autonomous Operations (1 min)
### *"What happens when I'm not in the chat?"*

**[TALK TRACK]**
> "Everything we've shown so far is the declarative agent — you ask, it answers. But the Digital Worker runs 24/7 autonomously."

**[POINT OUT]**
- **Shift Handover** — auto-generated at 08:00 and 20:00, emailed to the ops manager and posted to Teams
- **Incident Monitor** — polls every 5 minutes for new P1/P2 incidents, posts alerts to Teams with auto-triage suggestions
- **Change-Incident Correlation** — when a new P1 opens, the worker checks if a change was recently implemented on the same CI
- **Recurring Pattern Detection** — if 3+ incidents hit the same CI, it suggests creating a problem record
- **SLA Breach Alerts** — proactive Teams notifications before SLAs breach

**[SHOW]**
- Open the worker health endpoint: `https://itsm-operations-worker.jollysand-88b78b02.eastus.azurecontainerapps.io/api/health`
- *"Running, features all enabled, shift handover and incident monitoring active."*

---

## Act 9: Voice Operations (1 min)
### *"And for the NOC analysts who need hands-free..."*

**[TALK TRACK]**
> "The same agent, the same tools, accessible via voice. Perfect for NOC analysts who are working on a keyboard while monitoring screens."

**[SHOW]**
- Open the voice page: `/voice`
- Say: *"Give me the ITSM briefing"*
- Say: *"Are there any P1 incidents?"*
- Say: *"What's the blast radius for CMS App FLX?"*

> *"The voice interface calls the same ServiceNow MCP tools server-side. Audio in, intelligence out. 19 voice-enabled ITSM tools."*

---

## Closing (30 sec)

> "What you've seen today is a **full ITSM Operations platform** built on M365 Copilot:
>
> - **12 interactive UI widgets** covering incidents, problems, changes, SLAs, assets, knowledge, and blast radius
> - **35+ tools** across 8 ITIL V4 practices with NIST 800-53 governance
> - **Autonomous Digital Worker** with shift handover, incident monitoring, and proactive alerting
> - **Voice interface** with 19 voice-enabled tools for hands-free NOC operations
> - **Live ServiceNow data** across 7 tables: incidents, problems, changes, CMDB, SLAs, knowledge, assets
> - **Every item clickable** — deep links from every widget directly into ServiceNow
>
> Three layers: **Declarative Agent** (ask and answer) + **Digital Worker** (autonomous monitoring) + **Voice** (hands-free operations).
>
> This transforms IT Operations from a reactive, multi-tool process into a **unified, proactive, AI-powered operations centre**."

---

## Backup Prompts (if time permits)

| Scenario | Prompt |
|----------|--------|
| Incident by CI | `Show me all incidents on the Java Application Server` |
| CMDB Lookup | `Look up the Configuration Item called Oracle FLX in the CMDB` |
| CI Dependencies | `Show me all the dependencies for the Java Application Server` |
| EOL Check | `What's the end-of-life status for Red Hat Enterprise Linux 8?` |
| Collision Detection | `Are any open changes targeting the same Configuration Item?` |
| Update a CR | `Update CHG0000012 to add a backout plan` |
| Risk Memo | `Draft a risk memo email about the non-compliant Windows Server 2016 instances` |
| Service Catalog | `What items are available in the service catalog?` |
| Risk Forecast | `Show me assets approaching End of Life in the next 12 months` |
| Change History | `Show me past changes for Oracle FLX. Were they successful?` |

---

## Architecture Slide

```
+-----------------------------------------------------------+
|              M365 Copilot (Frontend)                       |
|  Declarative Agent + OpenAI Apps SDK                       |
|  12 Interactive UI Widgets                                 |
+-----------------------------------------------------------+
| ITSM Operations MCP        | EOL Lifecycle Intelligence   |
| 32 tools                   | 3 tools                      |
+----------------------------+------------------------------+
| ServiceNow Table API                                       |
| Incidents       | Problems       | Changes    | SLAs       |
| CMDB + CIs      | Knowledge Base | Assets     | Catalog    |
| Blast Radius    | Collision Det. | PIR        | Metrics    |
+-----------------------------+-----------------------------+
| endoflife.date API          | Azure Monitor (optional)    |
| Product Lifecycles          | Infrastructure Alerts       |
+-----------------------------------------------------------+
| ITSM Digital Worker (Agent 365)                            |
| Shift Handover (08:00/20:00) | Incident Monitor (5min)    |
| Change-Incident Correlation  | SLA Breach Prediction      |
| Recurring Pattern Detection  | Voice Live (19 tools)      |
+-----------------------------------------------------------+
         Azure Container Apps
         portfolioagentacr.azurecr.io
         change-mgmt-mcp:v6 + itsm-worker:v4
```

---

## Three Layers of Intelligence

| Layer | What It Does | How It Works |
|-------|-------------|--------------|
| **Declarative Agent** | Ask and answer — interactive ITSM operations | M365 Copilot + MCP Server + 12 widgets |
| **Digital Worker** | Autonomous monitoring — runs 24/7 without prompts | Agent 365 + node-cron + Teams/Email alerts |
| **Voice Interface** | Hands-free operations for NOC analysts | Azure Voice Live + WebSocket proxy + 19 tools |

---

## The Workflow Story

> **08:00 — Shift Starts** → Digital Worker sends handover briefing via email + Teams
>
> **08:05 — Arrive at Desk** → "Give me the ITSM briefing" → incidents, problems, SLAs, changes in one view
>
> **08:10 — Triage** → "Show me the P1 incidents" → drill into the incident dashboard
>
> **08:15 — Investigate** → "Show me the blast radius for Oracle FLX" → dependency graph
>
> **08:30 — Correlate** → "Are there any recent changes on this CI?" → change-incident correlation
>
> **09:00 — CAB Prep** → "Generate the CAB agenda" → structured agenda → email to CAB
>
> **10:00 — KB** → "Find the runbook for Oracle failover" → knowledge base search
>
> **14:00 — Act** → "Create a change request for patching" → interactive form
>
> **16:00 — Review** → "Run a PIR for CHG0000020" → 48-hour incident correlation
>
> **17:00 — Report** → "Show me our KPIs" → board-ready metrics
>
> **20:00 — Shift Ends** → Digital Worker sends handover briefing to night team
>
> **All Night** → Incident Monitor watches for P1s, SLA breaches, and posts to Teams
