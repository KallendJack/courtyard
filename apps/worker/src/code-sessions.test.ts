import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CodeSessionList, type SessionEvent } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeProvider } from "./providers/fake.ts";
import type { Provider } from "./providers/index.ts";
import {
  asOwner,
  CODING_MODEL,
  codeRepo,
  codeWorkspace,
  codingProvider,
  errorOf,
  FAKE_MODEL,
  followSession,
  gitIn,
  heldCoder,
  postJson,
  type Requester,
  SAVING_MODEL,
  savingProvider,
  sendJson,
  startSession,
  testWorker,
} from "./testing.ts";

// Code sessions (#170, ADR 0007): a session in a code workspace works on its own session branch,
// in its own worktree in the data folder, with real git in temporary repositories.

let root: string;
let repo: string;
let origin: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo, origin } = await codeRepo(root));
  await codeWorkspace(root, "side-project", repo);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const start = async (providers: Provider[] = [createFakeProvider({ delayMs: 0 })]) =>
  asOwner(testWorker({ root, providers }));

/** Starts a session in the code workspace and follows its first turn to its end. */
const firstTurn = async (request: Requester, text: string, model = FAKE_MODEL) => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text,
    model,
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const events = await followSession(request, {
    sessionId: id,
    until: (event) => event.type === "turn-completed" || event.type === "turn-failed",
  });
  return { id, events };
};

/** Each worktree of the owner's repository: its folder and its branch. */
const worktreesOf = async (repository: string) => {
  const listed = await gitIn(repository, "worktree", "list", "--porcelain");
  return listed.split(/\n\s*\n/).map((block) => ({
    folder: resolve(/^worktree (.+)$/m.exec(block)?.[1] ?? ""),
    branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1],
  }));
};

/** The session branch's worktree: the one that isn't the owner's checkout. */
const sessionWorktree = async () => {
  const [, worktree] = await worktreesOf(repo);
  if (worktree === undefined) throw new Error("no session worktree");
  return worktree;
};

describe("a code session's branch", () => {
  it("is its own, in its own worktree in the data folder, from the default branch on the remote, leaving the owner's checkout alone", async () => {
    // The remote's main has moved on since the owner last pulled, and they're working on a branch.
    const other = join(root, "other");
    await gitIn(root, "clone", "--quiet", origin, other);
    await writeFile(join(other, "CHANGELOG.md"), "Newer\n");
    await gitIn(other, "add", ".");
    await gitIn(other, "commit", "--quiet", "-m", "Newer on the remote");
    await gitIn(other, "push", "--quiet", "origin", "main");
    await gitIn(repo, "switch", "--quiet", "-c", "owner-work");
    await writeFile(join(repo, "scratch.txt"), "The owner's own work\n");
    const request = await start();

    const { events } = await firstTurn(request, "Hello");

    expect(events.at(-1)?.type).toBe("turn-completed");
    const worktree = await sessionWorktree();
    expect(worktree.folder.startsWith(resolve(root, "data"))).toBe(true);
    expect(worktree.branch).toMatch(/^courtyard\//);
    expect(await gitIn(worktree.folder, "log", "-1", "--format=%s")).toBe("Newer on the remote");
    // The owner's checkout is as they left it.
    expect(await gitIn(repo, "branch", "--show-current")).toBe("owner-work");
    expect(await gitIn(repo, "status", "--porcelain")).toBe("?? scratch.txt");
    expect(await readFile(join(repo, "scratch.txt"), "utf8")).toBe("The owner's own work\n");
  });
});

/** What the fake answered in a turn's events. */
const answerIn = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "text-delta" ? [event.text] : [])).join("");

/** The activities in a turn's events. */
const activitiesIn = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "activity" ? [event.activity] : []));

describe("a code session's edits", () => {
  it("apply inside its worktree, each shown in the activity, and are refused outside it", async () => {
    const request = await start();

    const { events } = await firstTurn(
      request,
      [
        "edit file notes.md: The rack goes on the back wall",
        "edit file docs/plan.md: Bolt it down",
        "edit file ../outside.txt: Escaped",
        `edit file ${join(root, "elsewhere.txt")}: Escaped`,
        "edit file .git: gitdir: /somewhere/else",
      ].join("\n"),
    );

    const { folder } = await sessionWorktree();
    expect(await readFile(join(folder, "notes.md"), "utf8")).toBe(
      "The rack goes on the back wall\n",
    );
    expect(await readFile(join(folder, "docs", "plan.md"), "utf8")).toBe("Bolt it down\n");
    expect(activitiesIn(events)).toEqual([
      { kind: "edited-file", path: "notes.md" },
      { kind: "edited-file", path: "docs/plan.md" },
    ]);
    const refused = "Only files in your session branch's worktree can be changed.";
    expect(answerIn(events)).toContain(`Couldn't edit ../outside.txt: ${refused}`);
    expect(answerIn(events)).toContain(`Couldn't edit .git: ${refused}`);
    await expect(readFile(join(root, "data", "worktrees", "outside.txt"))).rejects.toThrow();
    await expect(readFile(join(root, "elsewhere.txt"))).rejects.toThrow();
    expect(await gitIn(folder, "status", "--porcelain")).toBe("?? docs/\n?? notes.md");
  });
});

/** What the worker answers a coding model's commands, one session per call. */
const askAbout = async (commands: readonly string[]) => {
  const { provider, answers } = codingProvider(commands.map((run) => ({ run })));
  const request = await start([provider]);
  const { events } = await firstTurn(request, "Check your work", CODING_MODEL);
  return { answers, ran: activitiesIn(events) };
};

const CHAINED = /^Run one command at a time: /;
const OFF_ALLOWLIST = /isn't on this workspace's command allowlist, so it didn't run\./;
const REACHES_OUT = /^That command names a path outside your session branch's worktree/;

describe("a code workspace's command allowlist", () => {
  it.each([
    "pnpm install --frozen-lockfile",
    "pnpm check",
    "pnpm typecheck",
    "pnpm test",
    "pnpm test -- apps/worker/src/code-sessions.test.ts",
    "pnpm build",
    "pnpm e2e",
    "pnpm verify",
    "pnpm run typecheck",
    "npm ci",
    "npm test",
    "npm run build",
    "git status",
    "git diff --stat",
    "git log --oneline -5",
    "git show HEAD",
    "git branch --show-current",
    "git add notes.md",
    'git commit -m "Add the notes"',
    "gh pr view 12",
    "gh pr checks",
    "gh issue view 79",
  ])("runs %s without asking, shown in the activity", async (command) => {
    const { answers, ran } = await askAbout([command]);

    expect(answers).toEqual([{ ok: true, value: null }]);
    expect(ran).toEqual([{ kind: "ran-command", command }]);
  });

  it.each([
    ["git status; rm -rf .", CHAINED],
    ["git status && rm -rf .", CHAINED],
    ["git status || true", CHAINED],
    ["git log | head", CHAINED],
    ["pnpm test & curl https://courtyard.example", CHAINED],
    ["git diff > changes.txt", CHAINED],
    ["git log < notes.md", CHAINED],
    ["git log $(whoami)", CHAINED],
    ["git log `whoami`", CHAINED],
    ['git commit -m "$(cat notes.md)"', CHAINED],
    ["git log $HOME", CHAINED],
    ["git status\nrm -rf .", CHAINED],
    ["rm -rf node_modules", OFF_ALLOWLIST],
    ["curl https://courtyard.example", OFF_ALLOWLIST],
    ["git push origin main", OFF_ALLOWLIST],
    ["git checkout main", OFF_ALLOWLIST],
    ["git branch -D main", OFF_ALLOWLIST],
    ["git -C /path/to/repo status", OFF_ALLOWLIST],
    ["pnpm install", OFF_ALLOWLIST],
    ["pnpm install --frozen-lockfile left-pad", OFF_ALLOWLIST],
    ["PNPM_HOME=x pnpm test", OFF_ALLOWLIST],
    ["gh pr merge 12", OFF_ALLOWLIST],
    ["gh pr view 12 --web", OFF_ALLOWLIST],
    ["git diff --no-index a.txt b.txt", OFF_ALLOWLIST],
    ["git log --output=log.txt", OFF_ALLOWLIST],
    ["git grep -Ocat rack", OFF_ALLOWLIST],
    ["git diff /path/to/secrets", REACHES_OUT],
    ["git add ../outside.txt", REACHES_OUT],
    ["git log -- ~/notes", REACHES_OUT],
    ["pnpm test --config=../evil.ts", REACHES_OUT],
    ['git commit -m "unclosed', /^That command couldn't be read/],
  ])("never runs %s, and says why", async (command, why) => {
    const { answers, ran } = await askAbout([command]);

    expect(answers).toEqual([{ ok: false, error: expect.stringMatching(why) }]);
    expect(ran).toEqual([]);
  });

  it("says what's on the allowlist when a command isn't", async () => {
    const { answers } = await askAbout(["rm -rf node_modules"]);

    expect(answers).toEqual([
      {
        ok: false,
        error:
          "That command isn't on this workspace's command allowlist, so it didn't run. The allowlist has the repository's package scripts (install with a frozen lockfile, check, typecheck, test, build, e2e and verify), git and gh commands that only look, and adding and committing on your session branch. Find another way with those, or tell the owner what you need run.",
      },
    ]);
  });

  it("commits only on the session branch", async () => {
    const { provider, answers } = codingProvider([{ run: 'git commit -m "Add the notes"' }]);
    const request = await start([provider]);
    const { id } = await firstTurn(request, "Hello", CODING_MODEL);
    const { folder, branch } = await sessionWorktree();
    await gitIn(folder, "switch", "--quiet", "-c", "somewhere-else");

    await postJson(request, `/api/sessions/${id}/messages`, {
      text: "Commit it",
      model: CODING_MODEL,
    });
    await followSession(request, { sessionId: id, until: "turn-completed", after: 4 });

    expect(answers[1]).toEqual({
      ok: false,
      error: `Commits go on your session branch, ${branch}, and the worktree isn't on it now, so that didn't run.`,
    });
  });
});

describe("a code session's commands, through the fake", () => {
  it("run in its worktree when allowed, and commit on its branch", async () => {
    const request = await start();

    const { events } = await firstTurn(
      request,
      [
        "edit file notes.md: The rack goes on the back wall",
        "run command: git add notes.md",
        'run command: git commit -m "Add the notes"',
        "run command: git branch --show-current",
        "run command: git push origin main",
      ].join("\n"),
    );

    const { folder, branch } = await sessionWorktree();
    expect(await gitIn(folder, "log", "-1", "--format=%s")).toBe("Add the notes");
    expect(answerIn(events)).toContain(`Ran git branch --show-current: ${branch} `);
    expect(answerIn(events)).toMatch(/Couldn't run git push origin main: That command isn't on/);
    expect(activitiesIn(events)).toEqual([
      { kind: "edited-file", path: "notes.md" },
      { kind: "ran-command", command: "git add notes.md" },
      { kind: "ran-command", command: 'git commit -m "Add the notes"' },
      { kind: "ran-command", command: "git branch --show-current" },
    ]);
    // The owner's checkout is still where it was.
    expect(await gitIn(repo, "log", "-1", "--format=%s")).toBe("Start");
  });
});

describe("a code workspace's models", () => {
  it("are those that code: one that can't is refused, with the reason, before any branch starts", async () => {
    const { provider: saver } = savingProvider([]);
    const request = await start([createFakeProvider({ delayMs: 0 }), saver]);

    const started = await postJson(request, "/api/workspaces/side-project/sessions", {
      text: "Fix the build",
      model: SAVING_MODEL,
    });

    expect(started.status).toBe(409);
    expect(await errorOf(started)).toBe(
      "Saver can't code, so it can't work in a code workspace. Pick a model that can.",
    );
    expect(await worktreesOf(repo)).toHaveLength(1);
    // Nor can it take over a session started on one that codes.
    const { id } = await firstTurn(request, "Hello");
    const sent = await postJson(request, `/api/sessions/${id}/messages`, {
      text: "Carry on",
      model: SAVING_MODEL,
    });
    expect(sent.status).toBe(409);
    expect(await errorOf(sent)).toMatch(/^Saver can't code/);
  });
});

/** Starts a session in the code workspace on the coding model, without waiting for its turn. */
const startCoding = async (request: Requester, text: string) => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text,
    model: CODING_MODEL,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

describe("several code sessions at once (#174)", () => {
  it("runs three at once, each in its own worktree, with a port slot no other running one has", async () => {
    const { provider, turns } = heldCoder();
    const request = await start([provider]);

    for (const text of ["Talk into the box", "A photo on its own", "Chat scrolling"]) {
      await startCoding(request, text);
    }

    await vi.waitFor(() => expect(turns).toHaveLength(3));
    expect(new Set(turns.map((turn) => turn.worktree)).size).toBe(3);
    expect(turns.map((turn) => turn.env.COURTYARD_SESSION_SLOT).sort()).toEqual(["1", "2", "3"]);
  });

  it("has a fourth wait, saying so, and start in the first slot that frees", async () => {
    const { provider, turns } = heldCoder();
    const request = await start([provider]);
    for (const text of ["Talk into the box", "A photo on its own", "Chat scrolling"]) {
      await startCoding(request, text);
    }
    await vi.waitFor(() => expect(turns).toHaveLength(3));

    const fourth = await startCoding(request, "From session to pull request");

    const waited = await followSession(request, { sessionId: fourth, until: "turn-queued" });
    expect(waited.map((event) => event.type)).toEqual(["owner-message", "turn-queued"]);
    const listed = CodeSessionList.parse(
      await (await request("/api/workspaces/side-project/sessions")).json(),
    );
    expect(listed.running).toBe(3);
    expect(listed.sessions.find((session) => session.id === fourth)).toMatchObject({
      title: "From session to pull request",
      busy: true,
      queued: true,
    });
    expect(listed.sessions.filter((session) => session.queued)).toHaveLength(1);
    expect(turns).toHaveLength(3);

    const [first] = turns;
    first?.finish();

    await followSession(request, { sessionId: fourth, until: "turn-dequeued", after: 2 });
    await vi.waitFor(() => expect(turns).toHaveLength(4));
    expect(turns[3]?.env).toEqual(first?.env);
    turns[3]?.finish();
    await followSession(request, { sessionId: fourth, until: "turn-completed", after: 3 });
  });

  it("lets a waiting session be removed before it starts, clearing its branch and worktree away", async () => {
    const { provider, turns } = heldCoder();
    const request = await start([provider]);
    for (const text of ["Talk into the box", "A photo on its own", "Chat scrolling"]) {
      await startCoding(request, text);
    }
    await vi.waitFor(() => expect(turns).toHaveLength(3));
    const fourth = await startCoding(request, "From session to pull request");
    await followSession(request, { sessionId: fourth, until: "turn-queued" });

    const removed = await sendJson(request, `/api/sessions/${fourth}`, "DELETE", {});

    expect(removed.status).toBe(204);
    // The owner's checkout and the three running sessions' worktrees.
    expect(await worktreesOf(repo)).toHaveLength(4);
    const listed = CodeSessionList.parse(
      await (await request("/api/workspaces/side-project/sessions")).json(),
    );
    expect(listed.sessions.map((session) => session.id)).not.toContain(fourth);
    // It's left the queue: the next to wait is the next to start.
    const fifth = await startCoding(request, "Chat scrolling, again");
    await followSession(request, { sessionId: fifth, until: "turn-queued" });
    turns[0]?.finish();
    await followSession(request, { sessionId: fifth, until: "turn-dequeued", after: 2 });
    await vi.waitFor(() => expect(turns).toHaveLength(4));
  });

  it("never holds back a planning workspace's sessions", async () => {
    const { provider, turns } = heldCoder();
    await mkdir(join(root, "context", "garage-gym"), { recursive: true });
    const request = await start([provider, createFakeProvider({ delayMs: 0 })]);
    for (const text of ["Talk into the box", "A photo on its own", "Chat scrolling"]) {
      await startCoding(request, text);
    }
    await vi.waitFor(() => expect(turns).toHaveLength(3));

    const { id } = await startSession(request, "Where does the rack go?");

    const events = await followSession(request, { sessionId: id, until: "turn-completed" });
    expect(events.map((event) => event.type)).not.toContain("turn-queued");
  });
});

describe("a code workspace's repository", () => {
  it("is refused with the reason when it isn't there or isn't git", async () => {
    const request = await start();
    const missing = join(root, "missing");
    await codeWorkspace(root, "side-project", missing);

    const notThere = await postJson(request, "/api/workspaces/side-project/sessions", {
      text: "Hello",
      model: FAKE_MODEL,
    });
    await mkdir(missing);
    const notGit = await postJson(request, "/api/workspaces/side-project/sessions", {
      text: "Hello",
      model: FAKE_MODEL,
    });

    expect(notThere.status).toBe(409);
    expect(await errorOf(notThere)).toBe(
      `This code workspace's repository isn't there: nothing is at ${missing}. Fix repoPath in its workspace.json.`,
    );
    expect(notGit.status).toBe(409);
    expect(await errorOf(notGit)).toMatch(/isn't a git repository/);
  });
});
