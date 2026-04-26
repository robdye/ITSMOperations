# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Voice Interface >> Voice page connects and receives session.updated
- Location: tests\e2e\smoke.spec.ts:42:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - banner [ref=e2]:
    - generic [ref=e3]: ⚡
    - heading "ITSM Operations" [level=1] [ref=e4]
    - generic [ref=e5]: Voice Live
  - generic [ref=e6]:
    - generic [ref=e9]: "Error: Unknown parameter: 'session.temperature'."
    - generic [ref=e10]:
      - button "Connect" [disabled] [ref=e11]
      - button "Mute" [ref=e12] [cursor=pointer]
      - button "Disconnect" [ref=e13] [cursor=pointer]
    - generic [ref=e14]: Transcript will appear here...
  - contentinfo [ref=e15]: ITSM Operations · Digital Worker · Powered by Azure Voice Live
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | test.describe('Health & Mission Control', () => {
  4   |   test('GET /api/health returns 200 with expected fields', async ({ request }) => {
  5   |     const res = await request.get('/api/health');
  6   |     expect(res.status()).toBe(200);
  7   |     const body = await res.json();
  8   |     expect(body).toHaveProperty('status');
  9   |     expect(['healthy', 'ok', 'degraded']).toContain(body.status);
  10  |   });
  11  | 
  12  |   test('Mission Control page loads', async ({ page }) => {
  13  |     await page.goto('/mission-control');
  14  |     await expect(page).toHaveTitle(/Mission Control|ITSM/i);
  15  |     // Verify the page contains key UI elements
  16  |     await expect(page.locator('body')).toContainText(/worker|routine|uptime/i);
  17  |   });
  18  | 
  19  |   test('Mission Control fetches health data', async ({ page }) => {
  20  |     const healthResponse = page.waitForResponse(resp =>
  21  |       resp.url().includes('/api/health') && resp.status() === 200
  22  |     );
  23  |     await page.goto('/mission-control');
  24  |     const res = await healthResponse;
  25  |     expect(res.status()).toBe(200);
  26  |   });
  27  | });
  28  | 
  29  | test.describe('Voice Interface', () => {
  30  |   test('Voice page loads with connect button', async ({ page }) => {
  31  |     await page.goto('/voice');
  32  |     const connectBtn = page.locator('button, [role="button"]').filter({ hasText: /connect|start|call/i });
  33  |     await expect(connectBtn.first()).toBeVisible({ timeout: 10_000 });
  34  |   });
  35  | 
  36  |   test('Voice WebSocket endpoint responds to HTTP', async ({ request }) => {
  37  |     const res = await request.get('/api/voice');
  38  |     // Non-WS request to a WS endpoint — 401 (auth required) or upgrade-related codes
  39  |     expect([400, 401, 404, 426, 501]).toContain(res.status());
  40  |   });
  41  | 
  42  |   test('Voice page connects and receives session.updated', async ({ browser }) => {
  43  |     // Grant microphone permission so getUserMedia succeeds in headless mode
  44  |     const context = await browser.newContext({
  45  |       permissions: ['microphone'],
  46  |     });
  47  |     const page = await context.newPage();
  48  | 
  49  |     // Stub getUserMedia to return a silent audio stream (headless has no mic hardware)
  50  |     await page.addInitScript(() => {
  51  |       const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  52  |       navigator.mediaDevices.getUserMedia = async (constraints) => {
  53  |         if (constraints && (constraints as MediaStreamConstraints).audio) {
  54  |           // Create a silent audio track via AudioContext + oscillator
  55  |           const ctx = new AudioContext({ sampleRate: 24000 });
  56  |           const osc = ctx.createOscillator();
  57  |           const dest = ctx.createMediaStreamDestination();
  58  |           osc.connect(dest);
  59  |           osc.start();
  60  |           return dest.stream;
  61  |         }
  62  |         return origGetUserMedia(constraints);
  63  |       };
  64  |     });
  65  | 
  66  |     await page.goto('/voice');
  67  | 
  68  |     // Listen for WebSocket connections
  69  |     const wsPromise = page.waitForEvent('websocket', { timeout: 15_000 });
  70  | 
  71  |     // Click the connect button
  72  |     const connectBtn = page.locator('button, [role="button"]').filter({ hasText: /connect|start|call/i });
  73  |     await connectBtn.first().click();
  74  | 
  75  |     // Verify WebSocket opens
  76  |     const ws = await wsPromise;
  77  |     expect(ws.url()).toContain('/api/voice');
  78  | 
  79  |     // Wait for the session.updated event (means GA config was accepted by Azure)
  80  |     const sessionUpdated = new Promise<boolean>((resolve) => {
  81  |       const timeout = setTimeout(() => resolve(false), 12_000);
  82  |       ws.on('framereceived', (frame) => {
  83  |         try {
  84  |           const data = JSON.parse(frame.payload as string);
  85  |           if (data.type === 'session.updated') {
  86  |             clearTimeout(timeout);
  87  |             resolve(true);
  88  |           }
  89  |           if (data.type === 'error') {
  90  |             console.log('Voice error:', JSON.stringify(data.error));
  91  |             clearTimeout(timeout);
  92  |             resolve(false);
  93  |           }
  94  |         } catch { /* binary frame */ }
  95  |       });
  96  |     });
  97  | 
  98  |     const success = await sessionUpdated;
> 99  |     expect(success).toBe(true);
      |                     ^ Error: expect(received).toBe(expected) // Object.is equality
  100 | 
  101 |     await context.close();
  102 |   });
  103 | });
  104 | 
  105 | test.describe('API Endpoints', () => {
  106 |   test('GET /api/routines returns routine list', async ({ request }) => {
  107 |     const res = await request.get('/api/routines');
  108 |     if (res.status() === 200) {
  109 |       const body = await res.json();
  110 |       expect(Array.isArray(body) || typeof body === 'object').toBe(true);
  111 |     }
  112 |     // 404 is also acceptable if endpoint doesn't exist
  113 |     expect([200, 404]).toContain(res.status());
  114 |   });
  115 | });
  116 | 
```