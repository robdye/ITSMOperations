import { test, expect } from '@playwright/test';

test.describe('ITSM DA — Mission Control Dashboard', () => {
  test('page loads at /mission-control with title', async ({ page }) => {
    await page.goto('/mission-control');
    await expect(page).toHaveTitle(/Mission Control|ITSM/i);
  });

  test('fetches /api/health on load', async ({ page }) => {
    const healthResponse = page.waitForResponse(
      resp => resp.url().includes('/api/health') && resp.status() === 200,
    );
    await page.goto('/mission-control');
    const res = await healthResponse;
    expect(res.status()).toBe(200);
  });

  test('shows worker count of 23', async ({ page }) => {
    await page.goto('/mission-control');
    // Wait for worker count to render
    await expect(page.locator('body')).toContainText(/23/, { timeout: 15_000 });
  });

  test('shows routine list with human-readable cron', async ({ page }) => {
    await page.goto('/mission-control');
    await page.waitForLoadState('networkidle');
    const body = await page.locator('body').textContent();
    // Should NOT contain raw cron like "0 */4 * * *" — should be human-readable
    expect(body).not.toMatch(/\d+\s\*\/\d+\s\*\s\*\s\*/);
    // Should contain schedule-related text
    expect(body).toMatch(/every|hour|minute|daily|scheduled/i);
  });

  test('shows scheduled status for active routines', async ({ page }) => {
    await page.goto('/mission-control');
    await page.waitForLoadState('networkidle');
    const body = await page.locator('body').textContent();
    // Active routines should show "scheduled", not "idle"
    expect(body?.toLowerCase()).toContain('scheduled');
  });

  test('shows uptime greater than 0m', async ({ page }) => {
    await page.goto('/mission-control');
    await page.waitForLoadState('networkidle');
    const body = await page.locator('body').textContent() ?? '';
    // Should show uptime — must not be exactly "0m" or "0s"
    const uptimeMatch = body.match(/uptime[:\s]*(\d+[hmd]\s*\d*[ms]?)/i);
    if (uptimeMatch) {
      expect(uptimeMatch[1]).not.toBe('0m');
      expect(uptimeMatch[1]).not.toBe('0s');
    }
    // At minimum the page should mention uptime
    expect(body.toLowerCase()).toContain('uptime');
  });

  test('page has no JavaScript console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/mission-control');
    await page.waitForLoadState('networkidle');
    // Filter out known benign errors (e.g., favicon 404)
    const realErrors = errors.filter(
      e => !e.includes('favicon') && !e.includes('404'),
    );
    expect(realErrors).toEqual([]);
  });
});
