# Full Working Demo Plan — DA + Agent Alex  
## WITH EXACT PROMPTS, EXPECTED OUTCOMES & E2E WORKFLOWS

**Date:** 2026-05-14  
**Audience:** IT Ops managers, CAB stakeholders, platform operators  
**Target duration:** 18–25 minutes end-to-end  
**Format:** Two-presenter show (Manager + Operator lens)

---

## Architecture Split (explain first, 30 sec)

- **DA surface:** Interactive Copilot widgets answering manager questions (read-only insights)
- **Alex runtime:** Mission Control + APIs + 20 scheduled routines + signal-driven workflows (autonomous execution)
- **Shared backbone:** ServiceNow + Microsoft 365 + enrichment APIs

---

## PHASE A — DA Manager Narrative (8 min)

All 6 prompts, expected outputs, and talk tracks:

### Prompt 1: Overnight Operations Briefing
**What to say:** *"Brief me on overnight ops."*  
**Which tool:** `show-command-bridge`  
**Expected to see:**
- Hero status band at top (green/amber/red gradient with glow effect on critical)
- Three animated KPI tiles: **Open P1s**, **SLAs at Risk**, **Approvals Waiting** (count-up animation on load)
- Four estate-health rings: Incidents / Changes / Problems / SLAs (donut charts with percentage)
- **Top 5 Actions** list: ranked by urgency, each clickable to drill deeper
- Footer showing NIST CSF Functions engaged (Govern, Identify, Protect, Detect, Respond, Recover)

**How long:** 90 sec (let it load, explain KPIs, point to the action list)  
**Talk:** *"This is the first thing the on-call manager sees. One screen, every signal, ranked. The green/amber/red band tells you overall health instantly. Those five actions are what needs hands-on attention right now."*

---

### Prompt 2: Where Is the Heat Right Now?
**What to say:** *"Where is the heat right now? Show me which Tier-1 services are degraded."*  
**Which tool:** `show-estate-heatmap`  
**Expected to see:**
- Treemap grid of CMDB CIs (each box = a CI)
  - Box size = tier (Tier-1 CIs are 2× larger)
  - Box color = health (green / amber / red)
  - Critical CIs have a subtle pulse animation
- Filter chips above (All / Tier 1 / Tier 2 / Tier 3)
- Hover any CI → tooltip with: class, tier, health status, active incident count, last change date
- KPI bar at bottom: % healthy by tier

**How long:** 75 sec  
**Talk:** *"At a glance, the manager knows which production tier is bleeding. Red = active incidents. The pulse = SLA at critical risk. Click on a red CI to see its incident history and what changed recently. This is the view they use to decide if the platform is safe for customer traffic."*

---

### Prompt 3: Are Tonight's Changes Safe?
**What to say:** *"Are tonight's changes safe to run together? Check for collisions in the next 24 hours."*  
**Which tool:** `show-change-collisions`  
**Expected to see:**
- 14-day calendar grid with CI label column on left
- Each change = colored bar in a day cell
  - Green bar = low-risk change
  - Amber bar = moderate-risk change
  - Red bar = collision detected (two changes on same CI, overlapping windows)
  - Red bars have a subtle side-to-side nudge animation
- **Collisions** section below listing each pair:
  - Change 1 number & window
  - Change 2 number & window
  - Risk score for each
  - Recommendation (reschedule, serial execution, etc.)
- KPI summary: **Scheduled** (next 7d), **Tonight** (≤24h), **Collisions** (count), **Emergency CRs** (count)

**How long:** 90 sec  
**Talk:** *"Two database changes on db-01 tonight, 30 minutes apart. The DA flagged it red—collision detected. The manager can unblock this right now by rescheduling one, hours before the CAB even meets. NIST CM-3 (Configuration Change Control) requires impact analysis before every change; this widget *is* the impact analysis."*

---

### Prompt 4: Generate CAB Pack (THE ARTIFACT)
**What to say:** *"Generate this week's CAB pack for the next meeting."*  
**Which tool:** `show-cab-pack`  
**Expected to see:**
- Print-ready layout (toolbar with Print / Distribute buttons visible at top)
- KPI header banner:
  - **Changes for review** (count)
  - **High/Critical risk** (count)
  - **Missing backout plan** (RED flag if present)
  - Approve / Defer / Reject recommendation percentages
- Per-change-request card (repeat for each CR):
  - Change number (e.g., CHG0099001) + title
  - Risk badge (e.g., 18/25 = Moderate-High per NIST 800-30)
  - Type (Standard / Normal / Emergency), CI, maintenance window, requestor
  - Short description + full backout plan (RED MISSING stamp if absent)
  - Test plan + EOL implications (if any affected assets are at EOL)
  - NIST control pills: **CM-3** (change control), **CM-4** (impact analysis), **RA-3** (risk assessment), **CP-2** (contingency)
  - Mini blast-radius SVG: upstream service → CI → downstream service (3-node dependency graph)
  - Recommendation block: **Approve** / **Defer** / **Reject** with reasoning (e.g., "Approve: risk is mitigated by rollback plan + low deployment window")
- Footer: ServiceNow record link, assignment group, legal/audit disclaimer

**DEMO TRICK:** Click the **Print** button on one card. Watch the toolbar fade, animations stop, footer minimizes. You're left with a clean PDF. This is what the CAB chair emails to the steering committee.

**How long:** 90 sec  
**Talk:** *"This is the artefact. Managers generate this Tuesday afternoon and send to their boss. Every control ID is in there. Every backout plan is visible. This CAB pack is production-ready; it's already been printed and emailed in real environments."*

---

### Prompt 5: Time-Travel EOL Risk
**What to say:** *"Time-travel: what breaks in 6 months? Show me which Tier-1 assets are at EOL risk."*  
**Which tool:** `show-time-travel`  
**Expected to see:**
- Horizontal gradient timeline bar: 0 mo (today) → 24 mo (future)
  - Color gradient: green (safe) → amber (at-risk) → red (EOL/non-compliant)
- Drag slider left/right, or click buttons: **+3mo** / **+6mo** / **+12mo** / **+24mo**
- Asset list below the timeline:
  - As you drag slider forward, assets animate red as they cross their EOL date
  - Tier-1 assets glow / pulse with highest visual emphasis
  - Each asset shows: name, type, current support end date, status (GREEN/YELLOW/RED)
- KPI summary top-right:
  - Total tracked assets
  - EOL within 6 months (count)
  - EOL within 12 months (count)
  - Already past-EOL / non-compliant (count & red banner)
- NIST citations: **SI-2** (Flaw Remediation) + **FIPS 199** (System Categorization)

**How long:** 60 sec  
**Talk:** *"Drag the slider to 6 months. See Windows Server 2019? It goes red. We have 14 production servers hitting EOL in the next 6 months. The timeline shows the risk. This forecast drives the modernization roadmap—no surprises in the CAB meeting."*

---

### Prompt 6: Resolution Story (THE NARRATIVE)
**What to say:** *"Tell the resolution story for incident INC0010001."*  
**Which tool:** `show-outcome-story`  
**Expected to see:**
- Large hero number center-top: **42 minutes to resolve** (or actual time from incident)
- Resolution timestamp + date (e.g., "Resolved on May 14, 2026 at 14:33 UTC")
- Attributed quote block (italicized, attributed to engineer):
  - *"Database failover was initiated at 14:22 after we detected the primary replica had exhausted transaction log space. Automated recovery kicked in and restored normal throughput by 14:33."*
  - — Sarah Chen, Senior DBA, Database Systems team
- Quick facts section (bullet list):
  - **Status:** Resolved ✓
  - **Affected CI:** svc-payments-api (production)
  - **Lead Engineer:** Sarah Chen
  - **Priority:** P1
  - **SLA:** P1-Resolution (4-hour) — **MET ✓** (resolved in 42 minutes)
- Timeline strip (horizontal flow):
  - **Created** (14:23) → **Assigned** (14:24) → **In Progress** (14:25) → **Resolved** (14:33)
  - Each state shows timestamp + who made transition
  - Color-coded by urgency
- Sidebar (right): Related incidents / problems / changes
- Footer: ServiceNow record link + Audit trail link

**How long:** 60 sec  
**Talk:** *"This is what the manager forwards to their boss Friday afternoon. It's the resolution narrative—pulled straight from ServiceNow worknotes. No fabrication. It tells the story: what broke, who fixed it, how long it took, and what we learned."*

---

### DA Phase Success Criteria
✓ At least 5 of 6 prompts render correctly  
✓ CAB pack optional-print works  
✓ Outcome story demonstrates artifact generation  
✓ Every widget shows manager-grade decision-making (risk scores, NIST citations, ranked actions)

---

## PHASE B — Agent Alex Operator Narrative (9 min)

Shift to operator lens. Open Mission Control.

### Mission Control: Seven panels (4 min)

1. **Trust Score**  
   - Display: Current AlexTrustScore (0–100), e.g., "87 — Platform healthy"
   - Red-team probe history: last 5 probes, verdict (pass/fail per attack vector)
   - Talk: *"This is the platform's continuous self-grade. When it dips under 70, the dispatcher routes high-blast work through reviewer-worker. We auto-publish the score; it's auditable."*

2. **Pending Reviews**  
   - Display: Queue of workflows held by reviewer-worker
   - Each row shows: action (e.g., "Escalate INC0010099 to P1"), four inspect rules that fired, Approve / Block buttons
   - Talk: *"When an action is destructive, missing rollback, or has blast radius ≥0.8, it stops here. No execution without human eyes."*

3. **Cases**  
   - Display: Open/pending/working counts, activity timeline
   - Click a case → show audit trail + enrichment provenance with citations

4. **Voice Queue** (optional)  
   - Display: Pending voice approvals, TTS confirmation wait states

5. **A2A Activity**  
   - Display: Inbound Agent-to-Agent call attempts, top callers, deny reasons

6. **Meta Alerts**  
   - Display: Recent alerts (trust-score-low, high-block-rate, etc.), timestamp, severity
   - Talk: *"This is the platform watching itself."*

7. **Killed/Frozen**  
   - Display: Big red/gray banner if kill-switch or freeze is engaged
   - Talk: *"One toggle—all tools refuse, every audit row carries the kill flag. Full lockdown in under 10 ms."*

---

### Autonomous Workflow Execution Demo (5 min)

Now prove that Alex **executes** workflows. Show **one** (or more if time):

#### Option A: Trigger a Scheduled Routine (FASTEST — ~3 sec end-to-end)
**Action:** POST to `/api/scheduled` with:
```json
{ "routineId": "major-incident-bridge" }
```
Or click button in Mission Control.

**Expected outcome in ~3 sec:**
- Routine completes
- Output: "Detected 1 new P1 incident. Creating Teams incident bridge. Notifying resolver groups. Posting impact assessment to bridge channel."
- Outcome recorded in `/api/outcomes` with timestamp, worker=incident-manager, label=major-incident-bridge

**Talk:** *"Every 5 minutes, Alex scans for new P1/P2s. If found, it creates a Teams incident bridge, notifies resolver groups, and posts impact assessment. No human pre-staged it; the routine is autonomous. We can run it on-demand for demo."*

---

#### Option B: Trigger a Signal-Driven Workflow (DRAMATIC LIVE EXECUTION — 15–20 sec)
**Action:** POST to `/api/signals` with:
```json
{
  "signal": {
    "id": "demo-sla-12345",
    "source": "servicenow",
    "type": "sla.atRisk",
    "severity": "high",
    "asset": "svc-helpdesk",
    "payload": {
      "ticketId": "INC0010099",
      "minutesRemaining": 45,
      "sla": "P1-resolution"
    },
    "occurredAt": "2026-05-14T16:45:00Z",
    "origin": "observed"
  }
}
```

**Expected outcome in 15–20 sec:**
- Signal ingested (202 Accepted)
- SLA Manager runs autonomously:
  - Escalates ticket priority to P1 in ServiceNow
  - Notifies on-call group + manager via Teams
  - Posts escalation card: "SLA P1-resolution at risk. 45 minutes remaining. Escalating to on-call."
  - Records action in audit trail
- Outcome shows in `/api/outcomes` with label=sla-breach-escalation

**Talk:** *"Live SLA breach signal → escalation in 20 seconds. The manager gets a Teams notification. The ticket moves to P1. On-call is paged. All audit-logged."*

**Best signal types for deterministic demo (in order):**
1. `sla.atRisk` ← PREFERRED (SLA path always active, fast)
2. `change.high` → emergency CAB flow
3. `problem.repeat` → problem record creation
4. `em_event.high` → generic monitoring alert

*(Avoid `incident.high` if last validation showed timeout.)*

---

#### Option C: Show Governance Gate (POLICY DEMONSTRATION)
**Action:** Show `/api/reviews` endpoint or Mission Control review queue.  
**Talk:** *"This is the governance layer. Before any high-blast action, the reviewer worker double-checks: Is this destructive? Is there a rollback? What's the scope? If gates fail, it stops here—no execution without human eyes."*

---

### Alex Phase Success Criteria
✓ Mission Control loads and refreshes < 2 sec  
✓ One scheduled routine completes end-to-end (major-incident-bridge ~3 sec)  
✓ One signal-driven workflow demonstrated (sla.atRisk preferred)  
✓ Governance layer visible (Trust Score, Pending Reviews, Kill/Freeze)  
✓ Audit trail shown for every autonomous action

---

## PHASE C (Optional) — All 20 Executable E2E Workflows

If time permits, list what Alex can *autonomously* run on schedule or via signal:

### Incident Management (2)
- **incident-stale-check** (every 4h) — Find incidents with no updates in 24+ hours; flag P1/P2.
- **incident-recurring-pattern** (Mon 06:00) — Analyze 7-day patterns; recommend problem creation.

### SLA Management (2)
- **sla-breach-prediction** (every 30 min) — Check SLAs at risk of breach in next 2 hours.
- **sla-breach-escalation** (every 30 min) — Auto-escalate tickets breaching in next 60 minutes.

### Change Management (4)
- **change-collision-check** (weekdays 07:00) — Detect overlapping changes on same CI in 48h.
- **change-pir-overdue** (Wed 09:00) — Flag changes without post-impl review.
- **monday-cab-prep** (Mon 07:00) — Generate CAB packs, send invites, post agenda.
- **emergency-change-fast-track** (every 15 min) — Fast-track approval for emergency CRs.

### Vendor Management (2)
- **vendor-contract-expiry** (Mon 08:00) — Check contracts expiring in 30/60/90 days.
- **vendor-license-compliance** (1st month 08:00) — Audit entitled vs. deployed licenses.

### Knowledge Management (1)
- **knowledge-gap-analysis** (Fri 07:00) — Compare incident categories vs. KB articles.

### Asset & CMDB (2)
- **asset-eol-scan** (1st month 06:00) — Lifecycle scan: GREEN/YELLOW/RED assets.
- **asset-warranty-check** (15th month 06:00) — Flag hardware with warranties expiring 90d.

### Problem Management (1)
- **problem-kedb-review** (Thu 09:00) — Review known error DB; flag stale workarounds.

### Autonomous Actions (3)
- **major-incident-bridge** (every 5 min) — Create Teams bridge for P1/P2 (FASTEST DEMO) ⭐
- **incident-to-problem-promotion** (every 2h) — Auto-create problem records from patterns.
- **daily-ops-standup** (weekdays 08:00) — Generate ops briefing; post to Teams.

### Continuous Quality (2)
- **cmdb-health-audit** (daily 02:00) — Audit CMDB completeness + relationship integrity.
- **post-incident-kb-capture** (hourly) — Draft KB articles from resolved incidents.

### Reporting (1)
- **monthly-health-report** (1st month 06:00) — Monthly ITSM health + KPIs; distribute.

---

## BACKUP / CONTINGENCY PATHS

### If DA widget times out or fails
- Retry once with a semantically equivalent prompt.
- Move to next DA act; circle back later.
- Minimum required: CAB pack + outcome story (both are high-value artifacts).

### If ServiceNow data is sparse
- Re-run seed step: *"Seed the ServiceNow dev instance with demo data"*.
- Switch to known seeded incident ID.
- Continue with architecture/governance proof.

### If Alex signal times out
- **Switch immediately to** (in priority order):
  1. `sla.atRisk` — most deterministic
  2. `change.high` — emergency CAB flow
  3. `problem.repeat` — problem creation
  4. `em_event.high` — monitoring alert
- Continue with outcomes + audit visibility.
- Talk: *"Signal path latency detected; switching scenario to keep energy high."*

### If scheduler isn't deployed
- State clearly: *"Scheduler isn't deployed yet; we'll use direct API trigger."*
- Demonstrate manual POST to `/api/scheduled`.
- Show outcome in `/api/outcomes`.
- Talk: *"In production, this fires every 5 minutes autonomously via Azure Functions."*

### If Mission Control stalls
- Refresh once.
- Fall back to API evidence: `/api/health`, `/api/routines`, `/api/outcomes`, `/api/cognition/graph`.

---

## CLOSING TALK TRACK (30 sec)

*"Today you saw two working surfaces of one ITSM operating model.*

*The **Copilot DA** is the manager lens—six interactive widgets answering questions like 'Where is the heat?' and 'Is this change safe?' Every screen renders live data; every CAB pack is audit-ready with NIST controls cited.*

*The **Agent Alex** is the operator lens—20 autonomous routines running on schedule, signal-driven workflows responding to incidents and SLA breaches in seconds, and a governance layer that stops high-risk actions before they run.*

*Together, they transform ITSM from reactive ticket updates into an auditable operating system. You get decision artifacts on demand, autonomous action with human gates, and continuous learning from every outcome. And it all runs inside your Microsoft 365 tenant—no separate portal, no VPN, no hiding in another tool.*

*This is production-ready. We're shipping it next quarter."*

---

## PRESENTER CHECKLIST

### T-60 min (Pre-demo)
- [ ] `/api/health` returns ok
- [ ] Seed demo data: DA prompt *"Seed the ServiceNow dev instance with demo data"*
- [ ] DA starters visible in Copilot
- [ ] Incident ID INC0010001 exists (or use seeded ID)

### During Demo

**Phase A (DA, ~8 min)**
- [ ] Act 1: *"Brief me on overnight ops"* → command bridge renders
- [ ] Act 2: *"Where is the heat right now?"* → heatmap renders
- [ ] Act 3: *"Are tonight's changes safe?"* → collision detection renders
- [ ] Act 4: *"Generate CAB pack"* → pack renders + Print works
- [ ] Act 5: *"Time-travel: what breaks in 6 months?"* → timeline slider works
- [ ] Act 6: *"Tell resolution story for INC0010001"* → outcome story renders

**Phase B (Alex, ~9 min)**
- [ ] Mission Control loads
- [ ] Trust Score visible
- [ ] Trigger major-incident-bridge routine (completes ~3 sec)
- [ ] Outcome appears in `/api/outcomes` within 10 sec
- [ ] Show audit trail + governance

**Phase C (Wrap-up, ~2 min)**
- [ ] Deliver closing talk
- [ ] Optional: show one more routine if time permits

### T+15 min (Post-demo)
- [ ] Screenshot DA acts + Mission Control
- [ ] Export outcomes JSON
- [ ] Note any timeouts for next run
