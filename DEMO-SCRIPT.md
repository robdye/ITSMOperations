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

### Enhancement Demos (optional, see Acts 10–14)
- **Mission Control** open in second tab to show the Magentic-One *Task Ledger* + *Progress Ledger* live during the Major Incident scenario
- **Avatar NOC operator** (Azure Speech avatar + Voice Live) projected on a wall screen if available
- **Loop component** for CAB-as-an-agent ready in Teams + Outlook
- **Purview portal** (Agent DLP, Communication Compliance) and **Entra Admin Center → Agent IDs** open for the governance act
- **Microsoft Fabric** workspace open with the Eventstream → KQL → Activator pipeline pre-built
- **Copilot Tuning** workspace in the Copilot Control System, fine-tune job already trained on runbooks/KEDB

> *"Acts 1–9 are what runs today. Acts 10–14 are the next-wave enhancements built on the latest Microsoft platform — Agent Framework, Magentic-One, Computer Use, Copilot Tuning, Purview Agent DLP, Entra Agent ID, Loop, and Fabric Real-Time Intelligence. Pick the acts that fit your audience and time budget."*

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

**[ENHANCEMENT — Avatar NOC Operator]**
> *"And in the next release we're upgrading the voice channel to a full **Azure Speech photoreal avatar** running on **Voice Live** — full-duplex, interruptible, with barge-in. Picture this on a NOC wall screen: an always-on AI ops engineer the team can just talk to. Same toolset under the hood, dramatically more natural interaction."*

---

## Act 10: Multi-Agent Major Incident Command (3 min)  *[ENHANCEMENT]*
### *"A P1 just hit. Watch a team of agents take command."*

**[NARRATIVE]**
> "Today the Command Center orchestrates 13 ITIL workers sequentially. The next-generation pattern is **Magentic-One** — a research orchestration model from Microsoft Research where an Orchestrator agent maintains a **Task Ledger** (facts, plan) and a **Progress Ledger** (what's done, what's stuck, what to re-plan) and routes work to specialist agents in parallel. We've re-platformed the Command Center on the **Microsoft Agent Framework** (the GA merger of Semantic Kernel + AutoGen) and adopted Magentic-One for Sev1/Sev2 incidents."

**[PROMPT 10 — Major Incident Command]**
```
A new P1 has been raised: "Online banking login failures spiking, 30% of users affected." Spin up Major Incident Command.
```

**[SHOW IN MISSION CONTROL]**
- **Task Ledger** — facts gathered (affected service, dependent CIs, recent changes, error budget remaining), the plan, the unknowns
- **Progress Ledger** — live updates as agents report back; Orchestrator re-plans on the fly
- **Parallel agent activity:**
  - **Incident Manager** — opens MIM record, declares Sev1, spins up Teams **incident bridge** with Stream recording
  - **Monitoring Agent** — pulls Sentinel/Defender/Datadog signals via Fabric KQL
  - **Change Agent** — checks the last 48h of changes on dependent CIs
  - **SecOps Agent** — rules out a security incident
  - **Comms Agent** — drafts exec update + customer status page entry every 30 min
  - **Knowledge Agent** — surfaces the matching KEDB workaround
- **Magentic-UI plan approval gate** — Duty Manager sees the Orchestrator's plan and clicks **Approve** before any write actions execute
- **Post-incident** — Reasoning model (o-series) drafts a full RCA with chain-of-thought visible in the ServiceNow Problem record

> *"This is the difference between agents-as-a-checklist and agents-as-a-team. Magentic-One under the bonnet, Microsoft Agent Framework as the runtime, Magentic-UI as the human-in-the-loop. The duty manager stays in command — the agents do the running around."*

---

## Act 11: Computer Use Agent — The Legacy Console (2 min)  *[ENHANCEMENT]*
### *"Half our Ops tools have no API. Watch an agent drive them anyway."*

**[NARRATIVE]**
> "Every FS Ops shop has the same problem: vSphere consoles, on-prem firewall UIs, mainframe green-screens, vendor portals (BT, Cisco, ServiceNow itself for some flows). No API, no MCP server, just a browser and a human. We've added a **Computer Use Agent (CUA)** worker — Anthropic-style computer-use, governed by Purview, every session video-recorded for audit."

**[PROMPT 11 — Computer Use Agent]**
```
The Glasgow print queue is stuck. Restart it on the Citrix admin console.
```

**[SHOW]**
- Side-by-side: chat panel + a **live VNC view** of the agent driving the Citrix admin console
- Agent narrates each step ("I'm opening the print spooler service, stopping it, clearing the queue, restarting…")
- **Purview policy check** before any destructive action
- **Stream recording** of the entire session attached to the incident record

**[PROMPT 11b — Vendor Portal]**
```
Raise a P1 with BT in their portal for the Edinburgh circuit outage. Reference INC0012345.
```

> *"Same pattern, different tool. The agent logs into the BT portal, raises the ticket, captures the reference number, posts it back to ServiceNow. Every keystroke audited. This unlocks **every legacy console in the estate** — no more 'we can't automate it because there's no API'."*

---

## Act 12: Copilot Tuning + Reasoning RCA (2 min)  *[ENHANCEMENT]*
### *"The agent now writes in your house style — and reasons like a senior engineer."*

**[NARRATIVE]**
> "Two enhancements that change the *quality* of every output. **Copilot Tuning** — fine-tunes a small model on 12 months of resolved tickets, runbooks, KEDB articles, and CAB minutes, so resolutions are written in *your* voice with *your* patterns. **Reasoning models** — for Problem Management and RCA, we route to o-series via Azure OpenAI and *render the chain-of-thought*."

**[PROMPT 12a — House-Style Resolution]**
```
Write the resolution notes for INC0012345 — Oracle FLX failover triggered 03:42, secondary took over, root cause TBC.
```

> *"Notice the tone, the structure, the references to internal runbook IDs (RB-ORA-014), the KEDB lookup (KE0000231) — that's not GPT-4o out of the box, that's a fine-tune on the firm's own corpus. Copilot Tuning, deployed in Copilot Control System, governed by Purview."*

**[PROMPT 12b — Reasoning RCA]**
```
Run a full root cause analysis on Problem PRB0001022 — recurring CMS App FLX latency spikes. Show your reasoning.
```

**[SHOW]**
- **Reasoning panel** in Mission Control — visible chain-of-thought: hypotheses, evidence, eliminations, conclusion
- **Five Whys** auto-generated and embedded in the Problem record
- **Linked artefacts** — incidents, changes, telemetry queries, KEDB candidates, recommended permanent fix

> *"That's audit-grade RCA, not the one-paragraph hand-wave most Problem records become. Reasoning visible, sources cited, every claim traceable."*

---

## Act 13: CAB-as-an-Agent + Loop + Fabric (2 min)  *[ENHANCEMENT]*
### *"The CAB meeting runs itself. The data spine feeds it live."*

**[NARRATIVE]**
> "Two more shifts. **CAB-as-an-agent** — the Change Manager *runs* the CAB asynchronously inside a **Loop component** that flows through Teams *and* Outlook. **Fabric Real-Time Intelligence** — every monitoring event, change record, and incident lands in **Eventstream → KQL → Activator**, and the agents query Fabric directly."

**[PROMPT 13a — Loop CAB]**
```
Open the CAB for this week. Table all RFCs, score risk, collect votes by Thursday 17:00.
```

**[SHOW]**
- A **Loop component** rendered in Teams: each RFC as a row with risk score, blast radius, rollback plan, vote tally
- Same component opened in **Outlook** — a CAB member edits their vote inline; updates flow back instantly
- **Adaptive Card Universal Actions** — *Approve / Defer / Request Info* buttons posting decisions to ServiceNow
- Change Manager agent **tallies votes**, **drafts minutes**, posts to SharePoint, **updates each RFC in ServiceNow** with the CAB outcome

**[PROMPT 13b — Fabric KQL]**
```
Show me every disk-full event correlated with last night's deployment window.
```

> *"That query runs against a **Fabric KQL database** fed by Eventstream — ServiceNow events, Azure Monitor, Defender XDR, all in one spine. Activator triggers create incidents automatically when patterns hit. The agents query it as just another tool."*

---

## Act 14: Governance — Purview Agent DLP + Entra Agent ID (2 min)  *[ENHANCEMENT]*
### *"For FS, governance is the demo."*

**[NARRATIVE]**
> "Everything you've seen runs under enterprise-grade governance. Three pillars: **Entra Agent ID** for identity, **Conditional Access** for access control, **Purview** for data protection and compliance."

**[SHOW — Entra Admin Center]**
- Each of the 13+ workers has its own **Entra Agent ID** (GA)
- **Conditional Access policies:**
  - *Security Manager* — only acts from a managed device
  - *Change Manager* — blocked outside published change windows
  - *Computer Use Agent* — requires step-up MFA from the duty manager for destructive actions
- One-click revoke per worker

**[SHOW — Purview Portal]**
- **Agent DLP** policy preventing customer PII from leaving the agent boundary
- **Communication Compliance** — every outbound vendor email scanned before send
- **Insider Risk** — anomalous worker behaviour (e.g., Change Manager raising 50 RFCs at 02:00) auto-flagged
- **Sensitivity labels** auto-applied to KB articles the agent generates
- **Audit log** — every agent action queryable by user, worker, tool, CI

**[TALK TRACK]**
> *"This is the only enterprise-grade governance story in the market for agents. Identity per worker, conditional access per worker, DLP per worker, audit per worker. For FS regulators — FCA, PRA, DORA — this is the evidence pack written for you."*

---

## Act 15: Closing the ITIL 4 Gaps (2 min)  *[ENHANCEMENT]*
### *"Five new workers that close the ITIL 4 gaps."*

**[TALK TRACK]**
> "Beyond the platform-level enhancements, we've added five new workers to round out ITIL 4 and modern Ops practice."

| New Worker | What It Does | Demo Prompt |
|---|---|---|
| **Request Fulfilment Manager** | Catalogue items, standard changes, JML automation via Entra/HR | *"Onboard Sarah Chen as a new Risk Analyst — full JML."* |
| **Major Incident Commander** | Bridge, war-room Loop, exec comms every 30 min, 1h post-mortem draft | *(Act 10 above)* |
| **Knowledge Harvester** | Every resolved incident → draft KB article → Knowledge Manager review → publish + index | *"Harvest yesterday's resolved incidents into draft KB articles."* |
| **FinOps Manager** | Links ServiceNow CIs to Azure Cost Management, surfaces waste, recommends right-sizing as standard changes | *"Show me top 10 cost-waste CIs this month and draft the right-sizing RFCs."* |
| **SRE / Error Budget Manager** | SLO/SLI tracking per service; when budget burns, auto-creates Problems and pauses non-critical Releases | *"What's the error budget on the Online Banking service this quarter?"* |

> *"That's 18 workers now, fully ITIL 4 aligned, with FinOps and SRE built in — not bolted on."*

---

## Closing (30 sec)

> "What you've seen today is a **full ITSM Operations platform** built on M365 Copilot:
>
> **Shipping today**
> - **12 interactive UI widgets** covering incidents, problems, changes, SLAs, assets, knowledge, and blast radius
> - **35+ tools** across 8 ITIL V4 practices with NIST 800-53 governance
> - **Autonomous Digital Worker** with shift handover, incident monitoring, and proactive alerting
> - **Voice interface** with 19 voice-enabled tools for hands-free NOC operations
> - **Live ServiceNow data** across 7 tables: incidents, problems, changes, CMDB, SLAs, knowledge, assets
> - **Every item clickable** — deep links from every widget directly into ServiceNow
>
> **Next-wave enhancements (Acts 10–15)**
> - **Microsoft Agent Framework + Magentic-One** orchestration with Magentic-UI plan approval
> - **Computer Use Agent** for legacy consoles and vendor portals — Purview-governed, video-audited
> - **Copilot Tuning** on runbooks + KEDB for house-style resolutions
> - **Reasoning models** (o-series) for audit-grade RCA with visible chain-of-thought
> - **Loop CAB** in Teams + Outlook with Adaptive Card Universal Actions
> - **Microsoft Fabric Real-Time Intelligence** as the event spine
> - **Entra Agent ID + Conditional Access + Purview Agent DLP** governance
> - **Five new ITIL 4 workers** — Request Fulfilment, Major Incident Command, Knowledge Harvester, FinOps, SRE/Error Budget
>
> Three layers, now four: **Declarative Agent** + **Multi-Agent Digital Workforce** (Magentic-One on Agent Framework) + **Voice & Avatar** + **Governance Spine** (Entra + Purview + Fabric).
>
> This transforms IT Operations from a reactive, multi-tool process into a **unified, proactive, frontier-AI operations centre — with FS-grade governance baked in**."

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
+-------------------------------------------------------------------+
|   M365 Copilot Frontend     |   Voice + Avatar (Speech / Live)    |
|   Declarative Agent         |   NOC wall-screen photoreal avatar  |
|   12 Interactive UI Widgets |   Full-duplex, interruptible        |
+-------------------------------------------------------------------+
|        Microsoft Agent Framework  +  Magentic-One Orchestrator    |
|   Task Ledger | Progress Ledger | Magentic-UI plan approval gate  |
+-------------------------------------------------------------------+
|             18 ITIL 4 Specialist Workers (per-worker Entra ID)    |
|   Incident | Problem | Change | Release | Deployment | Knowledge  |
|   Service Desk | Asset/CMDB | Catalogue | Service Validation      |
|   Major Incident Cmdr | Request Fulfilment | Knowledge Harvester  |
|   FinOps | SRE/Error Budget | SecOps | SecGov | Vendor | Capacity |
|   + Computer Use Agent (legacy consoles, vendor portals)          |
+-------------------------------------------------------------------+
|   ITSM Ops MCP (35+ tools) | EOL MCP | NLWeb Runbook MCP          |
+-------------------------------------------------------------------+
|   ServiceNow Table API | Azure OpenAI (incl. o-series reasoning)  |
|   Copilot Tuning (house-style fine-tune on runbooks + KEDB)       |
|   Microsoft Fabric Real-Time Intelligence                         |
|     Eventstream -> KQL DB -> Activator -> Real-Time Dashboard     |
|   Defender XDR | Sentinel | Azure Monitor | endoflife.date        |
+-------------------------------------------------------------------+
|   GOVERNANCE SPINE                                                |
|   Entra Agent ID + Conditional Access (per worker)                |
|   Purview: Agent DLP | Comms Compliance | Insider Risk | Audit    |
|   Stream recording of every Computer Use session                  |
+-------------------------------------------------------------------+
|   Surfaces: Teams + Outlook Loop CAB | Adaptive Card Universal     |
|   Actions | SharePoint minutes | Status page | Email digests       |
+-------------------------------------------------------------------+
         Azure Container Apps  +  Azure AI Foundry
         portfolioagentacr.azurecr.io
         change-mgmt-mcp:v6 + itsm-worker:v4 + maf-orchestrator:v1
```

---

## Four Layers of Intelligence

| Layer | What It Does | How It Works |
|-------|-------------|--------------|
| **Declarative Agent** | Ask and answer — interactive ITSM operations | M365 Copilot + MCP Server + 12 widgets |
| **Multi-Agent Digital Workforce** | 18 ITIL 4 workers + CUA, orchestrated by Magentic-One on Microsoft Agent Framework, with Magentic-UI human-in-the-loop | MAF + AutoGen patterns + Azure AI Foundry + per-worker Entra Agent ID |
| **Voice & Avatar** | Hands-free NOC operations + photoreal wall-screen avatar | Azure Voice Live + Speech Avatar + WebSocket proxy + 19 tools |
| **Governance Spine** | Identity, access, DLP, compliance, audit — per worker | Entra Agent ID + Conditional Access + Purview (Agent DLP, Comms Compliance, Insider Risk) + Fabric audit telemetry |

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

---

## The Workflow Story — Enhanced Edition  *[ENHANCEMENT]*

> **08:00 — Shift Starts** → Digital Worker sends handover briefing; **avatar greets the duty manager** on the NOC wall screen
>
> **09:30 — P1 Hits** → "Online banking login failures." → **Magentic-One Major Incident Command** spins up: Task Ledger built, Teams bridge live, Stream recording on, Comms agent drafting exec update — Duty Manager **approves the plan in Magentic-UI**
>
> **09:45 — Legacy Console** → Network agent delegates to **Computer Use Agent** to clear the F5 LTM pool member — Purview-governed, session video-recorded
>
> **10:30 — RCA** → Reasoning model (o-series) drafts **chain-of-thought RCA** into Problem record; Knowledge Harvester drafts the new KEDB article
>
> **11:00 — CAB** → **Loop CAB component** opens in Teams + Outlook; agent tables 12 RFCs, scores risk from **Fabric KQL** telemetry, collects votes via Adaptive Card Universal Actions
>
> **14:00 — FinOps** → FinOps worker surfaces top-10 cost-waste CIs, drafts right-sizing RFCs as standard changes
>
> **16:00 — JML** → Request Fulfilment worker onboards a new joiner end-to-end via Entra + HR + ServiceNow catalogue
>
> **17:00 — Error Budget Check** → SRE worker reports Online Banking has 38% budget left this quarter; non-critical Releases auto-paused if it drops below 10%
>
> **All Day — Governance** → Every action logged through **Entra Agent ID + Purview Agent DLP**; Insider Risk auto-flags anomalies; FCA/PRA/DORA evidence pack assembled automatically
