import { test, expect } from '@playwright/test';

// Phase 3-7 endpoints: Foresight, Outcomes, Governance, Goals, Autonomy
// These are tolerant pre-deploy: 404/401 means not-yet-deployed and is treated as skip.

const NOT_DEPLOYED = (status: number) => status === 404 || status === 401;

test.describe('ITSM DA — Anticipatory Pillars (Phases 3–7)', () => {
  test('GET /api/foresight returns forecast envelope', async ({ request }) => {
    const res = await request.get('/api/foresight?limit=10');
    if (NOT_DEPLOYED(res.status())) test.skip(true, '/api/foresight not yet deployed');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('forecasts');
    expect(Array.isArray(body.forecasts)).toBe(true);
  });

  test('GET /api/outcomes returns outcome envelope', async ({ request }) => {
    const res = await request.get('/api/outcomes?limit=10');
    if (NOT_DEPLOYED(res.status())) test.skip(true, '/api/outcomes not yet deployed');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('outcomes');
    expect(Array.isArray(body.outcomes)).toBe(true);
  });

  test('GET /api/governance returns kill-switch + freeze + budget + statements', async ({ request }) => {
    const res = await request.get('/api/governance');
    if (NOT_DEPLOYED(res.status())) test.skip(true, '/api/governance not yet deployed');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('killSwitch');
    expect(body).toHaveProperty('changeFreezeActive');
    expect(body).toHaveProperty('budget');
    expect(body).toHaveProperty('statementsOfAutonomy');
    expect(Array.isArray(body.statementsOfAutonomy)).toBe(true);
  });

  test('GET /api/goals returns recipe catalog', async ({ request }) => {
    const res = await request.get('/api/goals');
    if (NOT_DEPLOYED(res.status())) test.skip(true, '/api/goals not yet deployed');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('recipes');
    expect(Array.isArray(body.recipes)).toBe(true);
  });

  test('GET /api/autonomy/thresholds returns tuned thresholds', async ({ request }) => {
    const res = await request.get('/api/autonomy/thresholds?workflowId=incident&signalType=incident.high');
    if (NOT_DEPLOYED(res.status())) test.skip(true, '/api/autonomy/thresholds not yet deployed');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('workflowId');
    expect(body).toHaveProperty('signalType');
    expect(body).toHaveProperty('tuned');
    expect(body.tuned).toHaveProperty('autoThreshold');
    expect(body.tuned).toHaveProperty('proposeThreshold');
    expect(body.tuned).toHaveProperty('warmedUp');
  });

  test('POST /api/goals/plan returns a plan for a known recipe', async ({ request }) => {
    const res = await request.post('/api/goals/plan', { data: { goal: 'restore service x' } });
    if (NOT_DEPLOYED(res.status())) test.skip(true, '/api/goals/plan not yet deployed');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('plan');
    expect(body.plan).toHaveProperty('steps');
    expect(Array.isArray(body.plan.steps)).toBe(true);
  });
});
