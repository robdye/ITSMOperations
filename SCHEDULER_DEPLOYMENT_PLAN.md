# ITSM Operations Scheduler Deployment Plan

## Current Status
✅ **Digital Worker**: Running (Azure Container App)  
✅ **20 Routines**: Defined and enabled  
❌ **Auto-Scheduler**: NOT DEPLOYED (Azure Functions missing)

---

## Why Routines Aren't Auto-Running

The architecture requires **external HTTP calls** to trigger scheduled work:

```
Azure Durable Functions (Timers)
    ↓ [HTTP POST every 5-30 min]
Digital Worker (/api/scheduled endpoint)
    ↓ [routes to routine engine]
Microagent Workers (8 types)
```

**Without Azure Functions deployed**, the container app sits idle waiting for trigger calls that never arrive.

---

## What Needs Deployment

### Azure Functions App Setup

**Location**: `functions/` folder  
**Type**: Node.js 20 (Timer-triggered HTTP)  
**Timer Triggers**: 10 configured in `functions/src/timers/scheduled-routines.ts`

#### Timer Schedule Mapping

| Routine | Frequency | Azure Timer Schedule |
|---------|-----------|----------------------|
| `sla-breach-prediction` | Every 30 min | `0 */30 * * * *` |
| `emergency-change-fast-track` | Every 15 min | `0 */15 * * * *` |
| `major-incident-bridge` | Every 5 min | `0 */5 * * * *` |
| `incident-stale-check` | Every 4 hours | `0 0 */4 * * *` |
| `post-incident-kb-capture` | Every hour | `0 0 * * * *` |
| `cmdb-health-audit` | Daily 02:00 | `0 0 2 * * *` |
| `daily-ops-standup` | Weekdays 08:00 | `0 0 8 * * 1-5` |
| `monday-cab-prep` | Monday 07:00 | `0 0 7 * * 1` |
| `change-collision-check` | Weekdays 07:00 | `0 0 7 * * 1-5` |
| `incident-recurring-pattern` | Monday 06:00 | `0 0 6 * * 1` |

*(+10 more in scheduled-routines.ts)*

---

## Deployment Steps

### 1. Create Azure Functions App

```bash
# Create Function App (if not exists)
az functionapp create \
  --resource-group rg-portfolio-agent \
  --consumption-plan-location eastus \
  --runtime node \
  --runtime-version 20 \
  --functions-version 4 \
  --name itsm-operations-scheduler \
  --storage-account <your-storage-account>
```

### 2. Configure Environment Variables

```bash
az functionapp config appsettings set \
  --name itsm-operations-scheduler \
  --resource-group rg-portfolio-agent \
  --settings \
    DIGITAL_WORKER_URL="https://itsm-operations-worker.jollysand-88b78b02.eastus.azurecontainerapps.io" \
    WORKER_SCHEDULED_SECRET="<copy from container app environment>" \
    FUNCTIONS_WORKER_RUNTIME="node"
```

### 3. Build and Deploy

```bash
cd functions

# Build TypeScript
npm run build

# Deploy to Azure
func azure functionapp publish itsm-operations-scheduler
```

### 4. Verify Deployment

```bash
# Check function app status
az functionapp show \
  -g rg-portfolio-agent \
  -n itsm-operations-scheduler \
  --query "{status:state, runtime:runtime}"

# Monitor timer executions
az functionapp logs tail \
  -g rg-portfolio-agent \
  -n itsm-operations-scheduler
```

---

## Expected Post-Deployment Behavior

Once deployed, the Digital Worker logs should show automatic routine triggers:

```
[Timer] Running routine: sla-breach-prediction
Worker sla-manager using model: gpt-4o (task: briefing)
Completed: sla-breach-prediction — <KPI summary>
```

**Trigger Schedule** (from 16:08:10 onwards):
- `major-incident-bridge`: Every 5 min (16:09, 16:14, 16:19, ...)
- `emergency-change-fast-track`: Every 15 min (16:08, 16:23, 16:38, ...)
- `sla-breach-prediction`: Every 30 min (16:08, 16:38, 17:08, ...)
- Daily/Weekly routines: Per schedule

---

## Troubleshooting

If routines don't auto-run after deployment:

1. **Check secret mismatch**
   ```bash
   # Verify container app secret
   az containerapp show -g rg-portfolio-agent -n itsm-operations-worker \
     --query "properties.template.containers[0].env[?name=='SCHEDULED_SECRET'].value"
   
   # Verify Functions app secret matches
   az functionapp config appsettings list \
     -g rg-portfolio-agent -n itsm-operations-scheduler
   ```

2. **Test timer manually**
   ```bash
   # Invoke a timer function directly
   az functionapp function show \
     -g rg-portfolio-agent \
     -n itsm-operations-scheduler \
     --function-name slaBreach
   ```

3. **Check network connectivity**
   - Functions app must reach Digital Worker HTTPS endpoint
   - Verify firewall/NSG rules allow outbound HTTPS

---

## Files Involved

```
functions/
├── src/
│   └── timers/
│       └── scheduled-routines.ts     ← Timer trigger definitions
├── package.json                       ← Dependencies
├── local.settings.json               ← Local dev config
└── tsconfig.json                     ← TypeScript config

digital-worker/src/
├── scheduled-routines.ts             ← Routine registry (20 routines)
└── index.ts                          ← /api/scheduled endpoint handler
```

---

## Next Steps

1. Choose deployment method (Azure Portal, VS Code extension, or CLI)
2. Create/configure Function App
3. Deploy timer functions from `functions/` folder
4. Monitor Digital Worker logs for automatic routine triggers
5. Configure Teams/email notifications for routine outputs
