import { test, expect } from '@playwright/test';

test.describe('ITSM DA — Health & Platform Status', () => {
  test('GET /api/health → 200 with status=healthy and features', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body).toHaveProperty('features');
    expect(body.features.workers).toBeGreaterThanOrEqual(10);
    expect(body.features.voice).toBe(true);
  });

  test('GET /api/platform-status → 200 with service statuses', async ({ request }) => {
    const res = await request.get('/api/platform-status');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe('object');
    // Should contain at least one service key
    expect(Object.keys(body).length).toBeGreaterThan(0);
  });

  test('GET /api/workers → 200, workers with required fields', async ({ request }) => {
    const res = await request.get('/api/workers');
    expect(res.status()).toBe(200);
    const body = await res.json();
    // May be array or object with workers property
    const workers = Array.isArray(body) ? body : (body.workers || Object.values(body));
    expect(workers.length).toBeGreaterThan(0);
    for (const w of workers) {
      expect(w).toHaveProperty('id');
      expect(w).toHaveProperty('name');
    }
  });

  test('GET /api/routines → 200, routines with schedule metadata', async ({ request }) => {
    const res = await request.get('/api/routines');
    expect(res.status()).toBe(200);
    const body = await res.json();
    // API returns array of routines
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    // Spot-check first routine has expected shape
    const first = body[0];
    expect(first.id).toBeDefined();
    expect(first.status).toBeDefined();
    expect(['scheduled', 'disabled', 'running']).toContain(first.status);
    expect(first.schedule).toBeDefined();
    expect(first.worker).toBeDefined();
  });

  test('GET /api/audit → 200 or 404', async ({ request }) => {
    const res = await request.get('/api/audit');
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(Array.isArray(body) || typeof body === 'object').toBe(true);
    }
  });

  test('GET /api/memory → 200 or 404', async ({ request }) => {
    const res = await request.get('/api/memory');
    expect([200, 404]).toContain(res.status());
  });

  test('GET /api/reasoning → 200 or 404', async ({ request }) => {
    const res = await request.get('/api/reasoning');
    expect([200, 404]).toContain(res.status());
  });

  test('GET /api/approvals → 200 with approval queue', async ({ request }) => {
    const res = await request.get('/api/approvals');
    expect(res.status()).toBe(200);
    const body = await res.json();
    // May be empty array or object with items
    expect(Array.isArray(body) || typeof body === 'object').toBe(true);
  });

  test('GET /api/voice/status → 200', async ({ request }) => {
    const res = await request.get('/api/voice/status');
    expect(res.status()).toBe(200);
  });
});
