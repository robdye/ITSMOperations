# IT Offboarding Checklist — Agent Section

This is the agent-specific section of the IT offboarding checklist.
It should be completed as part of the standard HR/IT offboarding process.

## Pre-Departure (Ideally 2+ Weeks Before)

### Agent Discovery
- ☐ Run Agent Ownership Transfer skill to identify all owned agents
- ☐ Review the list with the departing employee
- ☐ Confirm no agents are missing from the scan

### Knowledge Transfer
- ☐ Schedule handover meetings for each critical/elevated agent
- ☐ Document agent purpose, business context, and known issues
- ☐ Document any scheduled maintenance or upcoming changes
- ☐ Identify key stakeholders and escalation contacts

### New Owner Identification
- ☐ Identify and confirm new owner for each agent
- ☐ New owner acknowledges responsibilities
- ☐ Manager approves all assignments

## Day of Departure

### Transfer Execution
- ☐ Execute ownership reassignment via Package Management API
- ☐ Update CMDB CIs with new owner
- ☐ Update Approved Agent Registry
- ☐ Notify affected users of ownership change

### Account Cleanup
- ☐ Verify no agents still reference the departing employee's credentials
- ☐ Revoke any personal API keys used by agents
- ☐ Remove departing employee from agent-related security groups

## Post-Departure (Day 5)

### Verification
- ☐ Confirm all agents transferred successfully
- ☐ No orphaned agents remaining
- ☐ New owners have accessed/reviewed their agents
- ☐ Completion report sent to IT Governance

## Emergency Departure (No Notice)

If the employee leaves without notice:
1. Assign ALL agents to their manager immediately (interim)
2. Mark all agents as Critical urgency
3. IT Governance takes over coordination
4. 30-day deadline for permanent reassignment
