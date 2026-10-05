import { defineConfig, devices } from "@playwright/test";
import { OWNER_LOGIN } from "./e2e/owner.ts";

const port = 8799;

/**
 * End-to-end tests run the built web app against a real worker, started here with throwaway
 * folders. Run `pnpm build` first; `pnpm verify` does.
 */
export default defineConfig({
  testDir: "e2e",
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "setup", testMatch: /\.setup\.ts$/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: OWNER_LOGIN },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "node e2e/start-worker.mjs",
    url: `http://localhost:${port}/api/health`,
    // Always a fresh worker, so the tests never run against a stale one left on the port.
    reuseExistingServer: false,
    env: {
      COURTYARD_PORT: String(port),
      COURTYARD_CONTEXT_DIR: "e2e/fixtures/context",
      COURTYARD_DATA_DIR: "test-results/e2e/data",
      COURTYARD_FAKE_PROVIDER: "1",
      // The browser tests never start the real Claude Code.
      COURTYARD_CLAUDE_PROVIDER: "0",
    },
  },
});
