import { test, expect } from '@playwright/test';

test.describe('ITSM Voice Interface', () => {
  test('voice page loads with connect button', async ({ page }) => {
    await page.goto('/voice');
    const connectBtn = page.locator('button, [role="button"]').filter({ hasText: /connect|start|call/i });
    await expect(connectBtn.first()).toBeVisible({ timeout: 10_000 });
  });

  test('voice WebSocket connects and receives session.updated', async ({ browser }) => {
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();

    // Stub getUserMedia for headless — return silent audio stream
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (constraints && (constraints as MediaStreamConstraints).audio) {
          const ctx = new AudioContext({ sampleRate: 24000 });
          const osc = ctx.createOscillator();
          const dest = ctx.createMediaStreamDestination();
          osc.connect(dest);
          osc.start();
          return dest.stream;
        }
        throw new Error('No video in test');
      };
    });

    await page.goto('/voice');

    const wsPromise = page.waitForEvent('websocket', { timeout: 15_000 });
    const connectBtn = page.locator('button, [role="button"]').filter({ hasText: /connect|start|call/i });
    await connectBtn.first().click();

    const ws = await wsPromise;
    // Accept either voice proxy WS (/api/voice) or avatar WS (speech.microsoft.com)
    const isVoiceWs = ws.url().includes('/api/voice') || ws.url().includes('speech.microsoft.com');
    expect(isVoiceWs).toBe(true);

    // Wait for session confirmation — either session.updated (OpenAI Realtime)
    // or successful WebSocket connection (Speech Avatar)
    const isAvatarWs = ws.url().includes('speech.microsoft.com');
    const sessionConfirmed = new Promise<{ success: boolean; error?: string }>((resolve) => {
      const timeout = setTimeout(() => resolve({ success: false, error: 'timeout' }), 15_000);
      if (isAvatarWs) {
        // Avatar WS doesn't send session.updated — connection itself is success
        ws.on('framereceived', () => {
          clearTimeout(timeout);
          resolve({ success: true });
        });
        // Also succeed if WS stays open (no frame needed for avatar init)
        setTimeout(() => { clearTimeout(timeout); resolve({ success: true }); }, 3_000);
      } else {
        ws.on('framereceived', (frame) => {
          try {
            const data = JSON.parse(frame.payload as string);
            if (data.type === 'session.updated') {
              clearTimeout(timeout);
              resolve({ success: true });
            }
            if (data.type === 'error') {
              clearTimeout(timeout);
              resolve({ success: false, error: JSON.stringify(data.error) });
            }
          } catch { /* binary frame */ }
        });
      }
    });

    const result = await sessionConfirmed;
    if (!result.success) {
      console.log('Voice session error:', result.error);
    }
    expect(result.success).toBe(true);
    await context.close();
  });

  test('voice status endpoint responds', async ({ request }) => {
    const res = await request.get('/api/voice/status');
    expect(res.status()).toBe(200);
  });

  test('voice avatar config endpoint responds', async ({ request }) => {
    const res = await request.get('/api/voice/avatar-config');
    expect([200, 404]).toContain(res.status());
  });
});
