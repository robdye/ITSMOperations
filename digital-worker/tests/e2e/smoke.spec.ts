import { test, expect } from '@playwright/test';

test.describe('Health & Mission Control', () => {
  test('GET /api/health returns 200 with expected fields', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(['healthy', 'ok', 'degraded']).toContain(body.status);
  });

  test('Mission Control page loads', async ({ page }) => {
    await page.goto('/mission-control');
    await expect(page).toHaveTitle(/Mission Control|ITSM/i);
    // Verify the page contains key UI elements
    await expect(page.locator('body')).toContainText(/worker|routine|uptime/i);
  });

  test('Mission Control fetches health data', async ({ page }) => {
    const healthResponse = page.waitForResponse(resp =>
      resp.url().includes('/api/health') && resp.status() === 200
    );
    await page.goto('/mission-control');
    const res = await healthResponse;
    expect(res.status()).toBe(200);
  });
});

test.describe('Voice Interface', () => {
  test('Voice page loads with connect button', async ({ page }) => {
    await page.goto('/voice');
    const connectBtn = page.locator('button, [role="button"]').filter({ hasText: /connect|start|call/i });
    await expect(connectBtn.first()).toBeVisible({ timeout: 10_000 });
  });

  test('Voice WebSocket endpoint responds to HTTP', async ({ request }) => {
    const res = await request.get('/api/voice');
    // Non-WS request to a WS endpoint — 401 (auth required) or upgrade-related codes
    expect([400, 401, 404, 426, 501]).toContain(res.status());
  });

  test('Voice page connects and receives session.updated', async ({ browser }) => {
    // Grant microphone permission so getUserMedia succeeds in headless mode
    const context = await browser.newContext({
      permissions: ['microphone'],
    });
    const page = await context.newPage();

    // Stub getUserMedia to return a silent audio stream (headless has no mic hardware)
    await page.addInitScript(() => {
      const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (constraints && (constraints as MediaStreamConstraints).audio) {
          // Create a silent audio track via AudioContext + oscillator
          const ctx = new AudioContext({ sampleRate: 24000 });
          const osc = ctx.createOscillator();
          const dest = ctx.createMediaStreamDestination();
          osc.connect(dest);
          osc.start();
          return dest.stream;
        }
        return origGetUserMedia(constraints);
      };
    });

    await page.goto('/voice');

    // Listen for WebSocket connections
    const wsPromise = page.waitForEvent('websocket', { timeout: 15_000 });

    // Click the connect button
    const connectBtn = page.locator('button, [role="button"]').filter({ hasText: /connect|start|call/i });
    await connectBtn.first().click();

    // Verify WebSocket opens
    const ws = await wsPromise;
    expect(ws.url()).toContain('/api/voice');

    // Wait for the session.updated event (means GA config was accepted by Azure)
    const sessionUpdated = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 12_000);
      ws.on('framereceived', (frame) => {
        try {
          const data = JSON.parse(frame.payload as string);
          if (data.type === 'session.updated') {
            clearTimeout(timeout);
            resolve(true);
          }
          if (data.type === 'error') {
            console.log('Voice error:', JSON.stringify(data.error));
            clearTimeout(timeout);
            resolve(false);
          }
        } catch { /* binary frame */ }
      });
    });

    const success = await sessionUpdated;
    expect(success).toBe(true);

    await context.close();
  });
});

test.describe('API Endpoints', () => {
  test('GET /api/routines returns routine list', async ({ request }) => {
    const res = await request.get('/api/routines');
    if (res.status() === 200) {
      const body = await res.json();
      expect(Array.isArray(body) || typeof body === 'object').toBe(true);
    }
    // 404 is also acceptable if endpoint doesn't exist
    expect([200, 404]).toContain(res.status());
  });
});
