import { defineConfig, devices } from "@playwright/test";

const port = 8799;

/**
 * End-to-end tests run the built web app against a real worker, started here with throwaway
 * folders. Run `pnpm build` first; `pnpm verify` does.
 */
export default defineConfig({
  testDir: "e2e",
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node apps/worker/src/main.ts",
    url: `http://localhost:${port}/api/health`,
    // Always a fresh worker, so the tests never run against a stale one left on the port.
    reuseExistingServer: false,
    env: {
      COURTYARD_PORT: String(port),
      COURTYARD_CONTEXT_DIR: "e2e/fixtures/context",
      COURTYARD_DATA_DIR: "test-results/e2e/data",
    },
  },
});
