import { statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { OWNER_LOGIN } from "./e2e/owner.ts";

/**
 * How far this copy's ports move up, so copies of the repo side by side (git worktrees, where
 * `.git` is a file) can run their browser tests at the same time. The main checkout keeps 8799
 * and 8798; a worktree moves both by a multiple of ten picked from its folder's name, so the same
 * folder always gets the same ports. In a Courtyard code session, its slot among the code sessions
 * running (#174), which no other running one has, picks them instead, past every folder's own;
 * a session's helper on a branch of its own (#395) runs in another folder than the one that slot
 * is for, so its folder picks them.
 */
const portShift = (() => {
  const slot = Number(process.env.COURTYARD_SESSION_SLOT);
  const slotted = process.env.COURTYARD_SESSION_WORKTREE;
  const here = (path: string) => resolve(path).toLowerCase() === import.meta.dirname.toLowerCase();
  if (Number.isInteger(slot) && slot > 0 && (slotted === undefined || here(slotted))) {
    return 1000 + 10 * slot;
  }
  const dotGit = statSync(join(import.meta.dirname, ".git"), { throwIfNoEntry: false });
  if (!dotGit?.isFile()) return 0;
  let hash = 0;
  for (const char of basename(import.meta.dirname)) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return 10 * ((hash % 90) + 1);
})();

const port = 8799 + portShift;
/** A second worker, for the one test that clears everything: a fresh start. */
const freshStartPort = 8798 + portShift;

/**
 * The tests that sign in to the worker's fake GitHub and out again (#419): `github.spec.ts`, the
 * `github-*.spec.ts` beside it, and these.
 */
const GITHUB_SPECS = /(github(-[a-z-]+)?|layout-shift|lead|roomy-fold)\.spec\.ts$/;

/** What both workers share: the fake providers, and never the real Claude Code or Codex. */
const providers = {
  COURTYARD_FAKE_PROVIDER: "1",
  // The fake acts signed out, so signing in from Settings can be tested.
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
  // On CI, a failed test is also an annotation on its job, which names it when the worker files a
  // red main (#355).
  reporter: process.env.CI ? [["dot"], ["github"]] : "list",
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
      testIgnore: [/fresh-start.spec.ts$/, GITHUB_SPECS],
    },
    {
      // The worker's fake GitHub has one sign-in, which these tests sign in and out of: one at a
      // time, so one never signs out under another (#419). One at a time is slow, so CI gives them
      // shards of their own, each with its own worker (#587).
      name: "github",
      use: { ...devices["Desktop Chrome"], storageState: OWNER_LOGIN },
      dependencies: ["setup"],
      testMatch: GITHUB_SPECS,
      workers: 1,
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
        // A builds lock of its own (#306), never the machine's, which `pnpm e2e` itself holds.
        COURTYARD_BUILDS_LOCK_DIR: "test-results/e2e/builds",
        // Previews' ports (#183) of their own, never the live worker's (9901 to 9906), moved up as
        // the copy's own ports are, so copies side by side never share one.
        COURTYARD_PREVIEW_PORTS: `${7901 + portShift}-${7906 + portShift}`,
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
        COURTYARD_BUILDS_LOCK_DIR: "test-results/e2e-fresh-start/builds",
        COURTYARD_PREVIEW_PORTS: `${7907 + portShift}-${7909 + portShift}`,
        ...providers,
      },
    },
  ],
});
