# Phase 10 — End-to-end validation across every schedule + signal-driven workflow.
# Hits every registered routine via /api/scheduled, every major signal class via
# /api/signals, then summarises pass/fail and outcome status.
#
# NOTE: routines run real LLM calls (~$0.001 each → ~$0.02 total).

$ErrorActionPreference = 'Continue'
$fqdn   = 'itsm-operations-worker.jollysand-88b78b02.eastus.azurecontainerapps.io'
$secret = $env:SCHEDULED_SECRET
if ([string]::IsNullOrWhiteSpace($secret)) {
    throw "SCHEDULED_SECRET environment variable is not set. Export it before running this script (e.g. `\$env:SCHEDULED_SECRET = '<value>'`)."
}
$base   = "https://$fqdn"
$secretHeaders = @{ 'x-scheduled-secret' = $secret; 'Content-Type' = 'application/json' }

function Invoke-Endpoint {
    param(
        [string]$Method = 'GET',
        [string]$Path,
        [hashtable]$Body,
        [hashtable]$Headers,
        [int]$TimeoutSec = 120
    )
    $url = "$base$Path"
    $params = @{
        Uri              = $url
        Method           = $Method
        UseBasicParsing  = $true
        TimeoutSec       = $TimeoutSec
        ErrorAction      = 'Stop'
    }
    if ($Headers) { $params.Headers = $Headers }
    if ($Body)    { $params.Body = ($Body | ConvertTo-Json -Depth 8) }
    return Invoke-WebRequest @params
}

# ── Pre-flight ──
Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host " ALEX — END-TO-END VALIDATION ($(Get-Date -Format 'HH:mm:ss'))" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

try {
    $h = (Invoke-Endpoint -Path '/api/health').Content | ConvertFrom-Json
    Write-Host ("  health        : {0}" -f $h.status) -ForegroundColor Green
} catch {
    Write-Host "  health        : FAIL — $($_.Exception.Message)" -ForegroundColor Red
    throw
}

try {
    $routinesBefore = (Invoke-Endpoint -Path '/api/routines').Content | ConvertFrom-Json
    Write-Host ("  routines registered: {0}" -f $routinesBefore.routines.Count) -ForegroundColor Green
} catch {
    Write-Host "  routines      : FAIL — $($_.Exception.Message)" -ForegroundColor Red
}

# ── PART A: trigger every routine ──
Write-Host "`n━━━ PART A: every scheduled routine ($($routinesBefore.routines.Count) total) ━━━" -ForegroundColor Yellow

$results = @()
$idx = 0
foreach ($r in $routinesBefore.routines) {
    $idx++
    $rid = $r.id
    Write-Host ("  [{0,2}/{1,2}] {2} ... " -f $idx, $routinesBefore.routines.Count, $rid) -NoNewline
    $start = Get-Date
    try {
        $resp = Invoke-Endpoint -Method POST -Path '/api/scheduled' -Headers $secretHeaders -Body @{ routineId = $rid } -TimeoutSec 180
        $payload = $resp.Content | ConvertFrom-Json
        $elapsed = ((Get-Date) - $start).TotalSeconds
        $status  = $payload.status
        $snippet = if ($payload.output) { $payload.output.Substring(0, [Math]::Min(80, $payload.output.Length)) -replace "`r`n|`n", ' ' } else { '' }
        Write-Host ("OK ({0:N1}s) {1}" -f $elapsed, $snippet) -ForegroundColor Green
        $results += [pscustomobject]@{
            kind     = 'routine'
            id       = $rid
            status   = 'pass'
            httpCode = $resp.StatusCode
            elapsed  = [math]::Round($elapsed, 1)
            note     = $snippet
        }
    } catch {
        $elapsed = ((Get-Date) - $start).TotalSeconds
        $msg = $_.Exception.Message
        if ($_.Exception.Response) {
            try {
                $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $msg = $sr.ReadToEnd()
            } catch {}
        }
        Write-Host ("FAIL ({0:N1}s) {1}" -f $elapsed, ($msg.Substring(0, [Math]::Min(120, $msg.Length)))) -ForegroundColor Red
        $results += [pscustomobject]@{
            kind     = 'routine'
            id       = $rid
            status   = 'fail'
            httpCode = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
            elapsed  = [math]::Round($elapsed, 1)
            note     = ($msg -replace "`r`n|`n", ' ').Substring(0, [Math]::Min(160, $msg.Length))
        }
    }
}

# ── PART B: signal-driven workflows ──
Write-Host "`n━━━ PART B: signal-driven workflows ━━━" -ForegroundColor Yellow

$signalScenarios = @(
    @{
        label = 'major-incident-response (P1 SNOW incident)'
        signal = @{
            id        = ('sig-mir-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
            source    = 'servicenow'
            type      = 'incident.high'
            severity  = 'high'
            asset     = 'svc-payments-api'
            payload   = @{ service='payments'; region='eus'; latency_p95_ms=2400; sys_id='INC0010001' }
            occurredAt = (Get-Date).ToString('o')
            origin    = 'observed'
        }
    },
    @{
        label = 'change.high signal'
        signal = @{
            id        = ('sig-chg-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
            source    = 'servicenow'
            type      = 'change.high'
            severity  = 'high'
            asset     = 'app-payroll'
            payload   = @{ rfc='CHG0099001'; risk='high'; window='2026-05-04T22:00Z' }
            occurredAt = (Get-Date).ToString('o')
            origin    = 'observed'
        }
    },
    @{
        label = 'problem.repeat signal'
        signal = @{
            id        = ('sig-prb-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
            source    = 'servicenow'
            type      = 'problem.repeat'
            severity  = 'high'
            asset     = 'svc-checkout'
            payload   = @{ relatedIncidents=@('INC0010050','INC0010051','INC0010052'); pattern='timeout-spike' }
            occurredAt = (Get-Date).ToString('o')
            origin    = 'observed'
        }
    },
    @{
        label = 'sla.atRisk signal'
        signal = @{
            id        = ('sig-sla-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
            source    = 'servicenow'
            type      = 'sla.atRisk'
            severity  = 'high'
            asset     = 'svc-helpdesk'
            payload   = @{ ticketId='INC0010099'; minutesRemaining=45; sla='P1-resolution' }
            occurredAt = (Get-Date).ToString('o')
            origin    = 'observed'
        }
    },
    @{
        label = 'monitor.alert from observability stack'
        signal = @{
            id        = ('sig-mon-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
            source    = 'monitor'
            type      = 'em_event.high'
            severity  = 'high'
            asset     = 'svc-payments-api'
            payload   = @{ alertName='PaymentsLatencyP95High'; value=1900; threshold=1500 }
            occurredAt = (Get-Date).ToString('o')
            origin    = 'observed'
        }
    }
)

foreach ($sc in $signalScenarios) {
    Write-Host ("  → {0} ... " -f $sc.label) -NoNewline
    try {
        $resp = Invoke-Endpoint -Method POST -Path '/api/signals' -Headers $secretHeaders -Body @{ signal = $sc.signal } -TimeoutSec 30
        Write-Host ("OK ({0})" -f $resp.StatusCode) -ForegroundColor Green
        $results += [pscustomobject]@{
            kind=  'signal'; id=$sc.signal.type; status='pass'; httpCode=$resp.StatusCode; elapsed=0; note=$sc.signal.id
        }
    } catch {
        $msg = $_.Exception.Message
        Write-Host ("FAIL — {0}" -f $msg) -ForegroundColor Red
        $results += [pscustomobject]@{
            kind='signal'; id=$sc.signal.type; status='fail'; httpCode=0; elapsed=0; note=$msg
        }
    }
}

# Give signal-driven workflows a moment to actually run.
Write-Host "`n  waiting 25s for signal-driven workflows to settle ..."
Start-Sleep -Seconds 25

# ── PART C: outcomes + state ──
Write-Host "`n━━━ PART C: outcome + state verification ━━━" -ForegroundColor Yellow

try {
    $routinesAfter = (Invoke-Endpoint -Path '/api/routines').Content | ConvertFrom-Json
    $completedRoutines = @($routinesAfter.routines | Where-Object { $_.lastStatus -eq 'completed' })
    Write-Host ("  routines completed (server-tracked): {0}" -f $completedRoutines.Count) -ForegroundColor Green
} catch {
    Write-Host "  /api/routines query failed: $_" -ForegroundColor Red
}

try {
    $outcomes = (Invoke-Endpoint -Path '/api/outcomes?limit=100').Content | ConvertFrom-Json
    Write-Host ("  workflow outcomes recorded: {0}" -f $outcomes.outcomes.Count) -ForegroundColor Green
    if ($outcomes.outcomes.Count -gt 0) {
        $byLabel = $outcomes.outcomes | Group-Object -Property label
        foreach ($g in $byLabel) {
            Write-Host ("     {0,-12} = {1}" -f $g.Name, $g.Count) -ForegroundColor Gray
        }
    }
} catch {
    Write-Host "  /api/outcomes query failed: $_" -ForegroundColor Red
}

try {
    $g = (Invoke-Endpoint -Path '/api/cognition/graph').Content | ConvertFrom-Json
    Write-Host ("  cognition graph: workers={0}  signals={1}  forecasts={2}  outcomes={3}  assets={4}" -f $g.counts.workers, $g.counts.signals, $g.counts.forecasts, $g.counts.outcomes, $g.counts.assets) -ForegroundColor Green
} catch {
    Write-Host "  /api/cognition/graph query failed: $_" -ForegroundColor Red
}

try {
    $exp = (Invoke-Endpoint -Path '/api/experience/recent?limit=50').Content | ConvertFrom-Json
    Write-Host ("  experiential memory entries: {0}" -f $exp.memory.Count) -ForegroundColor Green
} catch {
    Write-Host "  /api/experience/recent query failed: $_" -ForegroundColor Red
}

# ── PART D: summary ──
Write-Host "`n━━━ SUMMARY ━━━" -ForegroundColor Cyan
$pass = @($results | Where-Object { $_.status -eq 'pass' }).Count
$fail = @($results | Where-Object { $_.status -eq 'fail' }).Count
$total = $results.Count
Write-Host ("  total scenarios: {0}" -f $total)
Write-Host ("  passed         : {0}" -f $pass) -ForegroundColor Green
Write-Host ("  failed         : {0}" -f $fail) -ForegroundColor (if ($fail -gt 0) { 'Red' } else { 'Green' })

if ($fail -gt 0) {
    Write-Host "`n  Failures:" -ForegroundColor Red
    $results | Where-Object { $_.status -eq 'fail' } | ForEach-Object {
        Write-Host ("    [{0,-7}] {1,-40} → {2}" -f $_.kind, $_.id, $_.note) -ForegroundColor Red
    }
}

Write-Host "`n  Pass-by-kind:" -ForegroundColor Cyan
$results | Group-Object -Property kind | ForEach-Object {
    $kindPass = @($_.Group | Where-Object status -eq 'pass').Count
    Write-Host ("    {0,-8} : {1}/{2}" -f $_.Name, $kindPass, $_.Group.Count)
}

# Persist for review
$results | ConvertTo-Json -Depth 4 | Out-File -FilePath "$PSScriptRoot\..\last-validation-run.json" -Encoding utf8
Write-Host "`n  Detailed results → last-validation-run.json"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Cyan
