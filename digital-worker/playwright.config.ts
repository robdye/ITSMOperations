import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.TEST_BASE_URL
  || 'https://itsm-operations-worker.jollysand-88b78b02.eastus.azurecontainerapps.io';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
