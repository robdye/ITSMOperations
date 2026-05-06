# ITSM Operations — Manager-Facing Demo Script

> **Audience:** IT operations managers, change advisory boards (CABs), service owners.
> **Persona:** *ITSM Operations* — a ServiceNow + EOL intelligence Copilot.
> **Surface:** Microsoft 365 Copilot Declarative Agent (DA) only.
> **Length:** ~6 minutes for the full 5-act flow.

The DA reads from ServiceNow, endoflife.date, Microsoft Graph, and WorkIQ. It does **not**
call any background runtime; every screen the manager sees is rendered by an MCP tool
and is the artefact they walk away with.

---

## Pre-Demo Setup

1. **Seed demo data** — Open the *ITSM Operations* agent in Microsoft 365 Copilot and type:

   ```
   Seed the ServiceNow dev instance with demo data
   ```

   Wait for confirmation (~30 s). This populates incidents, changes, problems, SLAs, and
   CMDB CIs in the PDI.

2. **Verify the conversation starters** are wired. The DA should show six prompts:
   - *Brief me on overnight ops*
   - *What's at risk in the next 4 hours?*
   - *Where is the heat right now?*
   - *Time-travel: what breaks in 6 months?*
   - *Generate this week's CAB pack*
   - *Tell the resolution story for INC…*

3. Have a known resolved incident number ready (e.g. `INC0010001`) for Act 5.

---

## Act 1 — "What should I look at first?" *(60 s)*

**Manager opens M365 Copilot.** Picks the first conversation starter:

> **You:** Brief me on overnight ops.

**Copilot renders → `show-command-bridge`**

What the manager sees:

- A hero status band — green / amber / red depending on real ServiceNow data, with a
  soft glow on critical states.
- Three large KPI tiles (count-up animation, 24-hour sparklines): **Open P1**,
  **SLAs at risk**, **Approvals waiting**.
- Four estate-health rings — Incidents, Changes, Problems, SLAs.
- The **Top 5 actions** list, ranked, with a click-to-prompt on each.

**Talk track:** *"This is the first thing the on-call manager sees. One screen, every signal,
ranked. Click any tile and the agent drills in."*

---

## Act 2 — "Where is the heat right now?" *(45 s)*

> **You:** Where is the heat right now?

**Copilot renders → `show-estate-heatmap`**

- A treemap-style grid of CMDB CIs, sized by tier (Tier 1 CIs are 2× larger), coloured
  by health (green / amber / red, with a pulse animation on **Critical**).
- Tier filter chips at the top: **All / Tier 1 / Tier 2 / Tier 3**.
- Hover any CI for a tooltip: class, tier, health, active incidents, last change.

**Talk track:** *"At a glance, the manager knows which production tier is bleeding. They
click a red CI to see its blast radius."*

---

## Act 3 — "Are tonight's changes safe?" *(60 s)*

> **You:** Are tonight's changes safe to run together?

**Copilot renders → `show-change-collisions`**

- A 14-day calendar grid, with a sticky CI label column. Each change is a coloured bar
  in a day cell.
- Two changes targeting the same CI in overlapping windows render in red with a subtle
  side-to-side **nudge** animation. A *Collisions* section below lists each pair.
- KPIs at the top: **Scheduled**, **Tonight (≤24 h)**, **Collisions**, **Emergency CRs**.

**Talk track:** *"Two database changes on db-01 tonight, 30 minutes apart. The DA flagged
it. The manager can stop the bleed before the CAB even meets."*

---

## Act 4 — "Generate this week's CAB pack" *(90 s)*

> **You:** Generate this week's CAB pack.

**Copilot renders → `show-cab-pack`**

- Print-friendly layout. **Print** and **Distribute** buttons in the toolbar.
- KPIs: changes for review, high/critical risk, missing backout plan, recommend approve.
- Per-CR card: number, title, **risk badge** with /25 score, type, CI, window, requestor,
  description, **backout plan** (red MISSING flag if absent — *"required by NIST CM-3"*),
  test plan, EOL implications, **NIST citation pills**, and a recommendation block
  (Approve / Defer / Reject) with reasoning.
- A **mini blast-radius** SVG (3-node: upstream → CI → downstream) on every card.
- Footer: ServiceNow link, assignment group.

**Demo trick:** Click **Print**. The toolbar / animations / footer drop out, and you get a
clean PDF the CAB chair can email to the steering committee.

**Talk track:** *"This is the artefact. The manager generates it on a Tuesday afternoon
and forwards it to their boss. NIST control IDs are baked in. Backout plans are
mandatory by policy."*

---

## Act 5 — "What broke in 6 months?" + the closing artefact *(90 s)*

> **You:** Time-travel: what breaks in 6 months?

**Copilot renders → `show-time-travel`**

- A 0–24 month gradient track (green → amber → red).
- Drag the slider, or click the +3 / +6 / +12 / +24 buttons.
- The asset list animates red as each crosses its EOL date. Tier 1 assets glow.
- KPIs: total tracked, EOL ≤ 6 mo, EOL ≤ 12 mo, already past EOL.

**Then the closing artefact:**

> **You:** Tell the resolution story for INC0010001.

**Copilot renders → `show-outcome-story`**

- News-card layout. Hero number ("**42 minutes** to resolve"). Big resolution timestamp.
- An attributed quote-style block — the lead engineer's first sentence from `close_notes`.
- Quick facts: status, affected CI, lead engineer, priority, SLA met.
- A timeline strip showing state transitions.
- Action buttons: **View timeline**, **Read RCA**, **Open in ServiceNow**.

**Talk track:** *"This is the story the manager forwards to their boss on Friday. It's a
resolution narrative — pulled straight from ServiceNow worknotes and state history.
No fabrication."*

---

## Closing the demo *(30 s)*

> *"Six widgets. Five questions. One agent. Every screen reads from ServiceNow,
> endoflife.date, Microsoft Graph, or WorkIQ — nothing else. Every screen renders
> in M365 Copilot — no separate UI. NIST controls are cited by ID. The CAB pack
> prints. The resolution story emails."*

---

## Optional Beat — "When the world tells us first" *(KEV match, ~60 s)*

> *"Watch what happens when CISA publishes a new Known Exploited Vulnerability
> overnight that touches one of the assets in our CMDB."*

Run the enrichment KEV scenario:

```text
Run the enrichment-kev-match scenario
```

What the room sees:

1. The cognition graph lights up an `enrichment.kev.match` signal flowing into
   `major-incident-response`.
2. **Within 60 seconds**, ServiceNow has a P1 incident with the CISA citation
   embedded in the worknote ("CISA KEV catalog https://www.cisa.gov/known-exploited-vulnerabilities-catalog
   — CVE-2021-44228 (Log4Shell), CVSS 10.0").
3. The reviewer worker fires *because* CVSS hit 10 — even though the worker's
   nominal blast radius is below the normal gate.
4. The outcome verifier KEV probe asserts SUCCESS once the SNOW write + citation
   are both present.

> *"Live KEV match → P1 in SNOW with CISA citation in the worknote, in under 60
> seconds, against demo fixtures. No human pre-staged it. Alex saw the catalogue,
> matched it to inventory, and acted."*

---

## Reset between demos

```text
Reset the ServiceNow demo data
```

This clears the seeded records from the PDI so the next walkthrough starts clean.

---

## Architecture note (off-stage)

The DA itself only ever talks to the **MCP server** that backs these six widgets. The
six widgets are pure HTML, served from `mcp-server/assets/` and rendered inline by
M365 Copilot via the OpenAI Apps SDK widget protocol (`text/html+skybridge`).

The DA does **not** call any background runtime, signal router, governance API, voice
gateway, cognition graph, or outcome verifier. A vitest CI guard
(`src/__tests__/guard-no-alex.test.ts`) blocks any regression on this rule.
