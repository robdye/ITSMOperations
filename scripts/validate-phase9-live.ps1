$fqdn = "itsm-operations-worker.jollysand-88b78b02.eastus.azurecontainerapps.io"
$secret = $env:SCHEDULED_SECRET
if ([string]::IsNullOrWhiteSpace($secret)) {
    throw "SCHEDULED_SECRET environment variable is not set. Export it before running this script (e.g. `\$env:SCHEDULED_SECRET = '<value>'`)."
}
$headers = @{ "x-scheduled-secret" = $secret; "Content-Type" = "application/json" }

Write-Host "===== Seed 3 high-incident signals ====="
for ($i = 1; $i -le 3; $i++) {
    $sigId = "phase9-validate-{0:N}" -f [guid]::NewGuid()
    $bodyObj = @{
        signal = @{
            id = $sigId.Substring(0, 24)
            source = "monitor"
            type = "incident.high"
            severity = "high"
            asset = "svc-payments-api"
            payload = @{ service = "payments"; region = "eus"; latency_p95_ms = 1900 }
            occurredAt = (Get-Date).ToString("o")
            origin = "observed"
        }
    }
    $body = $bodyObj | ConvertTo-Json -Depth 6
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri "https://$fqdn/api/signals" -Method POST -Body $body -Headers $headers -TimeoutSec 10
        Write-Host "Signal $i posted: $($r.StatusCode)"
    } catch { Write-Host "Signal $i failed: $($_.Exception.Message)" }
}

Start-Sleep -Seconds 3

Write-Host "`n===== /api/experience/find (test prior pattern lookup) ====="
$findObj = @{
    signal = @{
        id = "lookup-test"
        source = "monitor"
        type = "incident.high"
        severity = "high"
        asset = "svc-payments-api"
        payload = @{ service = "payments"; region = "eus" }
        occurredAt = (Get-Date).ToString("o")
        origin = "observed"
    }
    topK = 3
    minSimilarity = 0.3
}
$findBody = $findObj | ConvertTo-Json -Depth 6
try {
    (Invoke-WebRequest -UseBasicParsing -Uri "https://$fqdn/api/experience/find" -Method POST -Body $findBody -Headers @{ "Content-Type" = "application/json" } -TimeoutSec 10).Content
} catch { Write-Host "find failed: $($_.Exception.Message)" }

Write-Host "`n===== /api/cognition/graph counts ====="
((Invoke-WebRequest -UseBasicParsing -Uri "https://$fqdn/api/cognition/graph" -TimeoutSec 5).Content | ConvertFrom-Json).counts | ConvertTo-Json

Write-Host "`n===== /api/foresight (any forecasts?) ====="
(Invoke-WebRequest -UseBasicParsing -Uri "https://$fqdn/api/foresight" -TimeoutSec 5).Content
