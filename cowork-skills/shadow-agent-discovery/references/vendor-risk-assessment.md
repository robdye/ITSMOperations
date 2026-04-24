# Vendor Risk Assessment Requirements — External Agents

## When This Applies

Any agent package with `type: external` (built by a partner) must complete a
vendor risk assessment before being added to the Approved Agent Registry.

## Assessment Criteria

### 1. Data Handling (Weight: 30%)
- What data does the agent access via its plugins/actions?
- Does the agent send data to external endpoints?
- Is data encrypted in transit and at rest?
- Does the vendor comply with the organization's data classification policy?

### 2. Security Posture (Weight: 25%)
- Does the vendor have SOC 2 Type II certification?
- Has a penetration test been conducted in the last 12 months?
- Does the vendor have an incident response plan?
- Are there any known vulnerabilities in the agent's components?

### 3. Compliance (Weight: 20%)
- Does the vendor meet GDPR/CCPA requirements (if applicable)?
- Is the vendor compatible with the organization's regulatory framework?
- Does the vendor support audit logging?

### 4. Availability & Support (Weight: 15%)
- What is the vendor's SLA for the agent?
- Is there a support channel for issues?
- What is the vendor's update/patch cadence?

### 5. Exit Strategy (Weight: 10%)
- Can the organization export data if they stop using the agent?
- Is there a decommission process?
- What happens to data when the agent is removed?

## Scoring

| Score | Rating | Action |
|---|---|---|
| 80–100 | Low Risk | Approve, annual review |
| 60–79 | Medium Risk | Approve with conditions, semi-annual review |
| 40–59 | High Risk | Approve only with CISO sign-off, quarterly review |
| 0–39 | Unacceptable | Do not approve, block agent |
