# Scope Change Procedures — Agent Access Control

## When This Applies

A scope change occurs when an agent's `availableTo` or `allowedUsersAndGroups`
is modified. This is a potentially high-impact change because it alters who
can access the agent's capabilities and data.

## Risk Assessment for Scope Changes

| From → To | Risk Level | Additional Requirements |
|---|---|---|
| none → some | Medium | Department head approval |
| some → all | High | CISO approval required, DPA review |
| all → some | Low | Standard change, notify affected users |
| all → none (effective block) | High | Emergency change process, incident correlation |
| some → none | Medium | Notify affected groups, document reason |

## Data Protection Implications

When expanding an agent's scope, consider:

1. **Data access**: Does the agent have actions/plugins that access sensitive data?
   If yes, expanding scope means more users can trigger those data accesses.
2. **Sensitivity classification**: Check the package's `sensitivity` field.
   If classified above "General", CISO review is mandatory for scope expansion.
3. **Compliance boundaries**: Ensure the expanded scope doesn't cross compliance
   boundaries (e.g., PCI scope, GDPR data processing boundaries).
4. **Audit trail**: Every scope change must be logged with:
   - Who requested it
   - Who approved it
   - Business justification
   - Previous and new scope

## Notification Requirements

| Scope Change | Who to Notify |
|---|---|
| Expansion (any) | IT Governance, affected group owners, DPO |
| Contraction | Affected users (7 days notice), Service Desk |
| Emergency block | CISO, Service Desk, incident manager |
