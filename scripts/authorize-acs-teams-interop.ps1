# ──────────────────────────────────────────────────────────────────────────
# Authorize the ACS resource for Teams interop in your tenant.
#
# Symptom this fixes:
#   ACS Call Automation `createCall` to a Teams user returns:
#     {"type":"Microsoft.Communication.CreateCallFailed",
#      "resultInformation":{"code":403,"subCode":10124,"message":"Forbidden..."}}
#   And /api/voice/page-me responds with status:"failed",
#   errors.acsCall containing "403" / "10124".
#
# Why:
#   By default, a Teams tenant does NOT allow ACS-originated calls to its
#   Teams users. A Teams admin must opt the ACS resource into the tenant's
#   federation allow-list. This is a one-time configuration per tenant +
#   ACS resource pair.
#
# Reference:
#   https://learn.microsoft.com/azure/communication-services/concepts/teams-interop
#   https://learn.microsoft.com/microsoftteams/teams-acs-interop
#
# Required role: Teams Administrator (or Global Administrator).
# Required module: MicrosoftTeams (PowerShell 7+).
# ──────────────────────────────────────────────────────────────────────────

[CmdletBinding()]
param(
    # Default = the ACS resource immutable id for `itsmops-acs` in
    # rg-portfolio-agent. Override via -AcsImmutableResourceId for another env.
    [string]$AcsImmutableResourceId = '49f214f8-85b2-4b4f-b945-74200d66c58d',

    # Set to $false if you only want to inspect current config without changing it.
    [bool]$Apply = $true
)

$ErrorActionPreference = 'Stop'

Write-Host "──────────────────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host " ACS → Teams interop authorization" -ForegroundColor Cyan
Write-Host "──────────────────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host " ACS Immutable Resource Id : $AcsImmutableResourceId"
Write-Host " Apply changes              : $Apply"
Write-Host ""

# ── Module bootstrap ───────────────────────────────────────────────────
if (-not (Get-Module -ListAvailable -Name MicrosoftTeams)) {
    Write-Host "Installing MicrosoftTeams PowerShell module (CurrentUser scope)..." -ForegroundColor Yellow
    Install-Module MicrosoftTeams -Scope CurrentUser -Force -AllowClobber
}
Import-Module MicrosoftTeams -ErrorAction Stop

# ── Connect ─────────────────────────────────────────────────────────────
Write-Host "Connecting to Microsoft Teams (interactive sign-in as a Teams admin)..." -ForegroundColor Yellow
Connect-MicrosoftTeams | Out-Null

# ── Read current config ────────────────────────────────────────────────
Write-Host ""
Write-Host "Current Teams ↔ ACS federation configuration:" -ForegroundColor Cyan
$current = Get-CsTeamsAcsFederationConfiguration -Identity Global
$current | Format-List

$alreadyAllowed = $current.AllowedAcsResources -contains $AcsImmutableResourceId
if ($alreadyAllowed) {
    Write-Host "✓ ACS resource $AcsImmutableResourceId is already in the allowed list." -ForegroundColor Green
} else {
    Write-Host "✗ ACS resource $AcsImmutableResourceId is NOT in the allowed list." -ForegroundColor Red
}

if ($current.EnableAcsUsers) {
    Write-Host "✓ EnableAcsUsers = true (ACS users may interop with Teams)." -ForegroundColor Green
} else {
    Write-Host "✗ EnableAcsUsers = false (ACS users blocked)." -ForegroundColor Red
}

# ── Apply ──────────────────────────────────────────────────────────────
if (-not $Apply) {
    Write-Host ""
    Write-Host "Apply=false — exiting without changes." -ForegroundColor Yellow
    return
}

if ($alreadyAllowed -and $current.EnableAcsUsers) {
    Write-Host ""
    Write-Host "Nothing to do — config already correct. Try the page-me call again." -ForegroundColor Green
    return
}

Write-Host ""
Write-Host "Applying configuration..." -ForegroundColor Yellow
Set-CsTeamsAcsFederationConfiguration `
    -Identity Global `
    -EnableAcsUsers $true `
    -AllowedAcsResources @{Add = $AcsImmutableResourceId} `
    -ErrorAction Stop

Write-Host "✓ Config applied. New state:" -ForegroundColor Green
Get-CsTeamsAcsFederationConfiguration -Identity Global | Format-List

Write-Host ""
Write-Host "──────────────────────────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host " Done. Note: tenant policy can take 5–15 minutes to propagate." -ForegroundColor Cyan
Write-Host " Test by clicking the Page Me button on Mission Control or:" -ForegroundColor Cyan
Write-Host '   $base = "https://itsm-operations-worker.jollysand-88b78b02.eastus.azurecontainerapps.io"' -ForegroundColor Gray
Write-Host '   $body = @{ reason = "Interop test"; notify = $false } | ConvertTo-Json' -ForegroundColor Gray
Write-Host '   Invoke-RestMethod -Uri "$base/api/voice/page-me" -Method Post -ContentType "application/json" -Body $body' -ForegroundColor Gray
Write-Host "──────────────────────────────────────────────────────────────────" -ForegroundColor Cyan
