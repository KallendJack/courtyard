import { statSync } from "node:fs";
import { basename, join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { OWNER_LOGIN } from "./e2e/owner.ts";

/**
 * How far this copy's ports move up, so copies of the repo side by side (git worktrees, where
 * `.git` is a file) can run their browser tests at the same time. The main checkout keeps 8799
 * and 8798; a worktree moves both by a multiple of ten picked from its folder's name, so the same
 * folder always gets the same ports.
 */
const portShift = (() => {
  const dotGit = statSync(join(import.meta.dirname, ".git"), { throwIfNoEntry: false });
  if (!dotGit?.isFile()) return 0;
  let hash = 0;
  for (const char of basename(import.meta.dirname)) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return 10 * ((hash % 90) + 1);
})();

const port = 8799 + portShift;
/** A second worker, for the one test that clears everything: a fresh start. */
const freshStartPort = 8798 + portShift;

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
  // Every change commits to git, one command at a time, and each command is a new process. On
  // Windows those are slow to start, and slower still with another copy's tests running, so a
  // session's saves can take 20 seconds: a check waits up to 30, and a test up to a minute.
  timeout: 60_000,
  expect: { timeout: 30_000 },
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
