$ErrorActionPreference = 'Stop'
$fqdn   = 'itsm-operations-worker.jollysand-88b78b02.eastus.azurecontainerapps.io'
$secret = $env:SCHEDULED_SECRET
if ([string]::IsNullOrWhiteSpace($secret)) {
    throw "SCHEDULED_SECRET environment variable is not set. Export it before running this script (e.g. `\$env:SCHEDULED_SECRET = '<value>'`)."
}
$base   = "https://$fqdn"
$headers = @{ 'x-scheduled-secret' = $secret; 'Content-Type' = 'application/json' }

Write-Host "`n→ Re-firing major-incident-response with extended timeout (the 30s timeout earlier was client-side; checking outcome..)" -ForegroundColor Yellow

$signal = @{
    id        = 'sig-mir-rerun-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
    source    = 'servicenow'
    type      = 'incident.high'
    severity  = 'high'
    asset     = 'svc-payments-api'
    payload   = @{ service='payments'; region='eus'; latency_p95_ms=2400; sys_id='INC0010001' }
    occurredAt = (Get-Date).ToString('o')
    origin    = 'observed'
}

$start = Get-Date
try {
    $resp = Invoke-WebRequest -Uri "$base/api/signals" -Method POST -Headers $headers -Body (@{ signal = $signal } | ConvertTo-Json -Depth 6) -TimeoutSec 600 -UseBasicParsing
    $elapsed = ((Get-Date) - $start).TotalSeconds
    $body = $resp.Content | ConvertFrom-Json
    Write-Host ("  /api/signals returned {0} in {1:N1}s" -f $resp.StatusCode, $elapsed) -ForegroundColor Green
    Write-Host "  decisions:" -ForegroundColor Gray
    $body.decisions | Format-Table -AutoSize
} catch {
    Write-Host ("  signal POST failed: {0}" -f $_.Exception.Message) -ForegroundColor Red
}

Write-Host "`n→ Querying outcomes after workflow completion ..." -ForegroundColor Yellow
$out = (Invoke-WebRequest -Uri "$base/api/outcomes?limit=50" -UseBasicParsing).Content | ConvertFrom-Json
Write-Host ("  outcomes recorded: {0}" -f $out.outcomes.Count)
if ($out.outcomes.Count -gt 0) {
    $out.outcomes | Select-Object -First 10 -Property workflowId, label, signalId, recordedAt | Format-Table -AutoSize
}

Write-Host "`n→ Cognition graph snapshot ..." -ForegroundColor Yellow
$g = (Invoke-WebRequest -Uri "$base/api/cognition/graph" -UseBasicParsing).Content | ConvertFrom-Json
$g.counts | Format-List

Write-Host "`n→ Recent decisions (signal-router) ..." -ForegroundColor Yellow
$d = (Invoke-WebRequest -Uri "$base/api/signals?limit=10" -UseBasicParsing).Content | ConvertFrom-Json
$d.signals | Select-Object -First 10 -Property id, type, source, severity | Format-Table -AutoSize
