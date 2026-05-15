# Full Working Demo Plan — DA + Agent Alex

**Date:** 2026-05-14  
**Audience:** IT Ops managers, CAB stakeholders, platform operators  
**Target duration:** 18–25 minutes end-to-end

---

## 1) What this demo proves

This plan demonstrates two connected but distinct surfaces:

1. **DA (M365 Copilot Declarative Agent)** for manager-facing decisions and artifacts.
2. **Agent Alex (Digital Worker + Mission Control)** for operator-facing control, governance, and autonomous execution.

**Proof outcomes:**
- DA can produce operational insight artifacts directly in Copilot.
- Alex runtime can execute routines/signals, expose governance state, and provide operator controls.
- Both surfaces are consistent with ServiceNow-backed ITSM workflows.

---

## 2) Architecture split to explain up front (30 seconds)

Use this exact positioning:

- **DA surface:** interactive Copilot widgets via MCP tools (manager lens).
- **Alex runtime surface:** mission-control + APIs + routines/signals (operator lens).
- **Shared data backbone:** ServiceNow + enrichment + Microsoft ecosystem integrations.

This avoids the common confusion where people assume DA directly executes background autonomous workflows.

---

## 3) Demo day roles

- **Presenter A (Manager Journey):** drives DA prompts in M365 Copilot.
- **Presenter B (Operator Journey):** drives Mission Control and runtime/API validation views.
- **Producer (optional):** watches logs/status and handles fallback branches.

---

## 4) T-24h hardening checklist

### DA readiness
- Confirm `appPackage/declarativeAgent.json` conversation starters are visible in Copilot.
- Validate widget tools respond for:
  - `show-itsm-briefing`
  - `show-estate-heatmap`
  - `show-change-collisions`
  - `show-cab-pack`
  - `show-time-travel`
  - `show-outcome-story`
- Ensure seeded incident ID for outcome story exists (example in script uses `INC0010001` / `INC0011423`).

### Agent Alex readiness
- Confirm Digital Worker `/api/health` is healthy.
- Confirm Mission Control loads (`/mission-control`).
- Confirm routines endpoint responds (`/api/routines`).
- Confirm outcomes endpoint responds (`/api/outcomes`).
- Confirm cognition graph responds (`/api/cognition/graph`).

### Scheduler reality check
- If Azure Functions scheduler is not deployed, call this out explicitly and run routines manually via Alex endpoints or Mission Control actions.
- If scheduler is deployed, verify timers are firing (major-incident bridge, SLA prediction, etc.).

---

## 5) T-60m live preflight (must-pass)

1. **Seed data in DA**
   - Run the DA prompt: “Seed the ServiceNow dev instance with demo data”.
   - Wait for confirmation.

2. **Warm DA widgets**
   - Execute one low-risk starter prompt to confirm render path and response speed.

3. **Warm Alex runtime**
   - Hit health/routines/outcomes endpoints.
   - Verify at least one recent routine completion appears.

4. **Governance banner check**
   - Confirm kill/freeze is not engaged unless intentionally demonstrating controls.

5. **Known-risk mitigation**
   - Recent validation showed occasional timeout on `incident.high` signal path.
   - Keep a backup signal scenario ready (`change.high`, `problem.repeat`, `sla.atRisk`, `em_event.high`) for deterministic live flow.

---

## 6) Live run-of-show (primary path)

## Phase A — DA manager narrative (6–8 min)

Use this flow from `DEMO-SCRIPT.md`:

1. **Overnight briefing**  
   Prompt: *“Brief me on overnight ops.”*  
   Expected: command bridge / top actions / KPI band.

2. **Heatmap**  
   Prompt: *“Where is the heat right now?”*  
   Expected: estate heatmap with tier and criticality cues.

3. **Change safety**  
   Prompt: *“Are tonight’s changes safe to run together?”*  
   Expected: collision highlight and risk summary.

4. **CAB artifact**  
   Prompt: *“Generate this week’s CAB pack.”*  
   Expected: printable package with risk, backout visibility, NIST references.

5. **Time-travel risk**  
   Prompt: *“Time-travel: what breaks in 6 months?”*  
   Expected: EOL risk progression and tier-1 focus.

6. **Resolution story**  
   Prompt: *“Tell the resolution story for INC0010001.”*  
   Expected: narrative card with timeline and operational facts.

### DA success criteria
- At least 5 of 6 widgets render correctly.
- CAB pack and outcome story are shown as takeaway artifacts.
- No ad-hoc hidden tooling required during presentation.

---

## Phase B — Agent Alex operator narrative (7–10 min)

Open Mission Control and walk the seven panels (from script guidance), then demonstrate automated workflows.

### Mission Control panels (5 min)

1. **Trust Score** — Current AlexTrustScore (0–100), latest red-team probe count and verdict spread.  
   *Talk:* "This number is the platform's continuous self-grade. When it dips under 70, the dispatcher routes high-blast work through reviewer-worker."  
   **Expected:** Score display, probe history, breakdown by attack vector (jailbreak, prompt-injection, scope-escape).

2. **Pending Reviews** — Workflows held by reviewer-worker with gate reasons.  
   *Talk:* "When a tool call has a destructive verb, missing rollback, or blast radius ≥0.8, it stops here for human sign-off."  
   **Expected:** List of held actions, each showing the four inspect rules that fired, approve/block buttons.

3. **Cases** — Open / pending / working counts and activity timeline.  
   **Expected:** Case summary cards, click one to show audit trail + enrichment provenance with citations.

4. **Voice Queue** (optional if stable) — Pending voice approvals waiting on TTS confirmation.  
   **Expected:** Queue list, optional: speak "approve it" into headset and watch row clear.

5. **A2A Activity** — Inbound Agent-to-Agent attempts, top callers, reject reasons.  
   **Expected:** Activity heatmap, summary of denied scopes.

6. **Meta Alerts** — Recent alerts from platform self-monitoring (trust-score-low, high-block-rate, etc).  
   *Talk:* "This is the platform watching itself. If these go red, the ops team escalates to the Foundry team."  
   **Expected:** Alert list with timestamps and severity.

7. **Killed/Frozen** — Big red banner if kill-switch is engaged.  
   *Talk:* "One toggle: all tools refuse, every audit row carries the kill flag. Full lockdown in under 10 milliseconds."  
   **Expected:** Toggle visibility, lock status, last engaged timestamp (if active).

---

### Automated workflow execution (5 min)

Now demonstrate that Alex *executes* workflows autonomously. Show **two** of the following:

#### Option A: Trigger a real scheduled routine (fastest demo)
**Action:** Call Alex API or Mission Control button to trigger **major-incident-bridge** routine.  
**Expected outcome:**
- Routine starts and completes in ~3 sec.
- Output shows: new P1/P2 incidents detected, Teams bridge channel creation, stakeholder notifications, incident details posted.
- Outcome recorded in `/api/outcomes` with timestamp and worker attribution.

**Talk:** *"Every 5 minutes, Alex scans for new P1s and P2s. If found, it creates a Teams incident bridge, notifies resolver groups, and posts impact assessment. No human pre-staged it; the routine is autonomous."*

#### Option B: Trigger a signal-driven workflow (dramatic live execution)
**Action:** Call `/api/signals` endpoint with a deterministic signal:  
```json
{
  "signal": {
    "id": "demo-sla-breach-12345",
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

**Expected outcome:**
- Signal ingested (202 Accepted).
- Within 15–20 sec, SLA Manager runs autonomously:
  - Escalates ticket priority.
  - Notifies on-call group + manager.
  - Posts escalation card to Teams.
  - Records action in audit trail.
- Outcome shows in `/api/outcomes` with label `sla-breach-escalation`.

**Talk:** *"Live SLA breach signal → escalation within 20 seconds. The manager gets a Teams notification, ticket moves to P1, on-call is paged. All audit-logged."*

**Preferred signal types for live demo:**
- `sla.atRisk` — fast, reliable, SLA escalation path is always active.
- `change.high` — triggers change-risk briefing and emergency CAB flow.
- `problem.repeat` — triggers problem record creation and KB gap analysis.
- `em_event.high` — generic monitoring alert, triggers incident bridge.

*(Avoid `incident.high` if last validation showed timeout — use fallback.)*

#### Option C: Show workflow queuing and approval flow (governance demonstration)
**Action:** Show `/api/reviews` endpoint or Mission Control review queue.  
**Expected:** Inspect rules display, approve/block buttons, audit trail.  
**Talk:** *"This is the governance layer. Before any high-blast action, the reviewer worker double-checks: Is this destructive? Is there a rollback? What's the scope? If gates fail, it stops here—no execution without human eyes."*

---

### Alex success criteria
- Mission Control loads and updates in near-real-time (< 2 sec refresh).
- At least one scheduled routine **completes end-to-end** (major-incident-bridge is fastest at ~2–3 sec).
- At least one signal-driven path is demonstrated (sla.atRisk preferred for determinism).
- Governance layer (Trust Score, Pending Reviews, Kill/Freeze state) is visibly present.
- Operator can point to audit trail and explain the autonomous action was logged.

---

## Phase C — Executable E2E workflows Alex can perform (reference for detailed demo)

If you have extra time or want to deep-dive, Alex can run **any of these 20 routines** autonomously:

### Incident Management (2 routines)
- **incident-stale-check** (every 4h) → Find incidents with no updates in 24+ hours; flag P1/P2 as critical.
- **incident-recurring-pattern** (weekly Mon 06:00) → Analyze 7-day patterns; recommend problem record creation.

### SLA Management (2 routines)
- **sla-breach-prediction** (every 30 min) → Check SLAs at risk of breach in next 2 hours; recommend escalations.
- **sla-breach-escalation** (every 30 min) → Auto-escalate tickets breaching in next 60 minutes; notify on-call.

### Change Management (4 routines)
- **change-collision-check** (weekdays 07:00) → Detect overlapping changes on same CI in next 48h; recommend rescheduling.
- **change-pir-overdue** (Wed 09:00) → Flag changes closed 5+ days without post-implementation review.
- **monday-cab-prep** (Mon 07:00) → Query week's changes, generate CAB packs, send meeting invites and post agenda.
- **emergency-change-fast-track** (every 15 min) → Check for emergency CRs; validate justification; initiate fast-track approval.

### Vendor Management (2 routines)
- **vendor-contract-expiry** (Mon 08:00) → Check contracts expiring in 30/60/90 days; categorize urgency.
- **vendor-license-compliance** (1st month 08:00) → Audit entitled vs. deployed licenses; flag over/under-deployment.

### Knowledge Management (1 routine)
- **knowledge-gap-analysis** (Fri 07:00) → Compare incident categories vs. KB articles; recommend articles by volume.

### Asset & CMDB Management (2 routines)
- **asset-eol-scan** (1st month 06:00) → Lifecycle scan: GREEN/YELLOW/RED; recommend remediation for RED.
- **asset-warranty-check** (15th month 06:00) → Flag hardware with warranties expiring in 90 days.

### Problem Management (1 routine)
- **problem-kedb-review** (Thu 09:00) → Review KEDB; flag stale workarounds, needed RCAs, missing CRs.

### Autonomous Actions (3 routines)
- **major-incident-bridge** (every 5 min) → Detect new P1/P2; create Teams bridge; notify resolvers; post impact. **← FASTEST LIVE DEMO**
- **incident-to-problem-promotion** (every 2h) → Find recurring patterns (3+ incidents); create problem records.
- **daily-ops-standup** (weekdays 08:00) → Generate morning ops briefing; post to Teams.

### Continuous Quality (2 routines)
- **cmdb-health-audit** (daily 02:00) → Audit CMDB: missing attributes, orphaned CIs, stale records, relationship integrity.
- **post-incident-kb-capture** (hourly) → Find resolved incidents without KB articles; draft articles for review.

### Reporting (1 routine)
- **monthly-health-report** (1st month 06:00) → Comprehensive ITSM health: KPIs, trends, vendor scorecard; distribute to leadership.

**Recommended live-demo routine:** `major-incident-bridge` (completes in ~2–3 sec, always has deterministic output).

---

## Phase C-optional — KEV enrichment beat (60–90 sec)

*Skip if time is tight; include only if you want to show external signal mapping.*

Run the enrichment KEV scenario:
- Seed a CISA KEV match signal (e.g., CVE-2021-44228 Log4Shell matching a CMDB asset).
- Watch Alex enrich it with CISA metadata and create a P1 incident in ServiceNow within 60 seconds.
- Show incident worknote with CISA citation embedded.
- Explain: *"Live KEV match → P1 in SNOW with CISA citation, in under 60 seconds, against demo fixtures. No human pre-staged it. Alex saw the catalogue, matched it to inventory, and acted."*

---

## 7) Contingency matrix (what to do live)

### If DA widget fails to render
- Retry once with a semantically equivalent starter prompt.
- Move to next DA act; return later.
- Keep CAB pack + outcome story as minimum required DA artifact proof.

### If ServiceNow data is sparse/unexpected
- Re-run seed step.
- Switch to known seeded incident ID.
- Narrate this as “fresh environment drift” and continue with architecture/governance proof.

### If Alex signal route is slow/timeout
- Switch immediately to alternate signal class. **Priority order:**
  1. `sla.atRisk` — most deterministic, SLA escalation path always active.
  n2. `change.high` → change-risk briefing + emergency CAB flow.
  3. `problem.repeat` → problem record creation.
  4. `em_event.high` → generic monitoring alert.
- Continue with outcomes and audit visibility instead of waiting on first signal class.
- Talk track: *"Signal path latency detected; switching to alternate scenario to keep energy high."*

### If scheduler isn't active (known for May 2026 deployment)
- State clearly: *"Scheduler is not deployed yet; we'll use direct API trigger to show routine execution."*
- Demonstrate manual trigger via POST `/api/scheduled` with `routineId: major-incident-bridge`.
- Show outcome in `/api/outcomes` and explain: *"In production, this same routine fires every 5 minutes autonomously via Azure Functions timers."*
- No loss of credibility; shows you understand the deployment topology.

### If mission-control panel stalls
- Refresh once.
- Continue using API-backed evidence from health/routines/outcomes/cognition endpoints.

---

## 8) Post-demo evidence pack (send within 15 minutes)

Deliver these immediately after session:
- Screenshot set: DA key artifacts + Mission Control trust/review panels.
- One JSON excerpt of recent outcomes.
- One sentence each for:
  - Manager value (DA)
  - Operator value (Alex)
  - Governance value (review/kill/audit)

---

## 9) Suggested talk track close (30 seconds)

*"Today you saw two working surfaces of one ITSM operating model:*

*The **Copilot DA** is the manager lens — six interactive widgets answering questions like 'Where is the heat?' and 'Is this change safe?' Every screen renders live data; every CAB pack is audit-ready with NIST controls cited.*

*The **Agent Alex** is the operator lens — 20 autonomous routines running on schedule, signal-driven workflows responding to incidents and SLA breaches in seconds, and a governance layer that stops high-risk actions before they run.*

*Together, they transform ITSM from reactive ticket updates into an auditable operating system. You get decision artifacts on demand, autonomous action with human gates, and continuous learning from every outcome. And it all runs inside your Microsoft 365 tenant — no separate portal, no VPN, no hiding in another tool.*

*Let me show you what we're building next...*"

---

## 10) Minimal execution checklist (for presenter clipboard)

### Pre-demo (T-60 min)
- [ ] Health check: `/api/health` → ok
- [ ] Seed demo data: run DA prompt *"Seed the ServiceNow dev instance with demo data"*
- [ ] Verify DA starters visible in Copilot
- [ ] Verify incident ID exists for outcome story (example: INC0010001)

### During demo

**Phase A (DA manager, ~8 min)**
- [ ] Act 1: *"Brief me on overnight ops"* → command bridge renders
- [ ] Act 2: *"Where is the heat right now?"* → heatmap renders
- [ ] Act 3: *"Are tonight's changes safe?"* → collision detection renders
- [ ] Act 4: *"Generate this week's CAB pack"* → CAB pack renders + Print works
- [ ] Act 5: *"Time-travel: what breaks in 6 months?"* → timeline slider works
- [ ] Act 6: *"Tell the resolution story for INC0010001"* → outcome story renders

**Phase B (Alex operator, ~7 min)**
- [ ] Mission Control loads
- [ ] Trust Score visible
- [ ] Pending Reviews shown
- [ ] Trigger major-incident-bridge routine (fastest path)
- [ ] Outcome appears in `/api/outcomes` within 10 sec
- [ ] Show audit trail / governance layer

**Phase C (Wrap-up, ~2 min)**
- [ ] Deliver closing talk track
- [ ] Optional: show one more routine or KEV enrichment if time permits

### Post-demo (T+15 min)
- [ ] Screenshot evidence pack (DA acts + Mission Control)
- [ ] Export outcomes JSON
- [ ] Note any signal timeouts or scheduler issues for next run
