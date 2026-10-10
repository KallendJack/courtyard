// Starts the worker for the browser tests on a fresh data folder, so every run begins as a new
// install with no owner yet, plus one long session to check that long sessions stay smooth. The
// context folder is a fresh copy of the fixtures, so adding a workspace never touches the repo.
// The worker runs as a live copy whose main has moved on, with a stand-in for the update script.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SessionEvent, SessionSummary } from "../packages/contract/index.ts";
import { LONG_SESSION_ID, LONG_SESSION_TURNS } from "./long-session.ts";

const dataDir = process.env.COURTYARD_DATA_DIR;
if (!dataDir)
  throw new Error("COURTYARD_DATA_DIR isn't set: start the browser tests with Playwright");
rmSync(dataDir, { recursive: true, force: true });

const contextDir = process.env.COURTYARD_CONTEXT_DIR;
if (!contextDir)
  throw new Error("COURTYARD_CONTEXT_DIR isn't set: start the browser tests with Playwright");
rmSync(contextDir, { recursive: true, force: true });
cpSync(join(import.meta.dirname, "fixtures", "context"), contextDir, { recursive: true });

// The long session, written in the worker's own formats: parsing each record with the contract's
// schemas means a format change fails here, by name, rather than as a blank page in a test.
const folder = join(dataDir, "sessions", LONG_SESSION_ID);
mkdirSync(folder, { recursive: true });
const at = "2026-10-01T12:00:00.000Z";
const session = SessionSummary.omit({ busy: true }).parse({
  id: LONG_SESSION_ID,
  workspaceId: "garage-gym",
  title: "A long session",
  createdAt: at,
  updatedAt: at,
});
writeFileSync(join(folder, "session.json"), JSON.stringify(session));

const model = { provider: "fake", model: "echo" };
const events = [];
let seq = 0;
for (let turn = 1; turn <= LONG_SESSION_TURNS; turn++) {
  events.push({ seq: ++seq, at, type: "owner-message", text: `Message ${turn}`, model });
  events.push({ seq: ++seq, at, type: "text-delta", text: `You said: Message ${turn}` });
  events.push({ seq: ++seq, at, type: "turn-completed" });
}
const lines = events.map((event) => JSON.stringify(SessionEvent.parse(event)));
writeFileSync(join(folder, "events.jsonl"), `${lines.join("\n")}\n`);

// A live copy one commit behind its remote's main, as if a PR had just been merged.
const liveDir = join(dataDir, "..", "live");
rmSync(liveDir, { recursive: true, force: true });
const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
mkdirSync(liveDir, { recursive: true });
git(liveDir, "init", "-q", "--bare", "-b", "main", "remote.git");
git(liveDir, "clone", "-q", "remote.git", "pusher");
const pusher = join(liveDir, "pusher");
for (const title of ["The running version", "A newer version"]) {
  writeFileSync(
    join(pusher, "notes.md"),
    `${title}
`,
  );
  git(pusher, "add", ".");
  git(pusher, "commit", "-qm", title);
  git(pusher, "push", "-q", "origin", "main");
  // The live copy is cloned while main is still the running version.
  if (title === "The running version") git(liveDir, "clone", "-q", "remote.git", "copy");
}
const liveCopy = join(liveDir, "copy");
git(liveCopy, "fetch", "-q", "origin", "main");

const version = (ref) => ({
  commit: git(liveCopy, "rev-parse", ref),
  title: git(liveCopy, "log", "-1", "--format=%h %s", ref),
});

/** Stands in for scripts/live/update.ps1: says it's running, then moves the copy on to main. */
const standInUpdate = () => {
  const from = version("HEAD");
  const result = (outcome, to, message, finished) =>
    writeFileSync(
      join(dataDir, "live-update.json"),
      JSON.stringify({
        outcome,
        from,
        to,
        message,
        startedAt,
        finishedAt: finished ? new Date().toISOString() : null,
      }),
    );
  const startedAt = new Date().toISOString();
  result("running", from, "Updating.", false);
  setTimeout(() => {
    git(liveCopy, "merge", "-q", "--ff-only", "origin/main");
    const to = version("HEAD");
    result("updated", to, `Updated to ${to.title}. Courtyard is running.`, true);
  }, 1500);
};

// A code workspace, Side project, on a repository of its own whose remote stands in for GitHub
// (#170): each session there gets a branch of its own from the remote's main.
const codeDir = resolve(dataDir, "..", "code");
rmSync(codeDir, { recursive: true, force: true });
mkdirSync(codeDir, { recursive: true });
git(codeDir, "init", "-q", "--bare", "-b", "main", "origin.git");
git(codeDir, "clone", "-q", "origin.git", "repo");
const repo = join(codeDir, "repo");
git(repo, "config", "user.name", "Test");
git(repo, "config", "user.email", "test@example.com");
writeFileSync(join(repo, "README.md"), "# Side project\n");
git(repo, "add", ".");
git(repo, "commit", "-qm", "Start");
git(repo, "push", "-q", "origin", "main");
mkdirSync(join(contextDir, "side-project"), { recursive: true });
writeFileSync(
  join(contextDir, "side-project", "workspace.json"),
  JSON.stringify({ name: "Side project", mode: "code", repoPath: repo }),
);

const { startWorker } = await import("../apps/worker/src/start.ts");
// GitHub in memory (#99): a sign-in finishes a couple of seconds after it starts.
const { createFakeGitHub } = await import("../apps/worker/src/github/fake.ts");
// A push service in memory (#173), so a device turned on in a test is never sent to for real.
const { createFakePush } = await import("../apps/worker/src/notifications/fake.ts");
// A context backup that isn't there, so the home page says the backup is behind and why.
const missingBackup = join(dataDir, "..", "missing-backup.git");
rmSync(missingBackup, { recursive: true, force: true });

startWorker({
  env: { ...process.env, COURTYARD_LIVE_COPY: liveCopy, COURTYARD_CONTEXT_REMOTE: missingBackup },
  startUpdate: standInUpdate,
  github: createFakeGitHub({ finishAfterMs: 2000 }).api,
  sendPush: createFakePush().send,
});
