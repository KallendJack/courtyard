import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type ApprovalAsk, CodeSessionList, type SessionEvent } from "@courtyard/contract";
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

/**
 * Starts a session in the code workspace and follows its first turn to its end, denying each
 * approval it asks for (#171): what it asked, and its events.
 */
const firstTurn = async (request: Requester, text: string, model = FAKE_MODEL) => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text,
    model,
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const asked: ApprovalAsk[] = [];
  const events = await followSession(request, {
    sessionId: id,
    until: (event) => event.type === "turn-completed" || event.type === "turn-failed",
    onEvent: (event) => {
      if (event.type !== "approval-requested") return;
      asked.push(event.ask);
      void postJson(request, `/api/sessions/${id}/approvals/${event.seq}`, { answer: "deny" });
    },
  });
  return { id, events, asked };
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
  it("apply inside its worktree, each shown in the activity, and need the owner's approval outside it", async () => {
    const request = await start();

    const { events, asked } = await firstTurn(
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
    expect(asked).toEqual([
      { kind: "edit", path: join(root, "data", "worktrees", "outside.txt") },
      { kind: "edit", path: join(root, "elsewhere.txt") },
      // Git's own file in the worktree decides where its git commands go.
      { kind: "setup", path: ".git" },
    ]);
    const denied = "The owner denied that change, so the file wasn't changed.";
    expect(answerIn(events)).toContain(`Couldn't edit ../outside.txt: ${denied}`);
    expect(answerIn(events)).toContain(`Couldn't edit .git: ${denied}`);
    await expect(readFile(join(root, "data", "worktrees", "outside.txt"))).rejects.toThrow();
    await expect(readFile(join(root, "elsewhere.txt"))).rejects.toThrow();
    expect(await gitIn(folder, "status", "--porcelain")).toBe("?? docs/\n?? notes.md");
  });

  it("need the owner's approval for a file that decides what its allowed commands run", async () => {
    // The repository keeps its git hooks in a folder of its own, as husky has it do.
    await gitIn(repo, "config", "core.hooksPath", "tools/hooks");
    const request = await start();
    const setupFiles = [
      "package.json",
      "apps/web/package.json",
      "pnpm-workspace.yaml",
      ".npmrc",
      ".pnpmfile.cjs",
      ".husky/pre-commit",
      ".githooks/pre-push",
      "tools/hooks/pre-commit",
      "lefthook.yml",
      ".lefthook-local.yml",
      ".claude/settings.json",
      ".claude/hooks/check.sh",
      // Names Windows takes for the same files.
      ".GIT",
      ".git.",
      "PACKAGE.JSON",
      "package.json::$DATA",
      ".Claude/settings.json",
      "GIT~1",
      // Git's own folder anywhere, as a submodule's.
      "vendor/lib/.git/config",
    ];

    const { asked, events } = await firstTurn(
      request,
      [
        ...setupFiles.map((path) => `edit file ${path}: echo hacked`),
        "edit file notes.md: Fine",
      ].join("\n"),
    );

    const { folder } = await sessionWorktree();
    expect(asked).toEqual(setupFiles.map((path) => ({ kind: "setup", path })));
    expect(activitiesIn(events)).toEqual([{ kind: "edited-file", path: "notes.md" }]);
    await expect(readFile(join(folder, ".husky", "pre-commit"))).rejects.toThrow();
    expect(await readFile(join(folder, "notes.md"), "utf8")).toBe("Fine\n");
  });
});

/** What the worker answers a coding model's commands, one session per call. */
const askAbout = async (commands: readonly string[]) => {
  const { provider, answers } = codingProvider(commands.map((run) => ({ run })));
  const request = await start([provider]);
  const { events, asked } = await firstTurn(request, "Check your work", CODING_MODEL);
  return { answers, asked, ran: activitiesIn(events) };
};

const CHAINED = /^Run one command at a time: /;

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
    ['git commit -m "unclosed', /^That command couldn't be read/],
  ])("never runs %s, and says why", async (command, why) => {
    const { answers, asked, ran } = await askAbout([command]);

    expect(answers).toEqual([{ ok: false, error: expect.stringMatching(why) }]);
    expect(asked).toEqual([]);
    expect(ran).toEqual([]);
  });

  it.each([
    ["rm -rf node_modules", "off-allowlist"],
    ["curl https://courtyard.example", "off-allowlist"],
    ["git push origin main", "off-allowlist"],
    ["git checkout main", "off-allowlist"],
    ["git branch -D main", "off-allowlist"],
    ["git -C /path/to/repo status", "off-allowlist"],
    ["pnpm install", "off-allowlist"],
    ["pnpm install --frozen-lockfile left-pad", "off-allowlist"],
    ["PNPM_HOME=x pnpm test", "off-allowlist"],
    ["gh pr merge 12", "off-allowlist"],
    ["gh pr view 12 --web", "off-allowlist"],
    ["git diff --no-index a.txt b.txt", "off-allowlist"],
    ["git log --output=log.txt", "off-allowlist"],
    ["git grep -Ocat rack", "off-allowlist"],
    ["git diff /path/to/secrets", "reaches-out"],
    ["git add ../outside.txt", "reaches-out"],
    ["git log -- ~/notes", "reaches-out"],
    ["pnpm test --config=../evil.ts", "reaches-out"],
    // A short option's value written onto it, alone or after other short options.
    ["git commit -F../../github/gh/hosts.yml", "reaches-out"],
    ["git commit -qF../../github/gh/hosts.yml", "reaches-out"],
    ["git grep -f../patterns.txt rack", "reaches-out"],
    ["git grep -fC:/path/to/patterns.txt rack", "reaches-out"],
    ["git grep -f/path/to/patterns.txt rack", "reaches-out"],
    ["git log -n1 --format=%s -- notes.md HEAD:../outside.txt", "reaches-out"],
  ])("asks the owner before running %s, and doesn't once they deny it", async (command, reason) => {
    const { answers, asked, ran } = await askAbout([command]);

    expect(asked).toEqual([{ kind: "command", command, reason }]);
    expect(answers).toEqual([{ ok: false, error: expect.stringMatching(/^The owner denied/) }]);
    expect(ran).toEqual([]);
  });

  it.each([
    "git push origin HEAD",
    "git push -u origin HEAD",
    "git push --set-upstream origin <branch>",
    "git push origin <branch>",
    "git push --quiet origin HEAD:<branch>",
    "gh pr create --fill",
    'gh pr create --title "Add the notes" --body "Why it helps"',
    "gh pr create --head <branch> --base main --fill --draft",
    'gh pr edit --title "Add the notes, tidied"',
    "gh pr edit <branch> --add-label bug",
  ])(
    "pushes the session branch and opens or updates its own PR without asking: %s (#172)",
    async (command) => {
      const { answers, asked, ran } = await askAbout([command]);
      const { branch } = await sessionWorktree();

      expect(asked).toEqual([]);
      expect(answers).toEqual([{ ok: true, value: null }]);
      expect(ran).toEqual([
        { kind: "ran-command", command: command.replaceAll("<branch>", branch ?? "") },
      ]);
    },
  );

  it.each([
    "git push",
    "git push origin main",
    "git push origin HEAD:main",
    "git push origin <branch>:main",
    "git push origin <branch> main",
    "git push --force origin HEAD",
    "git push --delete origin <branch>",
    "git push upstream HEAD",
    "gh pr create --head main --fill",
    "gh pr create --repo someone/else --fill",
    "gh pr create --fill --web",
    "gh pr create --recover pr.json",
    "gh pr edit 12 --title Mine",
    "gh pr edit main --title Mine",
    "gh pr close 12",
    "gh pr merge 12",
  ])("asks the owner before any other push or PR: %s (#172)", async (command) => {
    const { asked, ran } = await askAbout([command]);
    const { branch } = await sessionWorktree();

    expect(asked).toEqual([
      {
        kind: "command",
        command: command.replaceAll("<branch>", branch ?? ""),
        reason: "off-allowlist",
      },
    ]);
    expect(ran).toEqual([]);
  });

  it("commits, pushes and opens its PR only on the session branch", async () => {
    const { provider, answers } = codingProvider([
      { run: 'git commit -m "Add the notes"' },
      { run: "git push origin HEAD" },
      { run: "gh pr create --fill" },
    ]);
    const request = await start([provider]);
    const { id, events } = await firstTurn(request, "Hello", CODING_MODEL);
    const { folder, branch } = await sessionWorktree();
    await gitIn(folder, "switch", "--quiet", "-c", "somewhere-else");

    await postJson(request, `/api/sessions/${id}/messages`, {
      text: "Commit it",
      model: CODING_MODEL,
    });
    await followSession(request, {
      sessionId: id,
      until: "turn-completed",
      after: events.at(-1)?.seq ?? 0,
    });

    const offBranch = {
      ok: false,
      error: `Committing, pushing and opening your pull request work only on your session branch, ${branch}, and the worktree isn't on it now, so that didn't run.`,
    };
    expect(answers.slice(3)).toEqual([offBranch, offBranch, offBranch]);
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
    expect(answerIn(events)).toMatch(/Couldn't run git push origin main: The owner denied/);
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
