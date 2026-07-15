# ITSM Operations Customer Demo Runbook

> **Audience:** IT operations managers, service owners, and CAB members
> **Surface:** Microsoft 365 Copilot and the ITSM Operations Mission Control page
> **Data policy:** Read-only, customer-safe live data. Never seed, fabricate, reset, or mutate records for a demonstration.

## Readiness gate

Run the following against the deployed endpoints before admitting attendees:

```powershell
$env:ITSM_WORKER_URL = 'https://<worker-host>'
$env:ITSM_MCP_URL = 'https://<mcp-host>'
$env:ITSM_ENRICHMENT_URL = 'https://<enrichment-host>'
$env:EXPECTED_COMMIT_SHA = '<deployed-git-sha>'
node scripts/validate-live-deployment.mjs
```

Proceed only when the result is `customer-demo-ready`. The gate proves:

- the expected commit is running;
- the Digital Worker and both MCP services are healthy;
- ServiceNow incident and change reads succeed;
- `sourceMode` is `live-servicenow`;
- no fallback source is active; and
- Mission Control renders.

## Customer-data preparation

1. Use an approved ServiceNow sandbox or a production tenant explicitly approved for the session.
2. Ask the customer to identify:
   - one current incident they are comfortable displaying;
   - one upcoming change;
   - one configuration item; and
   - one resolved incident with suitable work notes.
3. Confirm attendees are authorized to see the selected records.
4. Avoid personal data, security-sensitive descriptions, credentials, and confidential attachments.
5. Keep all actions read-only unless the customer explicitly approves a write during the session.

If the live tenant has no matching records, state that clearly and move to another live view. Do not invent an example.

## Demo flow

### 1. Establish source trust

Open Mission Control and show the source status:

- ServiceNow: `ok`
- MCP: `ok`
- Source mode: `live-servicenow`
- Fallback active: `false`

**Talk track:** “Everything shown in this session is being read from the connected ServiceNow tenant. The release gate blocks the demo if the agent falls back or loses authentication.”

### 2. Operations briefing

In Microsoft 365 Copilot:

> Brief me on current operations and cite the live records behind the priorities.

Open one returned incident selected during preparation. Confirm that its number, state, priority, assignment group, and timestamps match ServiceNow.

### 3. Incident and SLA review

> Show active incidents and identify which live records are closest to an SLA breach.

Ask the agent to explain one result and link back to ServiceNow. Do not claim an SLA risk unless the live response contains supporting data.

### 4. Change and CAB review

> Review upcoming changes and identify live scheduling conflicts or missing implementation safeguards.

Open the customer-selected change. Verify the window, affected CI, risk, test plan, and backout plan against ServiceNow.

### 5. Shift handover

> Generate a shift handover using only current ServiceNow incidents and changes.

Call out the record references and timestamps. If there is nothing to hand over, present the empty result as a valid live outcome.

### 6. Resolution story

> Summarize the resolution of <approved-resolved-incident> using its actual work notes and close notes.

Verify the narrative against the source record. The agent must not add causes, actions, or outcomes absent from ServiceNow.

### 7. Enrichment

Use a current asset or vulnerability from the approved tenant:

> Check the supported lifecycle or current public vulnerability sources for <approved-product-or-CVE>.

Distinguish public-source enrichment from ServiceNow data and retain source citations.

## Close

> “The agent is grounded in the customer’s live service-management records and cited public sources. Deployment fails closed when ServiceNow authentication, MCP connectivity, or release identity cannot be proven.”

## After the session

- No reset or cleanup command is required because the runbook creates no records.
- Review Application Insights for errors during the session.
- Record the deployed commit SHA and readiness result with the demo notes.
- Report any discrepancy between the agent response and ServiceNow as a grounding defect.
