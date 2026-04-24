# Scope Remediation Guide

## When an Agent Has Overly Broad Scope

If a custom agent has `availableTo: all`, it means every user in the tenant can
invoke the agent. For custom (LOB) agents, this is a policy violation unless the
CISO has provided documented approval.

### Remediation Steps

1. **Identify the intended audience**: Contact the agent owner and determine which
   users/groups actually need access.

2. **Create a security group**: If one doesn't exist, create an M365 security group
   for the intended users.

3. **Restrict the scope**: Use the Package Management API to update the agent:
   ```
   PATCH /beta/copilot/admin/catalog/packages/{id}
   {
     "availableTo": "some",
     "allowedUsersAndGroups": [
       { "id": "{security-group-id}", "type": "group" }
     ]
   }
   ```

4. **Document the change**: Create a change request via the Agent Change Control skill.

5. **Notify affected users**: If users will lose access, provide 7 days notice
   explaining the change and how to request access.

### If CISO Approval Exists

If the agent legitimately needs tenant-wide scope (e.g., it's an org-wide
service like IT helpdesk), document the exemption:

1. Obtain written CISO approval with business justification
2. Record the exemption in the compliance registry
3. Set a review date (maximum 12 months)
4. Mark the agent as "Exempt — R2" in the audit workbook
