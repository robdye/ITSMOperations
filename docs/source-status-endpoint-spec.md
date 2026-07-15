# Source Status Endpoint Specification

Date: 2026-06-10

## Endpoint

`GET /api/source-status`

## Purpose

Expose whether ITSMOperations is operating against live ServiceNow, cached data, or failing auth/source checks.

## Response schema

```json
{
  "worker": {
    "status": "healthy",
    "buildSha": "...",
    "authenticated": true
  },
  "missionControl": {
    "authenticated": true,
    "authMechanism": "obo|jwt|easyauth|dev|unknown"
  },
  "mcp": {
    "status": "ok|unavailable|auth-failed",
    "endpoint": "redacted",
    "lastChecked": "iso"
  },
  "serviceNow": {
    "status": "ok|unavailable|auth-failed|not-configured",
    "instance": "redacted",
    "lastIncidentRead": "iso|null",
    "lastChangeRead": "iso|null"
  },
  "sourceMode": "live-servicenow|cached|auth-failed|mcp-unavailable",
  "fallbackActive": false,
  "warnings": []
}
```

## UI requirement

Mission Control must display source mode prominently. If source mode is not `live-servicenow`, the UI must not imply live operational data.
