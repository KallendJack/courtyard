// Starts the worker for the browser tests on a fresh data folder, so every run begins as a new
// install with no owner yet, plus long sessions to check that long sessions stay smooth. The
// context folder is a fresh copy of the fixtures, so adding a workspace never touches the repo.
// The worker runs as a live copy whose main has moved on, with a stand-in for the update script.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SessionEvent, SessionSummary } from "../packages/contract/index.ts";
import { LONG_SESSION_ID, LONG_SESSION_TURNS, READING_SESSION_ID } from "./long-session.ts";

const dataDir = process.env.COURTYARD_DATA_DIR;
if (!dataDir)
  throw new Error("COURTYARD_DATA_DIR isn't set: start the browser tests with Playwright");
rmSync(dataDir, { recursive: true, force: true });

const contextDir = process.env.COURTYARD_CONTEXT_DIR;
if (!contextDir)
  throw new Error("COURTYARD_CONTEXT_DIR isn't set: start the browser tests with Playwright");
rmSync(contextDir, { recursive: true, force: true });
cpSync(join(import.meta.dirname, "fixtures", "context"), contextDir, { recursive: true });

// The long sessions, written in the worker's own formats: parsing each record with the contract's
// schemas means a format change fails here, by name, rather than as a blank page in a test.
const seedLongSession = (id, title) => {
  const folder = join(dataDir, "sessions", id);
  mkdirSync(folder, { recursive: true });
  const at = "2026-10-01T12:00:00.000Z";
  const session = SessionSummary.omit({ busy: true }).parse({
    id,
    workspaceId: "garage-gym",
    title,
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
};
seedLongSession(LONG_SESSION_ID, "A long session");
seedLongSession(READING_SESSION_ID, "A long read");

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
// Its remote is named by its address on GitHub, as a real clone's is (#172), while git reaches
// origin.git on disk in its place.
const onGitHub = "https://github.com/octo-owner/side-project.git";
const origin = join(codeDir, "origin.git");
git(repo, "remote", "set-url", "origin", onGitHub);
git(repo, "config", `url.${origin.replaceAll("\\", "/")}.insteadOf`, onGitHub);
git(repo, "config", "user.name", "Test");
git(repo, "config", "user.email", "test@example.com");
writeFileSync(join(repo, "README.md"), "# Side project\n");
git(repo, "add", ".");
git(repo, "commit", "-qm", "Start");
git(repo, "push", "-q", "origin", "main");

// Pull requests no session opened (#278), each a branch pushed to GitHub's copy: a Claude Code
// helper's, its description signed as its PR skill signs them; and a big one, with over 300 lines,
// one of them long, and a long description, for the PR page's one-screen checks.
const pushBranch = (branch, files, messages) => {
  git(repo, "switch", "-q", "-c", branch);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, name), text);
  git(repo, "add", ".");
  git(repo, "commit", "-q", ...messages.flatMap((message) => ["-m", message]));
  git(repo, "push", "-q", "origin", branch);
  git(repo, "switch", "-q", "main");
  // Only GitHub's copy has it, as a helper's branch would be.
  git(repo, "branch", "-q", "-D", branch);
};
pushBranch("306-machine-lock", { "builds.md": "Builds take turns across the whole PC\n" }, [
  "Builds queue across the whole PC [e2e running]",
  "## Summary\n\nBuilds take turns across the whole PC, not just the worker.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
]);
// One with a branch too long for its row, as Dependabot's are (#319).
pushBranch(
  "dependabot/docker_compose/home-assistant/home-assistant-60f18c2e9d",
  { "compose.md": "Home Assistant, a version on\n" },
  ["Bump home-assistant in the compose file [e2e passes]"],
);
const LONG_LINE = `export const wide = "${"a long line that never wraps ".repeat(12).trim()}";`;
pushBranch(
  "wide-review",
  {
    "wide.ts": [
      LONG_LINE,
      ...Array.from({ length: 320 }, (_, i) => `export const line${i + 1} = ${i + 1};`),
    ].join("\n"),
  },
  [
    "A wide review [e2e passes]",
    [
      "## Summary",
      "",
      "The review uses the whole width, so long lines read without wrapping.",
      "",
      ...Array.from(
        { length: 40 },
        (_, i) => `Paragraph ${i + 1} of a long description, which reads inside its own panel.\n`,
      ),
      "## Evidence",
      "",
      "A new e2e test at 1440 by 900 and 950 by 712.",
      "",
      "## Merge Danger",
      "",
      "Two-way door.",
    ].join("\n"),
  ],
);

mkdirSync(join(contextDir, "side-project"), { recursive: true });
writeFileSync(
  join(contextDir, "side-project", "workspace.json"),
  // Its sessions draw in Paper (ADR 0023): the fake plays Paper, so the command never runs.
  JSON.stringify({
    name: "Side project",
    mode: "code",
    repoPath: repo,
    connections: { paper: { command: "/path/to/paper", fileId: "file-1" } },
  }),
);

// A repo on GitHub that's no workspace's yet (#258), standing in as a bare repository on disk, for
// New workspace → Code to get onto the worker machine.
const kitchens = join(codeDir, "garrett-kitchens.git");
git(codeDir, "init", "-q", "--bare", "-b", "main", "garrett-kitchens.git");
git(codeDir, "clone", "-q", "garrett-kitchens.git", "kitchens-pusher");
const kitchensPusher = join(codeDir, "kitchens-pusher");
writeFileSync(join(kitchensPusher, "README.md"), "# Garrett Kitchens\n");
git(kitchensPusher, "add", ".");
git(kitchensPusher, "commit", "-qm", "Start");
git(kitchensPusher, "push", "-q", "origin", "main");

const { startWorker } = await import("../apps/worker/src/start.ts");
// GitHub in memory (#99): a sign-in finishes a couple of seconds after it starts. A session branch
// pushed to origin.git gets a pull request (#172), changing the files the branch changes (#160),
// and so does any other branch there once the PRs list is asked for (#278). Its checks are on each
// commit pushed: verify passes, and e2e fails, unless the commit's subject says "[e2e running]" or
// "[e2e passes]".
const { createFakeGitHub } = await import("../apps/worker/src/github/fake.ts");
// A push service in memory (#173), so a device turned on in a test is never sent to for real.
const { createFakePush } = await import("../apps/worker/src/notifications/fake.ts");
// A context backup that isn't there, so the home page says the backup is behind and why.
const missingBackup = join(dataDir, "..", "missing-backup.git");
rmSync(missingBackup, { recursive: true, force: true });

// Matt Pocock's skills for code workspaces (#181), from a stand-in for his plugin on disk, so
// GitHub is never reached: a few of his skills, and his setup skill's templates.
const { MATT_TEST_SKILLS, mattSkillsIn, writeMattPlugin } = await import(
  "../apps/worker/src/testing.ts"
);
const mattPlugin = join(dataDir, "..", "matt-plugin");
rmSync(mattPlugin, { recursive: true, force: true });
await writeMattPlugin(mattPlugin, {
  skills: [
    ...MATT_TEST_SKILLS,
    {
      name: "setup-matt-pocock-skills",
      ownerStarts: true,
      files: {
        "issue-tracker-github.md": "# Issue tracker: GitHub\n",
        "triage-labels.md": "# Triage Labels\n",
        "domain.md": "# Domain Docs\n",
      },
    },
  ],
});
const { pin, fetch } = await mattSkillsIn(mattPlugin);

startWorker({
  env: { ...process.env, COURTYARD_LIVE_COPY: liveCopy, COURTYARD_CONTEXT_REMOTE: missingBackup },
  mattSkills: { pin, fetch },
  startUpdate: standInUpdate,
  github: createFakeGitHub({
    finishAfterMs: 2000,
    // The repos its GitHub App reaches: Side project's, already a code workspace's, and one that
    // isn't yet, newest pushed first, then enough more to make 62, as many as the owner's (#286).
    repos: [
      "octo-owner/courtyard",
      {
        fullName: "octo-owner/garrett-kitchens",
        description: "Website for a kitchen fitter: reconnect with the client and try new designs",
        private: true,
        cloneUrl: kitchens,
        pushedAt: "2026-10-11T09:00:00Z",
      },
      { fullName: "octo-owner/side-project", private: false },
      "octo-owner/stacks",
      ...Array.from({ length: 58 }, (_, i) => `octo-owner/archive-${i + 1}`),
    ],
    opensOnPush: {
      remote: origin,
      checks: (subject) => [
        { name: "verify", outcome: "passed" },
        {
          name: "e2e",
          outcome: subject.includes("[e2e running]")
            ? "running"
            : subject.includes("[e2e passes]")
              ? "passed"
              : "failed",
        },
      ],
      // A commit whose subject says "[conflicts]" conflicts with main (#278).
      conflicts: (subject) => subject.includes("[conflicts]"),
    },
  }).api,
  sendPush: createFakePush().send,
});
