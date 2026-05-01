/**
 * extend-to-m365.js
 * Bypasses the 30-second Teams Toolkit CLI timeout by using async (non-blocking)
 * sideloading with polling. Authenticates using Teams Toolkit's client ID via
 * device code flow, then uploads the ITSM package to M365 Titles service.
 *
 * Usage: node extend-to-m365.js
 */
const path = require('path');
const fs = require('fs');

// Use digital-worker's node_modules
const nm = path.join(__dirname, 'digital-worker', 'node_modules');
const axios = require(path.join(nm, 'axios'));
const FormData = require(path.join(nm, 'form-data'));
const { execFileSync } = require('child_process');

const PACKAGE_PATH = path.join(__dirname, 'appPackage', 'build', 'appPackage.dev.zip');
const MOS3_ENDPOINT = 'https://titles.prod.mos.microsoft.com';
const SCOPE_TITLES = 'https://titles.prod.mos.microsoft.com/.default openid profile offline_access';
const SCOPE_AUTHSVC = 'https://api.spaces.skype.com/Region.ReadWrite openid profile offline_access';
const CLIENT_ID = '7ea7c24c-b1f6-4a20-9d11-9ae12e9e7ac0';
const TENANT_ID = 'common';
const AAD_BASE_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0`;
const HTTP_TIMEOUT = 60000; // 60 seconds for individual requests
const POLL_INTERVAL = 7000; // 7 seconds between polls
const FORCE_DIRECT_MOS3_URL = process.env.FORCE_DIRECT_MOS3_URL === 'true';
const USE_TITLES_TOKEN_FLOW = process.env.USE_TITLES_TOKEN_FLOW !== 'false';

async function getToken() {
  if (process.env.USE_AZ_CLI_TOKEN === 'true') {
    const cliToken = tryGetTokenFromAzureCli();
    if (cliToken) {
      return cliToken;
    }
    console.log('Azure CLI token unavailable. Falling back to Teams Toolkit client device code flow...');
  }

  return await acquireTokenByDeviceCode(SCOPE_AUTHSVC, 'AuthSvc (api.spaces.skype.com)');
}

async function acquireTokenByDeviceCode(scope, label) {
  const maxDeviceCodeAttempts = 5;

  for (let deviceAttempt = 1; deviceAttempt <= maxDeviceCodeAttempts; deviceAttempt++) {
    console.log(`Requesting M365 token for ${label} via direct device code flow (attempt ${deviceAttempt}/${maxDeviceCodeAttempts})...`);

    const deviceCodeResp = await axios.default.post(
      `${AAD_BASE_URL}/devicecode`,
      new URLSearchParams({
        client_id: CLIENT_ID,
        scope,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: HTTP_TIMEOUT,
      }
    );

    const deviceCode = deviceCodeResp.data.device_code;
    const intervalSec = Number(deviceCodeResp.data.interval || 5);
    const expiresInSec = Number(deviceCodeResp.data.expires_in || 900);
    const start = Date.now();

    console.log(`\n${deviceCodeResp.data.message}`);
    console.log('\nWaiting for you to authenticate...\n');

    while (Date.now() - start < expiresInSec * 1000) {
      await sleep(intervalSec * 1000);

      try {
        const tokenResp = await axios.default.post(
          `${AAD_BASE_URL}/token`,
          new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            client_id: CLIENT_ID,
            device_code: deviceCode,
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: HTTP_TIMEOUT,
          }
        );

        if (tokenResp.data.access_token) {
          console.log(`Token acquired for ${label}.`);
          return tokenResp.data.access_token;
        }
      } catch (pollErr) {
        const data = pollErr.response?.data;
        const msg = String(pollErr?.message || '');
        const errorCode = data?.error;

        if (
          msg.includes('ETIMEDOUT') ||
          msg.includes('ECONNRESET') ||
          msg.includes('ENETUNREACH') ||
          msg.includes('EHOSTUNREACH')
        ) {
          console.log(`Transient network issue while polling token endpoint (${msg}). Retrying...`);
          continue;
        }

        if (errorCode === 'authorization_pending') {
          continue;
        }
        if (errorCode === 'slow_down') {
          await sleep(5000);
          continue;
        }
        if (errorCode === 'expired_token') {
          console.log('Device code expired before authentication completed. Requesting a fresh code...');
          break;
        }

        throw new Error(`Device code token polling failed: ${JSON.stringify(data || pollErr.message)}`);
      }
    }
  }

  throw new Error('Device code flow timed out after multiple attempts.');
}

function tryGetTokenFromAzureCli() {
  try {
    console.log('Attempting token acquisition from Azure CLI session...');
    const token = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        'az account get-access-token --resource https://api.spaces.skype.com --query accessToken -o tsv',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();

    if (token) {
      console.log('Token acquired from Azure CLI.');
      return token;
    }

    return null;
  } catch (err) {
    const reason = err?.stderr?.toString()?.trim() || err.message;
    console.log(`Azure CLI token acquisition failed: ${reason}`);
    return null;
  }
}

async function getTitlesServiceUrl(token) {
  const resp = await axios.default.get('/config/v1/environment', {
    baseURL: MOS3_ENDPOINT,
    headers: { Authorization: `Bearer ${token}` },
    timeout: HTTP_TIMEOUT,
  });
  const url = resp.data.titlesServiceUrl;
  console.log(`Titles service URL: ${url}`);
  return url;
}

async function uploadPackage(token, titlesUrl) {
  console.log(`Reading package: ${PACKAGE_PATH}`);
  const packageBuffer = fs.readFileSync(PACKAGE_PATH);

  const form = new FormData();
  form.append('package', packageBuffer, { filename: 'appPackage.dev.zip', contentType: 'application/zip' });
  form.append('info', JSON.stringify({ builderName: 'TeamsToolKit' }));

  const headers = form.getHeaders();
  headers.Authorization = `Bearer ${token}`;

  console.log('Uploading package (async, no shouldBlock)...');
  const resp = await axios.default.post('/builder/v1/users/packages', form, {
    baseURL: titlesUrl,
    headers,
    // NOTE: intentionally NOT sending shouldBlock=true — lets server return 202 immediately
    params: { scope: 'personal' },
    timeout: HTTP_TIMEOUT,
    maxBodyLength: Infinity,
  });

  console.log(`Upload response status: ${resp.status}`);

  if (resp.status === 200 || resp.status === 201) {
    const titleId = resp.data.titlePreview?.titleId || resp.data.titleId;
    const appId = resp.data.titlePreview?.appId || resp.data.appId;
    console.log(`\n✅ Done immediately!`);
    console.log(`TitleId: ${titleId}`);
    console.log(`AppId:   ${appId}`);
    return { titleId, appId };
  }

  if (resp.status === 202) {
    const statusId = resp.data.statusId;
    console.log(`Processing asynchronously. StatusId: ${statusId}`);
    return await pollStatus(token, titlesUrl, statusId);
  }

  throw new Error(`Unexpected status ${resp.status}: ${JSON.stringify(resp.data)}`);
}

async function pollStatus(token, titlesUrl, statusId) {
  let attempt = 0;
  while (true) {
    attempt++;
    await sleep(POLL_INTERVAL);
    console.log(`Poll attempt ${attempt} for statusId ${statusId}...`);

    const resp = await axios.default.get(`/builder/v1/users/packages/status/${statusId}`, {
      baseURL: titlesUrl,
      headers: { Authorization: `Bearer ${token}` },
      timeout: HTTP_TIMEOUT,
    });

    console.log(`  Poll status: ${resp.status}`);

    if (resp.status === 200) {
      const titleId = resp.data.titleId || resp.data.titlePreview?.titleId;
      const appId = resp.data.appId || resp.data.titlePreview?.appId;
      console.log(`\n✅ Sideloading complete!`);
      console.log(`TitleId: ${titleId}`);
      console.log(`AppId:   ${appId}`);
      return { titleId, appId };
    }

    if (attempt > 60) {
      throw new Error('Polling timed out after 7 minutes');
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  try {
    console.log('=== ITSM Operations M365 Extend Tool ===');
    console.log(`Package: ${PACKAGE_PATH}`);
    if (!fs.existsSync(PACKAGE_PATH)) {
      throw new Error(`Package not found: ${PACKAGE_PATH}`);
    }

    let titlesUrl = MOS3_ENDPOINT;
    if (!FORCE_DIRECT_MOS3_URL && USE_TITLES_TOKEN_FLOW) {
      const titlesToken = await acquireTokenByDeviceCode(SCOPE_TITLES, 'MOS3 (titles.prod.mos.microsoft.com)');
      titlesUrl = await getTitlesServiceUrl(titlesToken);
    } else if (!FORCE_DIRECT_MOS3_URL) {
      const authSvcTokenForConfig = await getToken();
      titlesUrl = await getTitlesServiceUrl(authSvcTokenForConfig);
    } else {
      console.log(`FORCE_DIRECT_MOS3_URL=true. Using direct URL: ${MOS3_ENDPOINT}`);
    }

    const authSvcToken = await getToken();
    const result = await uploadPackage(authSvcToken, titlesUrl);

    console.log('\n--- Update env/.env.dev with: ---');
    console.log(`M365_TITLE_ID=${result.titleId}`);
    console.log(`M365_APP_ID=${result.appId}`);
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.stack) {
      console.error('Stack:', err.stack);
    }
    if (err.errorCode) {
      console.error('MSAL errorCode:', err.errorCode);
    }
    if (err.subError) {
      console.error('MSAL subError:', err.subError);
    }
    if (err.response) {
      console.error('Response status:', err.response.status);
      console.error('Response data:', JSON.stringify(err.response.data, null, 2));
    }
    process.exit(1);
  }
}

main();
