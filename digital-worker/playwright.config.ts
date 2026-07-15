import { defineConfig } from '@playwright/test';

// Set these variables explicitly for live validation. Defaults stay local so
// an e2e run cannot accidentally target a stale customer environment.
const ITSM_BASE = process.env.ITSM_BASE_URL
  || 'http://127.0.0.1:3978';
const ITSM_MCP = process.env.ITSM_MCP_URL
  || 'http://127.0.0.1:3002';

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
      name: 'itsm-customer-readiness',
      testMatch: /itsm-customer-readiness\.spec\.ts/,
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
