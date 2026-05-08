import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/index.ts', 'src/tools/**'],
      // Coverage thresholds for the package as a whole.
      //
      // The Phase 4 push lifted total line coverage from 27% → 32% by
      // adding smoke tests for case-manager, case-correlation,
      // case-reminders, reviewer-worker, meta-monitor,
      // change-window-planner, enrichment-bridge, a2a-policy,
      // workiq-api-client, voice/voiceApprovals, voice/voiceLiveTransport.
      //
      // The 7,113-line digital-worker codebase still includes large
      // HTTP / ACS / Realtime modules that need a live infra to drive,
      // so the global numbers below are a floor rather than a goal —
      // see docs/coverage.md for the per-module roadmap.
      thresholds: {
        statements: 30,
        branches: 24,
        functions: 28,
        lines: 30,
      },
    },
  },
});
