import { defineConfig } from '@playwright/test';

// ITSM Operations Digital Assistant - live URLs
const ITSM_BASE = process.env.ITSM_BASE_URL
  || 'https://itsm-operations-worker.jollysand-88b78b02.eastus.azurecontainerapps.io';
const ITSM_MCP = process.env.ITSM_MCP_URL
  || 'https://change-mgmt-mcp.jollysand-88b78b02.eastus.azurecontainerapps.io';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 1,
  workers: 2,
  use: {
    baseURL: ITSM_BASE,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'itsm-health',
      testMatch: /itsm-health\.spec\.ts/,
      use: { baseURL: ITSM_BASE },
    },
    {
      name: 'itsm-mission-control',
      testMatch: /itsm-mission-control\.spec\.ts/,
      use: { baseURL: ITSM_BASE },
    },
    {
      name: 'itsm-mcp',
      testMatch: /itsm-mcp\.spec\.ts/,
      use: { baseURL: ITSM_MCP },
    },
    {
      name: 'itsm-demo',
      testMatch: /itsm-demo-script\.spec\.ts/,
      use: { baseURL: ITSM_MCP },
    },
    {
      name: 'voice',
      testMatch: /voice\.spec\.ts/,
      use: { baseURL: ITSM_BASE },
    },
    {
      name: 'itsm-anticipatory',
      testMatch: /itsm-anticipatory\.spec\.ts/,
      use: { baseURL: ITSM_BASE },
    },
  ],
  reporter: [['list'], ['html', { open: 'never' }]],
});
