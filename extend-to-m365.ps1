$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$packagePath = Join-Path $root 'appPackage\build\appPackage.dev.zip'
$mos3Endpoint = 'https://titles.prod.mos.microsoft.com'
$pollIntervalSeconds = 7
$maxPollAttempts = 60

if (-not (Test-Path $packagePath)) {
  throw "Package not found: $packagePath"
}

Write-Host '=== ITSM Operations M365 Extend Tool (PowerShell) ==='
Write-Host "Package: $packagePath"

Write-Host 'Getting access token from Azure CLI...'
$token = az account get-access-token --resource https://api.spaces.skype.com --query accessToken -o tsv
if (-not $token) {
  throw 'Failed to get access token from Azure CLI. Run: az login'
}
Write-Host 'Token acquired.'

$headers = @{ Authorization = "Bearer $token" }
Write-Host 'Resolving titles service URL...'
$envResp = Invoke-RestMethod -Method Get -Uri "$mos3Endpoint/config/v1/environment" -Headers $headers -TimeoutSec 120
$titlesServiceUrl = $envResp.titlesServiceUrl
if (-not $titlesServiceUrl) {
  throw 'titlesServiceUrl not returned from environment endpoint.'
}
Write-Host "Titles service URL: $titlesServiceUrl"

Add-Type -AssemblyName System.Net.Http

$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromMinutes(5)
$client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $token)

try {
  Write-Host 'Uploading package (async, no shouldBlock)...'
  $multipart = [System.Net.Http.MultipartFormDataContent]::new()

  $bytes = [System.IO.File]::ReadAllBytes($packagePath)
  $packageContent = [System.Net.Http.ByteArrayContent]::new($bytes)
  $packageContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse('application/zip')
  $multipart.Add($packageContent, 'package', 'appPackage.dev.zip')

  $infoJson = '{"builderName":"TeamsToolKit"}'
  $infoContent = [System.Net.Http.StringContent]::new($infoJson, [System.Text.Encoding]::UTF8, 'application/json')
  $multipart.Add($infoContent, 'info')

  $uploadUri = "$titlesServiceUrl/builder/v1/users/packages?scope=personal"
  $uploadResp = $client.PostAsync($uploadUri, $multipart).GetAwaiter().GetResult()
  $statusCode = [int]$uploadResp.StatusCode
  $rawBody = $uploadResp.Content.ReadAsStringAsync().GetAwaiter().GetResult()

  Write-Host "Upload response status: $statusCode"
  if (-not $uploadResp.IsSuccessStatusCode) {
    throw "Upload failed: HTTP $statusCode Body: $rawBody"
  }

  $body = $null
  if ($rawBody) {
    try { $body = $rawBody | ConvertFrom-Json } catch {}
  }

  if ($statusCode -eq 200 -or $statusCode -eq 201) {
    $titleId = $body.titleId
    if (-not $titleId -and $body.titlePreview) { $titleId = $body.titlePreview.titleId }
    $appId = $body.appId
    if (-not $appId -and $body.titlePreview) { $appId = $body.titlePreview.appId }

    Write-Host "`n✅ Done immediately!"
    Write-Host "TitleId: $titleId"
    Write-Host "AppId:   $appId"
  }
  elseif ($statusCode -eq 202) {
    $statusId = $body.statusId
    if (-not $statusId) {
      throw "202 response missing statusId. Body: $rawBody"
    }

    Write-Host "Processing asynchronously. StatusId: $statusId"
    $completed = $false

    for ($attempt = 1; $attempt -le $maxPollAttempts; $attempt++) {
      Start-Sleep -Seconds $pollIntervalSeconds
      $pollUri = "$titlesServiceUrl/builder/v1/users/packages/status/$statusId"
      $pollResp = $client.GetAsync($pollUri).GetAwaiter().GetResult()
      $pollStatus = [int]$pollResp.StatusCode
      $pollRaw = $pollResp.Content.ReadAsStringAsync().GetAwaiter().GetResult()

      Write-Host "Poll attempt ${attempt}: HTTP $pollStatus"

      if (-not $pollResp.IsSuccessStatusCode) {
        throw "Polling failed: HTTP $pollStatus Body: $pollRaw"
      }

      $pollBody = $null
      if ($pollRaw) {
        try { $pollBody = $pollRaw | ConvertFrom-Json } catch {}
      }

      $titleId = $null
      $appId = $null
      if ($pollBody) {
        $titleId = $pollBody.titleId
        if (-not $titleId -and $pollBody.titlePreview) { $titleId = $pollBody.titlePreview.titleId }
        $appId = $pollBody.appId
        if (-not $appId -and $pollBody.titlePreview) { $appId = $pollBody.titlePreview.appId }
      }

      if ($titleId -or $appId) {
        Write-Host "`n✅ Sideloading complete!"
        Write-Host "TitleId: $titleId"
        Write-Host "AppId:   $appId"
        Write-Host "`n--- Update env/.env.dev with: ---"
        Write-Host "M365_TITLE_ID=$titleId"
        Write-Host "M365_APP_ID=$appId"
        $completed = $true
        break
      }
    }

    if (-not $completed) {
      throw "Polling timed out after $maxPollAttempts attempts."
    }
  }
  else {
    throw "Unexpected upload status: $statusCode Body: $rawBody"
  }
}
finally {
  if ($client) { $client.Dispose() }
}
