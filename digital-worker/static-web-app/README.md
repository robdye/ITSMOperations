# ITSM Operations — Mission Control (Static Web App)

This directory contains the configuration for deploying Mission Control as an Azure Static Web App.

## Architecture

- **Frontend**: Mission Control dashboard (HTML/CSS/JS) served from CDN
- **Backend**: API proxy to the digital-worker Container App
- **Auth**: Azure AD via Static Web App built-in auth

## Deployment

1. Create a Static Web App in Azure Portal
2. Connect to this repo, set `app_location` to `digital-worker/static-web-app`
3. Set `api_location` to empty (APIs proxied to Container App)
4. Configure environment variables:
   - `AAD_CLIENT_ID`: Azure AD app registration client ID
   - `AAD_CLIENT_SECRET`: Azure AD app registration client secret
   - `BACKEND_URL`: Digital worker Container App URL

## Local Development

```bash
npm install -g @azure/static-web-apps-cli
swa start --app-location . --api-location ""
```
