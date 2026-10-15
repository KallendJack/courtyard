// Starts the worker for the browser tests on a fresh data folder, so every run begins as a new
// install with no owner yet, plus long sessions to check that long sessions stay smooth. The
// context folder is a fresh copy of the fixtures, so adding a workspace never touches the repo.
// The worker runs as a live copy whose main has moved on, with a stand-in for the update script.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { SessionEvent, SessionSummary } from "../packages/contract/index.ts";
import { CUT_OFF_SESSION_ID, CUT_OFF_SESSION_TITLE } from "./cut-off-session.ts";
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

// A session whose turn was still running when its worker stopped (#186): this worker cuts it off
// as it starts, and it waits for Continue.
{
  const folder = join(dataDir, "sessions", CUT_OFF_SESSION_ID);
  mkdirSync(folder, { recursive: true });
  const at = new Date().toISOString();
  const session = SessionSummary.omit({ busy: true }).parse({
    id: CUT_OFF_SESSION_ID,
    workspaceId: "reading-list",
    title: CUT_OFF_SESSION_TITLE,
    createdAt: at,
    updatedAt: at,
  });
  writeFileSync(join(folder, "session.json"), JSON.stringify(session));
  const model = { provider: "fake", model: "echo" };
  const events = [
    { seq: 1, at, type: "owner-message", text: "Sort the list into this month and later", model },
    { seq: 2, at, type: "text-delta", text: "I'll read the list first." },
    { seq: 3, at, type: "activity", activity: { kind: "read-file", path: "CONTEXT.md" } },
  ];
  const lines = events.map((event) => JSON.stringify(SessionEvent.parse(event)));
  writeFileSync(join(folder, "events.jsonl"), `${lines.join("\n")}\n`);
}

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
// One whose checks are running when its page opens, and pass while it's open (#329).
pushBranch("329-follows-checks", { "follows.md": "The page follows its checks\n" }, [
  "The page follows its checks [e2e running] [e2e passes later]",
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
  // Its sessions draw in Paper (ADR 0023): the fake plays Paper, so the command never runs. Its
  // one line stays off its page (#333).
  JSON.stringify({
    name: "Side project",
    mode: "code",
    repoPath: repo,
    description: "Somewhere to try things out",
    connections: { paper: { command: "/path/to/paper", fileId: "file-1" } },
  }),
);

// A second code workspace, Workbench (#301), for its Home's blocks, on a repository of its own
// standing in for octo-owner/workbench: its one line in workspace.json, no Paper file yet, its own
// tracker and glossary for the setup card (#323), and
// on the fake GitHub (below) its ready issues and a helper's pull request whose checks passed.
const homeOrigin = join(codeDir, "home-origin.git");
const homeOnGitHub = "https://github.com/octo-owner/workbench.git";
git(codeDir, "init", "-q", "--bare", "-b", "main", "home-origin.git");
git(codeDir, "clone", "-q", "home-origin.git", "home-repo");
const homeRepo = join(codeDir, "home-repo");
git(homeRepo, "remote", "set-url", "origin", homeOnGitHub);
git(homeRepo, "config", `url.${homeOrigin.replaceAll("\\", "/")}.insteadOf`, homeOnGitHub);
writeFileSync(join(homeRepo, "README.md"), "# Workbench\n");
// Its own tracker, which its instructions say another agent writes, and its glossary under
// another name, for the setup card's lines (#323).
mkdirSync(join(homeRepo, "docs"), { recursive: true });
writeFileSync(
  join(homeRepo, "docs", "backlog.md"),
  "# Backlog\n\n- [ ] Pin the fan curve\n- [ ] Back up the router\n",
);
writeFileSync(join(homeRepo, "CONTEXT.md"), "# Glossary\n");
writeFileSync(
  join(homeRepo, "AGENTS.md"),
  "# Workbench\n\nThe planning agent writes docs/backlog.md; don't edit it by hand.\n",
);
git(homeRepo, "add", ".");
git(homeRepo, "commit", "-qm", "Start");
git(homeRepo, "push", "-q", "origin", "main");
const homeHead = git(homeRepo, "rev-parse", "HEAD");
mkdirSync(join(contextDir, "workbench"), { recursive: true });
writeFileSync(
  join(contextDir, "workbench", "workspace.json"),
  JSON.stringify({
    name: "Workbench",
    mode: "code",
    repoPath: homeRepo,
    description: "Plan and code with AI models, one workspace per area of life",
  }),
);

// A third code workspace, Toolshed, for its Lead (#347): three ready issues on the fake GitHub
// (below), so its builders never touch Workbench's.
const shedOrigin = join(codeDir, "shed-origin.git");
const shedOnGitHub = "https://github.com/octo-owner/toolshed.git";
git(codeDir, "init", "-q", "--bare", "-b", "main", "shed-origin.git");
git(codeDir, "clone", "-q", "shed-origin.git", "shed-repo");
const shedRepo = join(codeDir, "shed-repo");
git(shedRepo, "remote", "set-url", "origin", shedOnGitHub);
git(shedRepo, "config", `url.${shedOrigin.replaceAll("\\", "/")}.insteadOf`, shedOnGitHub);
writeFileSync(join(shedRepo, "README.md"), "# Toolshed\n");
git(shedRepo, "add", ".");
git(shedRepo, "commit", "-qm", "Start");
git(shedRepo, "push", "-q", "origin", "main");
mkdirSync(join(contextDir, "toolshed"), { recursive: true });
writeFileSync(
  join(contextDir, "toolshed", "workspace.json"),
  JSON.stringify({ name: "Toolshed", mode: "code", repoPath: shedRepo }),
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

// A stand-in for `gh`, first on the worker's PATH, so a session's `gh pr create`, `gh issue
// comment` and the like run (#285) without ever reaching GitHub: it does nothing, and says so.
const standIns = resolve(dataDir, "..", "stand-ins");
rmSync(standIns, { recursive: true, force: true });
mkdirSync(standIns, { recursive: true });
writeFileSync(join(standIns, "gh"), "#!/bin/sh\necho 'gh stand-in: nothing sent'\n", {
  mode: 0o755,
});
writeFileSync(join(standIns, "gh.cmd"), "@echo gh stand-in: nothing sent\r\n");
process.env.PATH = `${standIns}${delimiter}${process.env.PATH ?? ""}`;

const { startWorker } = await import("../apps/worker/src/start.ts");
// GitHub in memory (#99): a sign-in finishes a couple of seconds after it starts. A session branch
// pushed to origin.git gets a pull request (#172), changing the files the branch changes (#160),
// and so does any other branch there once the PRs list is asked for (#278). Its checks are on each
// commit pushed: verify passes, and e2e fails, unless the commit's subject says "[e2e running]" or
// "[e2e passes]".
const { createFakeGitHub } = await import("../apps/worker/src/github/fake.ts");
// A push service in memory (#173), so a device turned on in a test is never sent to for real.
const { createFakePush } = await import("../apps/worker/src/notifications/fake.ts");
// A context backup that isn't there, so the home page and Settings say the backup is behind and why.
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

// The owner's Paper files in memory (#308), so connecting Paper never starts Paper.
const { createFakePaperFiles } = await import("../apps/worker/src/paper/fake.ts");
const paper = createFakePaperFiles({
  files: [
    { id: "file-courtyard", name: "Courtyard" },
    { id: "file-home", name: "Workbench" },
    { id: "file-kitchens", name: "Garrett Kitchens" },
  ],
});

const github = createFakeGitHub({
  finishAfterMs: 2000,
  // New repo (#391) makes each as a bare repository on disk, standing in for GitHub's copy.
  makesReposIn: join(codeDir, "made"),
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
  // Workbench's ready issues (#301): in milestones, one claimed by a comment, one blocked by
  // another (#377), and more than Next up shows before More; and first on the Build order line,
  // one that needs grilling (#363).
  issues: {
    "octo-owner/workbench": [
      {
        number: 117,
        title: "Sub-agents for code review",
        milestone: "4 · Code workspaces",
        labels: ["needs-triage"],
      },
      { number: 251, title: "One Reply box everywhere", milestone: "4 · Code workspaces" },
      { number: 197, title: "The rail on desktop", milestone: "4 · Code workspaces" },
      {
        number: 199,
        title: "Claimed by a helper",
        milestone: "4 · Code workspaces",
        comments: ["Building this: Claude Code helper (branch 199-claimed)."],
      },
      // Blocked by an open one (#377): its row says what it comes after, and it has no Build.
      {
        number: 283,
        title: "Nothing moves once drawn",
        milestone: "4 · Code workspaces",
        blockedBy: [251],
      },
      { number: 255, title: "Paste images on the Fold", milestone: "5 · Tablet hub and voice" },
      ...Array.from({ length: 9 }, (_, i) => ({
        number: 270 + i,
        title: `A later idea ${i + 1}`,
        milestone: "Later",
      })),
    ],
    "octo-owner/toolshed": [
      { number: 31, title: "Hooks on the pegboard", milestone: "1 · Tidy" },
      { number: 32, title: "Labels on the drawers", milestone: "1 · Tidy" },
      { number: 33, title: "A light over the bench", milestone: "1 · Tidy" },
    ],
  },
  milestones: {
    "octo-owner/workbench": { "4 · Code workspaces": "NOW. Build order: #117 → #197 → #251." },
    "octo-owner/toolshed": { "1 · Tidy": "NOW. Build order: #31 → #32 → #33." },
  },
  opensOnPush: {
    remote: origin,
    repo: "octo-owner/side-project",
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
    // One whose subject says "[e2e passes later]" passes a while after its page first asks (#329).
    passesLater: { when: (subject) => subject.includes("[e2e passes later]"), afterMs: 5000 },
  },
});
// A Claude Code helper's pull request on Workbench whose checks passed: ready to merge (#301).
const helperPull = github.openPullRequest({
  repo: "octo-owner/workbench",
  branch: "313-builds",
  head: homeHead,
  title: "Builds take turns",
  body: "## Summary\n\nBuilds take turns.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)",
  author: "octo-owner",
});
github.setChecks(helperPull, [{ name: "verify", outcome: "passed" }]);
// Workbench's main has passed its build (#301's Main row): its workflow runs the checks, the unit
// tests and two shards of browser tests side by side (#337), and GitHub lists them in any order.
github.setWorkflows(homeHead, [
  {
    path: ".github/workflows/ci.yml",
    done: true,
    text: [
      "name: CI",
      "jobs:",
      "  checks:",
      "    name: Checks",
      "  unit:",
      "    name: Unit tests",
      "  e2e:",
      `    name: E2E \${{ matrix.shard }}/2`,
      "    strategy:",
      "      matrix:",
      "        shard: [1, 2]",
      "",
    ].join("\n"),
  },
]);
github.setCommitChecks(
  homeHead,
  ["E2E 2/2", "Unit tests", "E2E 1/2", "Checks"].map((name, i) => ({
    id: i + 1,
    name,
    outcome: "passed",
    url: `https://github.com/octo-owner/workbench/actions/runs/1/job/${i + 1}`,
    startedAt: "2026-10-12T09:00:00Z",
    completedAt: "2026-10-12T09:03:00Z",
  })),
);

startWorker({
  env: { ...process.env, COURTYARD_LIVE_COPY: liveCopy, COURTYARD_CONTEXT_REMOTE: missingBackup },
  mattSkills: { pin, fetch },
  startUpdate: standInUpdate,
  github: github.api,
  paperFiles: paper.paper,
  sendPush: createFakePush().send,
});
