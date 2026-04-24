# ITIL V4 Change Enablement Process — Agent Lifecycle

## Change Types

### Standard Change
- **Definition**: Pre-authorized, low-risk, well-understood change.
- **Agent examples**: Version bump, metadata update, ownership reassignment.
- **Approval**: Auto-approved if criteria met. No CAB review.
- **PIR**: Automated check at day 5, close if no incidents.

### Normal Change
- **Definition**: Follows the full RFC lifecycle.
- **Agent examples**: New agent deployment, scope change, new capabilities added.
- **Lifecycle**: RFC → Risk Assessment → CAB Review → Approval → Implementation → PIR.
- **PIR**: Manual review at day 3, check for incidents and user feedback.

### Emergency Change
- **Definition**: Fast-tracked change to address urgent situation.
- **Agent examples**: Blocking a compromised agent, emergency security patch.
- **Lifecycle**: ECAB approval (reduced quorum) → Implementation → PIR within 1 business day.
- **PIR**: Mandatory detailed review including root cause.

## Change Window Policy

| Change Type | Permitted Windows |
|---|---|
| Standard | Any business day, no outage expected |
| Normal | Tues–Thurs, 06:00–18:00 local time (avoid month-end) |
| Emergency | Any time, but ECAB must be convened within 1 hour |

## Collision Detection

Before approving any agent change, check for:
1. Other agent changes in the same change window
2. Infrastructure changes affecting the same platform (Teams, Outlook, SharePoint)
3. Active incidents on the agent or its dependent services
4. Planned maintenance windows for Microsoft 365

## Post-Implementation Review (PIR) Checklist

1. ☐ Is the agent accessible to intended users?
2. ☐ Is the agent blocked status correct?
3. ☐ Were any incidents raised within 48 hours of the change?
4. ☐ Is the agent's scope (availableTo) correct?
5. ☐ Has the CMDB been updated to reflect the change?
6. ☐ Were all approval steps completed and documented?
