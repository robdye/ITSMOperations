# Shadow Agent Remediation Procedures

## Remediation Decision Tree

```
Shadow Agent Detected
  │
  ├─ Is it causing active harm? ──YES──→ Block immediately (Emergency Change)
  │                                        │
  │                                        └── Create Incident → Investigate
  │
  └─ NO
      │
      ├─ Is it custom (built internally)?
      │   │
      │   ├─ Owner identified? ──YES──→ 5-day registration window
      │   │                              │
      │   │                              ├── Owner registers → Normal Change workflow
      │   │                              └── No response → Restrict scope → Block at day 10
      │   │
      │   └─ No owner? ──→ IT Governance takes ownership → Evaluate & decide
      │
      └─ Is it external (partner)?
          │
          ├─ Owner identified? ──YES──→ 14-day vendor assessment window
          │                              │
          │                              ├── Assessment passed → Register in Approved Registry
          │                              └── Assessment failed → Block agent
          │
          └─ No owner? ──→ Block immediately (no accountability)
```

## Registration Process (for owners who want to keep their agent)

1. Submit a ServiceNow Change Request via the Agent Change Control skill
2. Complete the Agent Registration Form:
   - Business justification
   - Data classification
   - Intended scope (users/groups)
   - Support & escalation contacts
3. IT Governance reviews within 3 business days
4. If approved:
   - Agent added to Approved Agent Registry
   - CMDB CI created
   - Review date set (per risk tier)
5. If rejected:
   - Agent blocked
   - Owner notified with alternatives

## Bulk Remediation (>20 shadow agents)

If the discovery reveals more than 20 shadow agents:

### Phase 1 (Week 1): Triage
- Block any agents with `availableTo: all` and no owner
- Identify the top 5 highest-risk agents for immediate attention

### Phase 2 (Weeks 2-3): Owner Outreach
- Email all identified owners with registration instructions
- Set up drop-in registration hours with IT Governance

### Phase 3 (Week 4): Enforcement
- Block unresponsive agents
- Report remaining gaps to CISO

### Phase 4 (Ongoing): Prevention
- Implement automated detection (weekly scheduled scan)
- Add shadow agent detection to the ITSM Morning Briefing
