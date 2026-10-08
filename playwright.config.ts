import { defineConfig, devices } from "@playwright/test";
import { OWNER_LOGIN } from "./e2e/owner.ts";

const port = 8799;
/** A second worker, for the one test that clears everything: a fresh start. */
const freshStartPort = 8798;

/** What both workers share: the fake providers, and never the real Claude Code or Codex. */
const providers = {
  COURTYARD_FAKE_PROVIDER: "1",
  // The fake acts signed out, so signing in from the home page can be tested.
  COURTYARD_FAKE_SIGN_IN: "1",
  // A second fake, which acts out a usage limit, so overflow can be tested.
  COURTYARD_SECOND_FAKE_PROVIDER: "1",
  COURTYARD_CLAUDE_PROVIDER: "0",
  COURTYARD_CODEX_PROVIDER: "0",
};

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
      testIgnore: /fresh-start.spec.ts$/,
    },
    {
      // On its own worker and folders, so clearing everything never touches the other tests.
      name: "fresh-start",
      testMatch: /fresh-start.spec.ts$/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${freshStartPort}` },
    },
  ],
  // Always fresh workers, so the tests never run against a stale one left on a port.
  webServer: [
    {
      command: "node e2e/start-worker.mjs",
      url: `http://localhost:${port}/api/health`,
      reuseExistingServer: false,
      env: {
        COURTYARD_PORT: String(port),
        // A copy of e2e/fixtures/context, made fresh by start-worker.mjs.
        COURTYARD_CONTEXT_DIR: "test-results/e2e/context",
        COURTYARD_DATA_DIR: "test-results/e2e/data",
        ...providers,
      },
    },
    {
      command: "node e2e/start-worker.mjs",
      url: `http://localhost:${freshStartPort}/api/health`,
      reuseExistingServer: false,
      env: {
        COURTYARD_PORT: String(freshStartPort),
        COURTYARD_CONTEXT_DIR: "test-results/e2e-fresh-start/context",
        COURTYARD_DATA_DIR: "test-results/e2e-fresh-start/data",
        ...providers,
      },
    },
  ],
});
