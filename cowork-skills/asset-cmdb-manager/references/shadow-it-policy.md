# Shadow IT Policy — Agent Governance

**Policy ID:** SIT-001  
**Parent Policy:** AGP-001 Agent Governance Policy  
**NIST Controls:** CM-2, CM-3, CM-8, PM-5

## 1. Definition

Shadow IT in the context of Copilot agents refers to any agent or app package
deployed within the tenant without following the established governance process.
This includes:

- Custom agents created by employees without IT approval
- External (partner) agents installed without vendor risk assessment
- Agents shared between departments without governance review
- Agents deployed via self-service without change control

## 2. Risk Factors

Shadow agents pose the following risks:

### Security
- Unreviewed data access: agents may access sensitive data via plugins/actions
- Unvetted external connections: plugins may call external APIs without security review
- Privilege escalation: agents acting on behalf of users without proper consent

### Compliance
- NIST CM-2 violation: shadow agents are not part of the configuration baseline
- NIST CM-8 violation: unregistered components in the IT environment
- Data protection: unclassified agents may process PII or financial data

### Operational
- No lifecycle management: stale agents with no owner or update plan
- No incident correlation: incidents caused by shadow agents are harder to diagnose
- No backup/recovery: no documented backout plan if agent causes issues

## 3. Detection

Shadow agent detection MUST be performed:
- **Monthly**: Full inventory scan by the Agent Inventory Audit skill
- **Weekly**: Automated comparison against Approved Agent Registry
- **On-demand**: When a security incident suggests agent involvement

## 4. Response

### Immediate (Critical Risk — Custom, Unregistered)
1. Notify agent owner and IT Governance within 24 hours
2. Owner has 5 business days to submit registration request (Change Request)
3. If no response: block the agent
4. If security concern: block immediately, investigate

### Standard (High Risk — External, Unregistered)
1. Notify agent owner and IT Governance
2. Owner has 14 business days to complete vendor risk assessment
3. If assessment fails: block the agent
4. If no response: restrict scope to owner only

### Advisory (Medium Risk — Expired/Modified)
1. Notify agent owner
2. Owner has 30 business days to renew approval
3. If no response: downgrade to High risk handling

## 5. Prevention

- Educate employees on the agent governance process
- Provide a self-service agent request form (ServiceNow catalog item)
- Enable admin alerts for new custom agent deployments
- Regular town halls on approved agent capabilities
