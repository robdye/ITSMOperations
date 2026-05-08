import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**'],
      // The mcp-server is dominated by the long mcp-server.ts entry
      // file (its tools are exercised end-to-end at integration time).
      // Floor numbers keep the unit-test suite honest without forcing
      // unit tests for handlers that need a live MCP transport.
      thresholds: {
        statements: 20,
        branches: 12,
        functions: 20,
        lines: 22,
      },
    },
  },
});
