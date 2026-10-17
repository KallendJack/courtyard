// Previews Courtyard itself from a code session working on it (#183), as `pnpm preview:session`:
// the session's own worker, from its worktree, on the fake provider and throwaway folders as the
// browser tests' is, with Vite in front of it for the web app and its live reload. `pnpm dev`
// points at the live worker, so it's never used for this. Courtyard's Start preview runs it as a
// task with PORT set, and finds the app at the address Vite prints.
//
//   node scripts/preview/session.ts

import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const root = resolve(import.meta.dirname, "../..");
/** The throwaway folders, which git ignores; every run starts afresh in them. */
const folder = join(root, "test-results", "preview-session");

/** A port free on the machine now. */
const freePort = () =>
  new Promise<number>((done, failed) => {
    const probe = createServer();
    probe.once("error", failed);
    probe.listen(0, "localhost", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => done(port));
    });
  });

const webPort = Number(process.env.PORT) || (await freePort());
const workerPort = await freePort();

/**
 * The environment both get: none of the worker's own settings that started this task (the live
 * data folder's never touched), only the session's slot and the throwaway worker's.
 */
const env: NodeJS.ProcessEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("COURTYARD_") || name.startsWith("COURTYARD_SESSION_"),
    ),
  ),
  COURTYARD_PORT: String(workerPort),
  COURTYARD_CONTEXT_DIR: join(folder, "context"),
  COURTYARD_DATA_DIR: join(folder, "data"),
  COURTYARD_BUILDS_LOCK_DIR: join(folder, "builds"),
  COURTYARD_FAKE_PROVIDER: "1",
  COURTYARD_SECOND_FAKE_PROVIDER: "1",
  COURTYARD_CLAUDE_PROVIDER: "0",
  COURTYARD_CODEX_PROVIDER: "0",
  // Its own previews on any free ports, never the live worker's.
  COURTYARD_PREVIEW_PORTS: "0",
};
delete env.PORT;

const running: ChildProcess[] = [];
/** Runs a command line through the shell, as `pnpm` needs on Windows. */
const run = (command: string) => {
  const child = spawn(command, { cwd: root, env, stdio: "inherit", shell: true });
  running.push(child);
  // Either one ending ends the preview.
  child.on("exit", (code) => {
    for (const other of running) if (other !== child) other.kill();
    process.exit(code ?? 1);
  });
  return child;
};

// The browser tests' worker, with their workspaces and fakes (e2e/start-worker.mjs).
run("node e2e/start-worker.mjs");
for (;;) {
  const health = await fetch(`http://localhost:${workerPort}/api/health`).catch(() => undefined);
  if (health?.ok) break;
  await wait(500);
}

// The owner logs in to it with a password of its own, made fresh each time.
const password = randomBytes(12).toString("base64url");
const setUp = await fetch(`http://localhost:${workerPort}/api/setup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password }),
});
console.log(
  setUp.ok
    ? `This session's Courtyard is ready. Log in to it with the password ${password}`
    : `This session's Courtyard couldn't be set up (${setUp.status}).`,
);

// The web app, served by Vite on PORT, its API forwarded to the worker (apps/web/vite.config.ts).
run(`pnpm --filter @courtyard/web exec vite --port ${webPort} --strictPort --host localhost`);
