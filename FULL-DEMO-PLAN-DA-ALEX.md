# Full Working Demo Plan — DA + Agent Alex

**Date:** 2026-05-16  
**Audience:** IT Ops managers, CAB stakeholders, platform operators, executive sponsors  
**Target duration:** 22–28 minutes end-to-end  
**Killer beat:** Live Teams Adaptive Card HITL approval — Alex pauses a high-risk action, the operator's Teams 1:1 chat with Alex lights up with an Approve/Deny card, one tap from any device unblocks the worker, and the audit trail captures every signature.  
**Live worker:** `itsm-operations-worker.jollysand-88b78b02.eastus.azurecontainerapps.io` — image SHA `159d8cc`, revision `…--0000129`, `PROACTIVE_ENGAGEMENT_ENABLED=true`.

---

## 1) What this demo proves

This plan demonstrates two connected but distinct surfaces, working together against a single ServiceNow backbone:

1. **DA (M365 Copilot Declarative Agent)** — the manager lens. Six interactive widgets answering "where is the heat?", "are tonight's changes safe?", and "what broke in INC0010001?". Every screen is the takeaway artifact.
2. **Agent Alex (Digital Worker + Mission Control)** — the operator lens. 20 autonomous routines on schedule, signal-driven workflows, a real-time governance console, and now a **live Teams Adaptive Card HITL** flow that puts a human in front of every high-risk move without slowing them down.

**Proof outcomes the customer should walk away with:**
- DA produces decision-grade artifacts (CAB pack, outcome story, blast-radius map) on demand inside their existing Copilot.
- Alex runs the night shift autonomously — major-incident bridge, SLA escalation, change collision detection — and **shows its work** in the Mission Control audit trail.
- High-risk actions stop at a Teams Adaptive Card waiting for the operator. They tap Approve from a phone, laptop, or watch; the worker resumes; the audit trail is signed with their name.
- The operator can also approve from a single tap in a styled email — same one-tap GET endpoint, same audit signature, no portal sign-in.
- Voice gives the operator a "Call me now" button — Alex picks up the phone (in English) and briefs them.
- Kill switch + freeze lever are one click away. The platform polices itself with Trust Score + Meta Alerts.

---

## 2) Architecture split to explain up front (30 seconds)

Use this exact positioning:

- **DA surface:** interactive Copilot widgets via MCP tools (manager lens). Pure HTML rendered inline by M365 Copilot via the OpenAI Apps SDK widget protocol — no separate UI.
- **Alex runtime surface:** Mission Control + REST APIs + routines/signals + Teams 1:1 chat + ACS voice (operator lens). Runs on Azure Container Apps + Azure Functions.
- **Shared data backbone:** ServiceNow + endoflife.date + Microsoft Graph + WorkIQ + CISA KEV enrichment.

This avoids the common confusion where people assume DA directly executes background autonomous workflows. The two surfaces share data, not runtime — and that separation is *why* the governance story is credible.

---

## 3) What's NEW since the last demo (live in production today)

Hit these in the open so the customer hears them before they see them:

| Capability | What it means on stage |
| --- | --- |
| **Teams Adaptive Card HITL** | High-risk actions post an interactive card to the operator's 1:1 chat with Alex. Approve/Deny inline. Decision is signed with the operator's identity and drains the live approval queue (`resolveAction(id, decision, actor)`). |
| **One-tap email approval** | Same approval also lands as a formatted HTML email. Tap Approve → `GET /api/approvals/action?id=…&decision=approved&by=…` opens a confirmation page. Works from any mobile mail client, no app, no sign-in. |
| **Live Action Strip on Mission Control** | Four buttons (📧 send manager an update / 📅 schedule a CAB bridge / 📄 publish CAB pack to Teams + email / 📞 call me now). Each is a single click, instant, demoable. |
| **English voice hard-pin** | Alex now speaks English every time (the locale was previously occasionally drifting to German). Tap "Call me" → Alex calls and briefs in English. |
| **Styled HTML emails everywhere** | Manager emails (approvals, shift handover, exception reports) render with a clean dark-theme shell instead of raw Markdown. Forwardable to executives without apology. |
| **Pipeline self-enables HITL** | Every deploy now sets `PROACTIVE_ENGAGEMENT_ENABLED=true` on the worker so the Teams card path can never be silently off in production. |

If only one of these makes it on screen, make it the **Adaptive Card**. That's the moment that converts skepticism into excitement.

---

## 4) Demo day roles

- **Presenter A (Manager Journey):** drives DA prompts in M365 Copilot. Owns Phase A and the close.
- **Presenter B (Operator Journey):** drives Mission Control, the Live Action Strip, and the Adaptive Card. Owns Phases B–D and is the operator who taps Approve in Teams on camera.
- **Producer (optional but recommended):** watches `/api/workday/state`, `/api/outcomes`, `/api/approvals`, and the Teams chat. Triggers `/api/demo/scripted-storm` on cue. Owns the fallback playbook.

If you only have one presenter, run the Manager Journey first and then physically switch screens to Mission Control + Teams side by side for Phases B–D.

---

## 5) T-24h hardening checklist

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
- `/api/health` → `status: "healthy"`, **`build.shaShort` is the deployed SHA** (today: `159d8cc`), `features.hitlControls: true`, `voiceEnabled: true`.
- Mission Control loads at `https://itsm-operations-worker.jollysand-88b78b02.eastus.azurecontainerapps.io/mission-control.html`.
- `/api/routines`, `/api/outcomes`, `/api/cognition/graph` all return 200.
- `/api/workday/state` shows `enabled: true`, `running: true`, `inWindow: true`.

### HITL channel readiness (NEW — do not skip)
- Confirm the operator is signed into Teams as the identity Alex sends 1:1 chats to.
- Send Alex a "hi" in Teams → confirm a reply comes back. (This warms the proactive conversation reference so the card has somewhere to land.)
- Confirm `MANAGER_EMAIL` and `GRAPH_MAIL_SENDER` are set on the container app, and a previous routine email has reached the operator's inbox in the last 24 h (proves Graph mail consent and routing).
- Confirm container env: `az containerapp show -n itsm-operations-worker -g rg-portfolio-agent --query "properties.template.containers[0].env[?name=='PROACTIVE_ENGAGEMENT_ENABLED']"` → `value: "true"`.

### Voice readiness (only if voice is on the run-of-show)
- `/api/voice/status` returns `enabled: true`.
- ACS resource has a valid outbound number and the operator's Teams object id is mapped to `MANAGER_TEAMS_OID` env var.
- Make a test call to yourself: `curl -X POST .../api/voice/page-me -d '{"reason":"preflight","notify":false}'` → phone rings within 10 s, Alex briefs in English.

### Scheduler reality check
- If Azure Functions scheduler (`itsm-operations-scheduler`) is **deployed**, verify the 37 functions are registered and timers are firing (Major Incident Bridge every 5 min is the easiest tell).
- If not deployed, plan to trigger routines manually via `POST /api/scheduled` and narrate the production topology.

---

## 6) T-60m live preflight (must-pass)

Run these in order. If any step fails, fall to the contingency matrix (Section 11) before going live.

1. **Seed data in DA**
   - DA prompt: *"Seed the ServiceNow dev instance with demo data."*
   - Wait for confirmation. This populates incidents / changes / problems / SLAs / CMDB CIs in the PDI.

2. **Warm DA widgets**
   - Run *"Brief me on overnight ops"* once. Confirm `show-command-bridge` renders inside Copilot without retry.

3. **Warm Alex runtime + HITL channel**
   - `GET /api/health` → check `shaShort` is the expected build.
   - `GET /api/workday/state` → `running: true`, `inFlight: false`.
   - Send Alex a "hi" in Teams 1:1 → confirm reply. (Warms the proactive conversation reference.)
   - Click the 📧 button on the Live Action Strip → confirm an email lands in the manager inbox.

4. **Prime the HITL theatre**
   - Fire a dry-run scripted-storm so the queue is empty for the live take:  
     `curl -X POST .../api/demo/scripted-storm -H 'content-type: application/json' -d '{"live":false}'`
   - Confirm `/api/outcomes` shows the dry-run entries and the queue is drained before the live demo.

5. **Governance banner check**
   - Confirm kill switch and freeze lever are **off** unless you plan to demo them.
   - Confirm Trust Score panel returns a current value.

6. **Known-risk mitigation**
   - Recent validation showed occasional timeout on `incident.high` signal path.
   - Have `sla.atRisk`, `change.high`, `problem.repeat`, and `em_event.high` queued as deterministic backups.

---

## 7) Live run-of-show (primary path)

### Phase A — DA manager narrative (6–8 min)

Drive this from M365 Copilot. The DA never calls the Alex runtime; every screen is rendered by an MCP tool and is the artifact the manager walks away with.

1. **Overnight briefing**  
   Prompt: *"Brief me on overnight ops."*  
   Renders → `show-command-bridge` — green/amber/red hero band, three KPI tiles (Open P1, SLAs at risk, Approvals waiting) with 24-hour sparklines, four estate-health rings, ranked Top 5 actions.  
   *Talk:* "This is the first thing the on-call manager sees. One screen, every signal, ranked."

2. **Heatmap**  
   Prompt: *"Where is the heat right now?"*  
   Renders → `show-estate-heatmap` — treemap sized by CMDB tier, coloured by health, **critical CIs pulse**. Tier chips filter live.  
   *Talk:* "At a glance, they know which production tier is bleeding."

3. **Change safety**  
   Prompt: *"Are tonight's changes safe to run together?"*  
   Renders → `show-change-collisions` — 14-day calendar grid, sticky CI label column, **overlapping changes on the same CI flash red with a nudge animation**. KPIs at the top: Scheduled / Tonight / Collisions / Emergency CRs.  
   *Talk:* "Two database changes on db-01 tonight, 30 minutes apart. Flagged before the CAB even meets."

4. **CAB artifact (the takeaway)**  
   Prompt: *"Generate this week's CAB pack."*  
   Renders → `show-cab-pack` — print-friendly layout, per-CR cards with risk badge / backout-plan presence / NIST control pills / blast-radius SVG / recommendation (Approve/Defer/Reject) with reasoning. **Click Print** → clean PDF the chair can email.  
   *Talk:* "This is the artifact. NIST control IDs are baked in. Backout plans are mandatory by policy."

5. **Time-travel risk**  
   Prompt: *"Time-travel: what breaks in 6 months?"*  
   Renders → `show-time-travel` — 0–24 month gradient track. Drag the slider; assets animate red as they cross EOL. Tier-1 assets glow.  
   *Talk:* "Plan today around what's going to break next quarter, not what already broke."

6. **Resolution story**  
   Prompt: *"Tell the resolution story for INC0010001."*  
   Renders → `show-outcome-story` — news-card layout, hero number (e.g. "42 minutes to resolve"), attributed engineer quote from `close_notes`, timeline strip of state transitions.  
   *Talk:* "The story the manager forwards to their boss on Friday. Pulled straight from ServiceNow worknotes. No fabrication."

**Phase A success criteria**
- 5 of 6 widgets render correctly on the first prompt.
- CAB pack prints cleanly.
- Outcome story tells a coherent narrative with real ServiceNow data.

---

### Phase B — Mission Control + Live Action Strip (5–6 min)

Switch tabs to Mission Control. **Eight** panels — walk the first seven quickly (≈45 sec each) and let the **Live Action Strip** carry the energy.

1. **Trust Score** — current AlexTrustScore (0–100), latest red-team probe count and verdict spread.  
   *Talk:* "This number is the platform's continuous self-grade. When it dips under 70, the dispatcher routes high-blast work through reviewer-worker."

2. **Pending Reviews** — workflows held by reviewer-worker with gate reasons (destructive verb, missing rollback, blast radius ≥ 0.8 without approver, major incident lacking evidence).  
   *Talk:* "Four inspect rules. If any one fires, the action stops here for human sign-off."

3. **Cases** — open / pending / working counts and activity timeline. Click one → audit trail + enrichment provenance with citations.

4. **Voice Queue** *(optional if stable)* — pending voice approvals waiting on TTS confirmation.

5. **A2A Activity** — inbound Agent-to-Agent attempts, top callers, reject reasons.

6. **Meta Alerts** — recent alerts from platform self-monitoring (trust-score-low, high-block-rate, etc).  
   *Talk:* "The platform watching itself."

7. **Killed / Frozen** — big red banner if the kill switch is engaged.  
   *Talk:* "One toggle. All tools refuse. Every audit row carries the kill flag. Lockdown in under 10 milliseconds."

8. **Live Action Strip (NEW)** — the four operator buttons across the top of Mission Control:
   - **📧 Email manager update** → `POST /api/demo/action/email`. Status pill: `idle → busy → sent → manager ✓`. Manager's inbox receives the formatted shift summary within seconds.
   - **📅 Schedule CAB bridge** → `POST /api/demo/action/meeting`. Status pill: `idle → busy → scheduled tomorrow ✓`. A Teams calendar invite for 09:00 ET tomorrow lands in the manager's calendar.
   - **📄 Publish CAB pack** → `POST /api/demo/action/cabpack`. Status pill: `idle → busy → published 2/2 ✓`. CAB pack hits the Teams channel and an email blast.
   - **📞 Call me now** → `POST /api/voice/page-me`. Status pill: `idle → busy → calling ✓`. Within ~10 sec the operator's phone rings; Alex briefs in English.

   *Talk:* "These aren't mock-ups. Each button is a real production action. The Strip is what an on-call manager keeps open during shift change."

**Phase B success criteria**
- Mission Control panels refresh in under 2 sec.
- All four Live Action Strip buttons return a green status within 10 sec.
- Email and Teams meeting are receivable on the operator's device on stage.

---

### Phase C — HITL Theatre: the moment that wins the room (4–5 min)

This is the centerpiece. Put **Mission Control on the left** and the **operator's Teams 1:1 chat with Alex on the right**, both visible at the same time. The script-storm fires a Pattern 3 high-risk action; Alex pauses; the Adaptive Card lands in Teams; the operator taps Approve; the worker resumes; everyone sees the audit trail catch it.

**Setup on stage (10 sec):**
- Mission Control open at the Pending Reviews / Cases panels.
- Operator's Teams chat with Alex visible.
- Open `/api/outcomes` in a third tab (small, just for the audit reveal at the end).

**Trigger (15 sec):**

```bash
curl -X POST \
  https://itsm-operations-worker.jollysand-88b78b02.eastus.azurecontainerapps.io/api/demo/scripted-storm \
  -H 'content-type: application/json' \
  -d '{"live": true}'
```

*Producer can pre-stage this as a single click in a terminal alias.*

*Talk:* *"I'm going to throw a realistic morning at Alex. A burst of P1 signals, one of which trips a high-risk gate. Watch what happens — not in my browser, but on the operator's phone."*

**Beat 1 — Alex starts executing (≈15 sec)**
- Mission Control's **Workday** state flips to `inFlight: true`.
- **Cases** panel adds rows in real time. The producer narrates: *"Routines firing, evidence being gathered, gates evaluating."*

**Beat 2 — The high-risk action gets caught (≈30 sec)**
- One of the workflows hits `REQUIRE_HITL`. Alex does **not** execute it.
- **Pending Reviews** panel adds a row. The four inspect rules show why: destructive verb + blast radius ≥ 0.8 + no rollback evidence + missing approver.
- *Talk:* *"Alex stopped itself. Now it needs a human. Watch the operator's Teams chat."*

**Beat 3 — The Adaptive Card lands (THE wow moment, ≈15 sec)**
- The operator's Teams 1:1 chat with Alex receives a card with:
  - 🛑 header: **Attention** (Bolder, Large).
  - Fact set: actor, actor roles, required roles, decision = `REQUIRE_HITL`, risk class, execution id.
  - Reason text block: the gate's plain-English explanation.
  - `Comments` text input (multiline).
  - **Approve** button (positive style, `Action.Execute` verb = `approveAction`).
  - **Deny** button (destructive style, `Action.Execute` verb = `rejectAction`).
  - **Open in Mission Control** link to the approvals view.
- *Talk:* *"This is not a notification. This is a fully interactive card. The operator can be in Outlook, in a meeting, on the phone — anywhere Teams runs, this card works."*

**Beat 4 — Operator approves (≈10 sec)**
- Operator types a one-line comment (e.g. *"Approved — proceed under change window."*) and taps **Approve**.
- Under the covers: `agent.ts` resolves the actor from `context.activity.from`, dynamically imports `approval-queue`, calls `resolveAction(actionId, 'approved', actor)`. The live queue drains.
- Alex replies in the same chat: *"✅ **`<tool>`** approved by `<operator>`. Comments: `<…>`. Alex is resuming the cycle now."*

**Beat 5 — Worker resumes + audit reveal (≈30 sec)**
- Mission Control's Pending Reviews row clears.
- Cases panel shows the workflow advancing.
- Switch to `/api/outcomes` → newest entry is the just-resolved action with:
  - `decision: "approved"`
  - `approvedBy: "<operator>"`
  - `comments: "<the operator's note>"`
  - `engagement.delivered: "teams-card"` ← prove the card was the channel
  - Full timeline including the gate evaluation, the card post, the resolve event.
- *Talk:* *"Every signature in that audit trail is the operator's. The agent did not authorize itself. And the same hooks that let us approve from Teams let us deny — same speed, same proof."*

**Phase C success criteria**
- Adaptive Card visibly appears in Teams within 5 sec of the gate firing.
- Approve tap resumes the worker within 10 sec.
- Audit trail in `/api/outcomes` shows `engagement.delivered: "teams-card"` and `approvedBy = operator name`.

---

### Phase D — Email approval (1:1 from mobile) (2 min)

The same gate that posts a Teams card also sends a styled HTML email to the manager (or to anyone in `MANAGER_EMAIL`). The card and the email are independent paths to the same audit-logged resolver — whichever the human reaches first wins, the other simply marks the action as already resolved.

**On stage:**
1. Open the operator's email client (ideally on a phone held up to the camera) and find the approval mail Alex sent during Phase C.
2. The email body is the styled dark-theme shell: header with risk badge, action summary, **Approve** and **Deny** buttons rendered as big tap targets.
3. Tap **Approve**.
4. The browser opens `GET /api/approvals/action?id=…&decision=approved&by=<actor>` → a clean HTML confirmation page with a green check, the approver's name, the action id, and a link back to Mission Control.

*Talk:* *"Phone-locked, in a meeting, on a plane with one-bar — the operator approved Alex from inside the email client. No portal, no VPN, no app install. Same audit signature lands. Same worker unblocks."*

**Phase D success criteria**
- Email is visible on a real device on camera.
- Tap returns the HTML confirmation page in under 3 sec.
- Audit trail shows two approval attempts for the same action id, one resolved (Teams), one marked as already-resolved (email) — proves idempotency.

---

### Phase E — Voice: page me, page Alex (optional, 2 min)

Only run this if voice is healthy in preflight. Either of these two beats is enough.

**E.1 — Operator hits 📞 Call me now**
- Click the 📞 button on the Live Action Strip.
- Within 10 sec the operator's phone rings.
- Alex (English) briefs the operator on the current shift state.
- *Talk:* *"On-call manager is on the train. One tap, Alex calls them. No app required."*

**E.2 — Operator dials in to Alex**
- Operator dials the ACS-published number (see voice config).
- Alex answers, greets in English, takes a voice question (*"What's open and at risk?"*), reads back the answer.
- *Talk:* *"Voice is symmetric. Alex pages the operator; the operator pages Alex. Same backbone, same audit trail."*

**Phase E success criteria**
- Call connects in under 15 sec.
- Audio is English from the first syllable.
- A voice transaction row appears in `/api/voice/kpi`.

---

### Phase F — Governance bunker (90 sec)

This is the "if everything goes wrong, we still own it" close on the operator side.

- Mission Control **Killed / Frozen** panel: flip the kill switch live (`POST /api/governance/kill`). Big red banner. All subsequent tool calls return `{ killed: true }` in audit. Release with one click.
- Trust Score: explain the continuous self-grade and how dispatcher behaviour changes when it dips.
- Meta Alerts: point at any red row, narrate what it means and who gets paged.

*Talk:* *"Day one of the worst day of your year, you still have one toggle. And the platform polices itself in the meantime."*

---

---

## 8) Executable routines reference (Alex's autonomous menu)

If you have extra time, or the customer asks "what *else* does Alex do?", Alex has **20 routines** running autonomously today. Pick from this menu.

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

**Recommended live-demo routine if Phase C is short on time:** `major-incident-bridge` (completes in ~2–3 sec, always has deterministic output).

---

## 9) Optional KEV enrichment beat (60–90 sec)

*Skip if time is tight; include only if you want to show external signal mapping.*

Run the enrichment KEV scenario:
- Seed a CISA KEV match signal (e.g., CVE-2021-44228 Log4Shell matching a CMDB asset).
- Watch Alex enrich it with CISA metadata and create a P1 incident in ServiceNow within 60 seconds.
- Show the incident worknote with the CISA citation embedded.
- The reviewer worker fires *because* CVSS hit 10 — even though the worker's nominal blast radius is below the normal gate.
- The outcome verifier KEV probe asserts SUCCESS once the SNOW write + citation are both present.

*Talk:* *"Live KEV match → P1 in SNOW with CISA citation in the worknote, in under 60 seconds, against demo fixtures. No human pre-staged it. Alex saw the catalogue, matched it to inventory, and acted."*

---

## 10) Contingency matrix (what to do live)

### If DA widget fails to render
- Retry once with a semantically equivalent starter prompt.
- Move to the next DA act; return later.
- Keep CAB pack + outcome story as the **minimum required DA artifact proof**.

### If ServiceNow data is sparse or unexpected
- Re-run the seed step.
- Switch to a known seeded incident ID.
- Narrate as "fresh environment drift" and continue with architecture/governance proof.

### If the scripted-storm doesn't fire a HITL gate (Phase C)
- Re-fire with `live: true` once more (the trigger evaluation has ~5% nondeterminism in fixture flavour).
- If still no gate, **manually publish a high-risk signal**:
  ```bash
  curl -X POST .../api/signals -d '{"signal":{"id":"demo-hitl-manual-1","source":"servicenow","type":"change.high","severity":"high","asset":"db-01","payload":{"crId":"CHG0010099","blastRadius":0.9,"hasRollback":false},"occurredAt":"<now>","origin":"observed","forceMode":"propose"}}'
  ```
  `forceMode: "propose"` guarantees the gate trips.
- If the gate trips but the Adaptive Card doesn't appear in Teams within 10 sec:
  - Producer checks `/api/outcomes` for `engagement.delivered`. If it says `teams-chat` (plain text) instead of `teams-card`, an env var regression dropped the card path — fall back to the email approval flow (Phase D) and continue. The audit story is identical.

### If the operator's Teams chat doesn't have the proactive conversation reference
- The card cannot post until at least one inbound message from the operator has reached Alex.
- Producer types "hi" to Alex in Teams during Phase B; the next gate post will succeed.
- As a last resort, jump straight to **Phase D** (email approval) — same audit narrative, no Teams dependency.

### If the email approval link 404s or stalls
- Confirm `/api/approvals/action` is in the publicPaths allow-list (it is, in `159d8cc`+).
- If the action id is no longer in the live queue (e.g. already drained from Teams), the GET still returns a clean "already resolved" confirmation page — narrate as **idempotency win**, not failure.

### If Alex signal route is slow or times out (Phase B/C)
- Switch immediately to alternate signal class. **Priority order:**
  1. `sla.atRisk` — most deterministic, SLA escalation path always active.
  2. `change.high` — triggers change-risk briefing and emergency CAB flow.
  3. `problem.repeat` — triggers problem record creation.
  4. `em_event.high` — generic monitoring alert.
- Continue with outcomes and audit visibility instead of waiting on first signal class.
- Talk track: *"Signal path latency detected; switching to alternate scenario to keep energy high."*

### If scheduler isn't active
- State clearly: *"Scheduler is not deployed in this environment yet; we'll use direct API trigger to show routine execution."*
- Demonstrate manual trigger via `POST /api/scheduled` with `routineId: major-incident-bridge`.
- Show the outcome in `/api/outcomes` and explain: *"In production, this same routine fires every 5 minutes autonomously via Azure Functions timers."*
- No loss of credibility; shows you understand the deployment topology.

### If Mission Control panel stalls
- Refresh once.
- Continue using API-backed evidence from `/api/health`, `/api/routines`, `/api/outcomes`, `/api/cognition/graph` endpoints.

### If voice fails (Phase E)
- Skip silently. Voice is a "wow plus", not a required beat.
- If voice was promised in pre-brief, narrate: *"Voice was healthy in preflight 60 minutes ago; we'll send a recorded sample post-demo."*

### Universal escape valve
- The **CAB pack** (Phase A) and the **/api/outcomes** audit trail (Phase C tail) are the two never-fail artifacts. If everything else collapses, these two together still prove the value proposition.

---

## 11) Post-demo evidence pack (send within 15 minutes)

Deliver these immediately after the session:
- **Screenshot set:** DA key artifacts (command bridge, CAB pack, outcome story) + Mission Control Trust Score + Pending Reviews + the **Teams Adaptive Card with the operator's approval** + the email approval confirmation page.
- **One JSON excerpt of `/api/outcomes`** showing the just-resolved HITL action with `engagement.delivered: "teams-card"` and the operator's signature.
- **One sentence each for:**
  - Manager value (DA): "Decision artifacts on demand, inside Copilot."
  - Operator value (Alex + Live Action Strip): "Night shift runs itself; the morning brief is one button."
  - Governance value (HITL Adaptive Card + email + audit): "High-risk actions stop until a real human approves, from any device, with a signed audit trail."

---

## 12) Killer close talk track (45 seconds)

*"Today you saw one ITSM operating model, on two surfaces.*

*The **Copilot DA** is the manager lens — six interactive widgets answering 'where is the heat?' and 'is this change safe?' Every screen renders live data; every CAB pack is audit-ready with NIST controls cited.*

*The **Agent Alex** is the operator lens — 20 autonomous routines on schedule, signal-driven workflows responding in seconds, and a Mission Control where every action is one click away.*

*And the moment we just lived together — Alex hitting a high-risk gate, your operator's Teams chat lighting up with an Adaptive Card, one tap from a phone resuming the worker, the audit trail signed in their name — that's the difference between an autonomous agent and a runaway one. Your humans stay in the loop. The platform stays fast. Every signature is real.*

*Together, this turns ITSM from a queue of tickets into an auditable operating system. Decision artifacts on demand. Autonomous action with human gates. One tap from any device. All inside Microsoft 365 — no separate portal, no VPN, nothing hiding in another tool.*

*Let me show you what we're shipping next."*

---

## 13) Presenter clipboard checklist

### Pre-demo (T-60 min)
- [ ] `/api/health` → `status: healthy`, `shaShort` matches expected build, `hitlControls: true`, `voiceEnabled: true`.
- [ ] `/api/workday/state` → `running: true`, `inFlight: false`.
- [ ] DA prompt: *"Seed the ServiceNow dev instance with demo data."*
- [ ] Verify DA starters visible in Copilot.
- [ ] Send "hi" to Alex in Teams → reply received (warms the proactive conversation reference).
- [ ] Click 📧 on Live Action Strip → manager inbox receives email.
- [ ] Confirm `PROACTIVE_ENGAGEMENT_ENABLED=true` on the container app.
- [ ] Dry-run `scripted-storm` (`{"live": false}`) → outcomes recorded, queue empty.
- [ ] Confirm seeded incident ID exists for outcome story (e.g. `INC0010001`).

### During demo

**Phase A — DA manager (~8 min)**
- [ ] Act 1: *"Brief me on overnight ops"* → command bridge renders.
- [ ] Act 2: *"Where is the heat right now?"* → heatmap renders.
- [ ] Act 3: *"Are tonight's changes safe?"* → collision detection renders.
- [ ] Act 4: *"Generate this week's CAB pack"* → CAB pack renders + Print works.
- [ ] Act 5: *"Time-travel: what breaks in 6 months?"* → timeline slider works.
- [ ] Act 6: *"Tell the resolution story for INC0010001"* → outcome story renders.

**Phase B — Mission Control + Live Action Strip (~6 min)**
- [ ] Mission Control loads, Trust Score visible.
- [ ] Pending Reviews + Cases panels live.
- [ ] 📧 button → manager email arrives.
- [ ] 📅 button → calendar invite arrives.
- [ ] 📄 button → CAB pack posts to Teams + email.
- [ ] 📞 button → operator phone rings, Alex speaks English (only if voice is on the run-of-show).

**Phase C — HITL Theatre (~5 min) ← THE WOW**
- [ ] Mission Control + Teams chat side by side.
- [ ] Producer fires `POST /api/demo/scripted-storm` with `{"live": true}`.
- [ ] Pending Reviews row appears with all four inspect rules.
- [ ] Adaptive Card appears in Teams within 5 sec.
- [ ] Operator types comment, taps Approve.
- [ ] Alex acknowledges in chat with ✅.
- [ ] `/api/outcomes` shows `engagement.delivered: "teams-card"` + `approvedBy: <operator>`.

**Phase D — Email approval (~2 min)**
- [ ] Open approval email on operator's phone on camera.
- [ ] Tap Approve.
- [ ] Confirmation HTML page renders with green check.

**Phase E — Voice (optional, ~2 min)**
- [ ] Phone rings within 15 sec of 📞 tap.
- [ ] Alex briefs in English from the first syllable.

**Phase F — Governance bunker (~90 sec)**
- [ ] Toggle kill switch → red banner.
- [ ] Toggle off → tools resume.

**Close (~45 sec)**
- [ ] Deliver killer close talk track.

### Post-demo (T+15 min)
- [ ] Screenshot evidence pack (DA + Mission Control + Teams Adaptive Card + email confirmation page).
- [ ] Export `/api/outcomes` JSON for the just-resolved HITL action.
- [ ] Note any signal timeouts, missed cards, or scheduler issues for the next run.
- [ ] Reset: DA prompt *"Reset the ServiceNow demo data"* to clear the PDI for the next walkthrough.
