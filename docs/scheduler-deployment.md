# Scheduler & Shared Secret Diagnostic

**Date:** 2026-05-14  
**Status:** Routines registered but not executing  
**Root cause:** Azure Functions scheduler not deployed

---

## Issue Summary

Your Mission Control dashboard shows 20 routines **registered** (visible in the UI) but **not executing** (no outcomes recorded). This is because:

1. **Scheduler deployment is incomplete.**  
   The architecture requires Azure Durable Functions timers to trigger `/api/scheduled` endpoint on the Digital Worker container app every 5-30 minutes.

2. **Without Functions deployed**, the Digital Worker waits idle. Routines only execute when externally triggered.

---

## The Shared Secret: `SCHEDULED_SECRET`

This is an HMAC token that authenticates HTTP calls from Azure Functions to the Digital Worker's `/api/scheduled` endpoint.

### Where it's stored

| Location | Value |
|----------|-------|
| Azure Key Vault | `ScheduledSecret` |
| Container App Env | `SCHEDULED_SECRET` |
| Functions App Settings | `WORKER_SCHEDULED_SECRET` |

### To retrieve it (choose one)

```powershell
# Option 1: From Key Vault
az keyvault secret show \
  --vault-name <your-vault-name> \
  --name ScheduledSecret \
  --query value -o tsv

# Option 2: From container app
az containerapp show \
  -g rg-portfolio-agent \
  -n itsm-operations-worker \
  --query "properties.template.containers[0].env[?name=='SCHEDULED_SECRET'].value" -o tsv

# Option 3: From local environment
$env:SCHEDULED_SECRET
```

### If you don't have one, generate it

```powershell
# Generate secure base64-encoded HMAC secret
$secret = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes(
  "$(New-Guid)$(New-Guid)"
))
Write-Host "New secret: $secret"

# Store in Key Vault
az keyvault secret set \
  --vault-name <your-vault-name> \
  --name ScheduledSecret \
  --value $secret

# Update container app
az containerapp update \
  -g rg-portfolio-agent \
  -n itsm-operations-worker \
  --set-env-vars SCHEDULED_SECRET=$secret
```

---

## Why Routines Aren't Executing

### Current State (What You See)
```
Mission Control Dashboard
  ↓ [UI loads, shows 20 routines as "scheduled"]
Digital Worker in-memory registry
  ↓ [Routines stored in memory]
Nothing triggers them
  ↗ [NO EXTERNAL HTTP CALLS]
Azure Functions (NOT DEPLOYED)
```

### Expected State (What Should Happen)
```
Azure Functions Timer fires
  ↓ [every 5 min: major-incident-bridge]
  ↓ [every 15 min: emergency-change-fast-track]
  ↓ [every 30 min: sla-breach-prediction]
POST /api/scheduled?routineId=X with x-scheduled-secret header
  ↓ [to Digital Worker container app HTTPS endpoint]
Digital Worker receives trigger
  ↓ [validates secret header]
Routine executes synchronously
  ↓ [runs worker, records outcome]
Outcome stored in /api/outcomes
  ↓ [visible in Mission Control]
Audit entry logged
```

---

## Deployment Path: Get Routines Running

### Step 1: Verify the scheduler code exists
```powershell
cd functions/src/timers
ls scheduled-routines.ts  # Should exist
cat scheduled-routines.ts | grep "0 \*" # Show cron expressions
```

### Step 2: Build & Deploy Functions

```powershell
cd functions
npm run build

# Deploy to Azure (choose one method)

# Method A: Via func CLI (fastest)
func azure functionapp publish itsm-operations-scheduler \
  --build remote

# Method B: Via az CLI
az functionapp deployment source config-zip \
  -g rg-portfolio-agent \
  -n itsm-operations-scheduler \
  --src-path ./dist.zip

# Method C: Via GitHub Actions (if wired)
git push master  # Triggers .github/workflows/deploy.yml
```

### Step 3: Verify deployment

```powershell
# Check Functions app exists
az functionapp show \
  -g rg-portfolio-agent \
  -n itsm-operations-scheduler \
  --query "{state:state, runtime:runtime, location:location}"

# Check secrets are configured
az functionapp config appsettings list \
  -g rg-portfolio-agent \
  -n itsm-operations-scheduler \
  | grep SCHEDULED_SECRET

# Check timer triggers exist
az functionapp function list \
  -g rg-portfolio-agent \
  -n itsm-operations-scheduler
```

### Step 4: Verify connectivity & execution

```powershell
# Tail live logs
az functionapp logs tail \
  -g rg-portfolio-agent \
  -n itsm-operations-scheduler

# You should see:
# [5/14/2026 16:05:00] [Timer] Running routine: sla-breach-prediction
# [5/14/2026 16:05:23] [Timer] Routine sla-breach-prediction completed
```

### Step 5: Watch outcomes appear

```powershell
# Hit the Digital Worker outcomes endpoint
curl -s "https://itsm-operations-worker.jollysand-88b78b02.eastus.azurecontainerapps.io/api/outcomes?limit=10" \
  | jq '.outcomes[] | {label, timestamp, status}'

# You should see recent outcomes like:
# {
#   "label": "sla-breach-prediction",
#   "timestamp": "2026-05-14T16:05:23Z",
#   "status": "completed"
# }
```

---

## Quick Verification: Are Routines Running?

| Check | Command | Expected |
|-------|---------|----------|
| Health | `curl .../api/health` | `{"status":"ok"}` |
| Routines registered | `curl .../api/routines` | 20+ routines in list |
| Recent outcomes | `curl .../api/outcomes` | Outcomes with timestamps from last 60 min |
| Cognition graph | `curl .../api/cognition/graph` | `counts.outcomes > 0` |

If routines are registered but outcomes are old (> 1 hour), scheduler is not deployed.

---

## Next Steps

1. **Deploy scheduler** (30 min setup + 5 min deploy)
2. **Verify first routine completion** (watch logs, check `/api/outcomes`)
3. **Align all docs to NIST 800-53** (PowerPoint + markdown)
4. **Update demo plan** to reflect actual autonomous execution
