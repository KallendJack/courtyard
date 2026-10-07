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
  // Every change commits to git, one at a time; with tests side by side on Windows that queue can
  // take a few seconds, so a check waits longer than the default five.
  expect: { timeout: 10_000 },
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
      // A copy of e2e/fixtures/context, made fresh by start-worker.mjs.
      COURTYARD_CONTEXT_DIR: "test-results/e2e/context",
      COURTYARD_DATA_DIR: "test-results/e2e/data",
      COURTYARD_FAKE_PROVIDER: "1",
      // The browser tests never start the real Claude Code or Codex.
      COURTYARD_CLAUDE_PROVIDER: "0",
      COURTYARD_CODEX_PROVIDER: "0",
    },
  },
});
