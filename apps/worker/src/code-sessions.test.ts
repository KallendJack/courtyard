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
    // The same package scripts, in the workspace packages pnpm's options pick (#202).
    "pnpm --filter @courtyard/web build",
    "pnpm --filter=@courtyard/worker test -- src/code-sessions.test.ts",
    "pnpm -F @courtyard/worker typecheck",
    "pnpm -C apps/web run build",
    "pnpm --dir apps/worker test",
    "pnpm --dir=apps/worker test",
    "pnpm -r typecheck",
    "pnpm --recursive --filter @courtyard/web test",
    // The tools those scripts run, run directly as installed (#202).
    "pnpm exec vitest run src/code-sessions.test.ts",
    "pnpm vitest run -t allowlist",
    "pnpm --filter @courtyard/worker exec vitest run src/code-sessions.test.ts",
    "pnpm exec playwright test e2e/chat.spec.ts --workers=1",
    "pnpm exec tsc --noEmit -p apps/worker",
    "pnpm exec biome check apps/worker/src",
    "pnpm biome check --write apps/worker/src",
    // A command split over lines (#202).
    "pnpm test \\\n  -- apps/worker/src/code-sessions.test.ts",
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
    // Looking around the worktree (#178).
    "cat package.json",
    "ls apps",
    "ls -la",
    "head -n 20 notes.md",
    "tail -5 notes.md",
    "wc -l notes.md",
    "grep -rn foo apps",
    "rg foo apps",
    "pwd",
    "diff notes.md README.md",
    // What Matt Pocock's skills run on the repository's issues and pull requests (#181).
    'gh issue create --title "Add the rack" --body "Why it helps" --label needs-triage',
    "gh issue create --parent 79 --title Rack --body-file notes.md",
    "gh issue edit 79 --add-label ready-for-agent --remove-label needs-triage",
    'gh issue comment 79 --body "Done"',
    'gh issue close 79 --comment "Fixed in #80"',
    "gh issue list --state open --label needs-triage",
    "gh label list",
    'gh label create needs-triage --color fbca04 --description "Needs a look"',
    "gh api repos/{owner}/{repo}/issues/79",
    'gh api --paginate repos/{owner}/{repo}/pulls --jq ".[].number"',
    "gh api -X GET repos/{owner}/{repo}/labels",
    "gh api --method=get repos/{owner}/{repo}/issues/79/sub_issues",
    // Reading a failed check's annotations, as a fixing turn does (#202).
    "gh api repos/octo-owner/side-project/check-runs/123/annotations",
    "gh api repos/octo-owner/side-project/check-runs/123/annotations --jq '.[] | \"\\(.path):\\(.start_line) \\(.message)\"'",
    'gh api -H "Accept: application/vnd.github+json" repos/octo-owner/side-project/check-runs/123/annotations',
    "gh pr list --state open",
    "gh pr diff 12",
    // A failed run's logs and artifacts, for a fixing turn (#202).
    "gh run view 123 --log-failed",
    "gh run view 123 --log",
    "gh run view 123 --json jobs --jq '.jobs[] | select(.conclusion == \"failure\") | .name'",
    "gh run list --limit 5",
    // A title, body, comment or message is text, never a path (#202).
    'gh issue comment 79 --body "Fixed: see https://courtyard.example/pull/80"',
    'gh issue create --title Rack --body="Steps:\n\n1. See ../notes.md\n2. Bolt it down"',
    'git commit -m "Link the docs: https://courtyard.example/docs"',
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
    ["git status \\\n; rm -rf .", CHAINED],
    ["gh pr create --title Rack --body \"$(cat <<'EOF'\nWhy\nEOF\n)\"", CHAINED],
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
    // Picking workspace packages runs only what runs without them, in packages inside it (#202).
    ["pnpm --filter x exec rm -rf .", "off-allowlist"],
    ["pnpm --filter x deploy out", "off-allowlist"],
    ["pnpm -r", "off-allowlist"],
    ["pnpm --filter x", "off-allowlist"],
    ["pnpm -C ../.. build", "reaches-out"],
    ["pnpm --dir=/path/to/repo test", "reaches-out"],
    // Only the test tools run directly, as installed (npx could fetch any package), and none
    // that waits forever.
    ["npx some-package", "off-allowlist"],
    ["npx vitest run", "off-allowlist"],
    ["npx --no-install vitest run", "off-allowlist"],
    ["pnpm dlx vitest run", "off-allowlist"],
    ["pnpm exec vitest", "off-allowlist"],
    ["pnpm exec vitest run --watch", "off-allowlist"],
    ["pnpm exec playwright test --ui", "off-allowlist"],
    ["pnpm exec tsc", "off-allowlist"],
    ["pnpm exec tsc --noEmit --watch", "off-allowlist"],
    ["pnpm exec biome check --write ../elsewhere", "reaches-out"],
    ["pnpm exec vitest run --config=../evil.ts", "reaches-out"],
    ["gh pr merge 12", "off-allowlist"],
    ["gh pr view 12 --web", "off-allowlist"],
    // Only reading through gh api, and only this repository's issues and labels (#181).
    ["gh api -X POST repos/{owner}/{repo}/issues", "off-allowlist"],
    ["gh api --method DELETE repos/{owner}/{repo}/labels/wontfix", "off-allowlist"],
    ["gh api repos/{owner}/{repo}/issues -f title=Rack", "off-allowlist"],
    ["gh api repos/{owner}/{repo}/issues --input issue.json", "off-allowlist"],
    ["gh api graphql -F query=@query.graphql", "off-allowlist"],
    ["gh repo delete octo-owner/side-project --yes", "off-allowlist"],
    ["gh issue transfer 79 octo-owner/other", "off-allowlist"],
    ["gh issue delete 79 --yes", "off-allowlist"],
    ["gh issue create --repo someone/else --title Rack --body Why", "off-allowlist"],
    ["gh issue edit 79 -R someone/else --add-label bug", "off-allowlist"],
    ["gh issue comment 79 --web", "off-allowlist"],
    ["gh issue comment 79 --editor", "off-allowlist"],
    ["gh label delete wontfix --yes", "off-allowlist"],
    ["gh label clone someone/else", "off-allowlist"],
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
    // Nothing else changes a run (#202).
    ["gh run rerun 123", "off-allowlist"],
    ["gh run cancel 123", "off-allowlist"],
    ["gh run view 123 --web", "off-allowlist"],
    // A body read from a file is still a path (#202).
    ["gh issue create --title Rack --body-file ../secret.md", "reaches-out"],
    ["git commit -m Rack -F ../secret.md", "reaches-out"],
    // Looking around stays inside the worktree, and runs nothing else (#178).
    ["cat ../../x", "reaches-out"],
    ["cat -- C:/x", "reaches-out"],
    ["ls ~", "reaches-out"],
    ["grep -rn foo /path/to/repo", "reaches-out"],
    ["diff notes.md ../outside.txt", "reaches-out"],
    ["find . -exec rm {} +", "off-allowlist"],
    ["rg --pre ./script.sh foo", "off-allowlist"],
    ["rg --pre=./script.sh foo", "off-allowlist"],
    ["rg --hostname-bin ./script.sh --hyperlink-format default foo", "off-allowlist"],
    ["pwd -P extra", "off-allowlist"],
    // Following a file never ends, so the turn would wait forever.
    ["tail -f notes.md", "off-allowlist"],
    ["tail -n 5 -F notes.md", "off-allowlist"],
    ["tail --follow=name notes.md", "off-allowlist"],
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
    // A command split over lines, and a body over several, with links (#202).
    "gh pr create --title 'Add the notes' \\\n  --body 'Why it helps' \\\r\n  --base main",
    'gh pr edit --body "Why it helps, \\\nin one line"',
    "gh pr edit --body 'It doesn'\\''t break `pnpm test` or $HOME'",
    "gh pr create --title 'Add the notes' --body '## Summary\n\nWhy: https://courtyard.example/docs\n\nCloses #79'",
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

  it("is the workspace's own when its settings change the default", async () => {
    await writeFile(
      join(root, "context", "side-project", "workspace.json"),
      JSON.stringify({
        mode: "code",
        repoPath: repo,
        allowlist: { add: ["cargo test ...", "pnpm lint"], remove: ["npm ci", "git log ..."] },
      }),
    );
    const commands = [
      "cargo test --all",
      "pnpm lint",
      "pnpm test",
      "pnpm lint --fix",
      "npm ci",
      "git log --oneline",
      "cargo test --manifest-path=../elsewhere/Cargo.toml",
    ];

    const { answers, asked } = await askAbout(commands);

    expect(answers.slice(0, 3)).toEqual([
      { ok: true, value: null },
      { ok: true, value: null },
      { ok: true, value: null },
    ]);
    expect(asked).toEqual([
      { kind: "command", command: "pnpm lint --fix", reason: "off-allowlist" },
      { kind: "command", command: "npm ci", reason: "off-allowlist" },
      { kind: "command", command: "git log --oneline", reason: "off-allowlist" },
      {
        kind: "command",
        command: "cargo test --manifest-path=../elsewhere/Cargo.toml",
        reason: "reaches-out",
      },
    ]);
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

describe("a code session's downloads of a run's artifacts (#202)", () => {
  beforeEach(async () => {
    // The repository ignores its test results, and Claude Code's folder too, as some do.
    await writeFile(join(repo, ".gitignore"), "test-results/\n.claude/\n");
    await gitIn(repo, "add", ".gitignore");
    await gitIn(repo, "commit", "--quiet", "-m", "Ignore test results");
    await gitIn(repo, "push", "--quiet", "origin", "main");
  });

  it.each([
    "gh run download 123 -D test-results/ci",
    "gh run download 123 -n playwright-report --dir=test-results/ci",
  ])("run without asking into a folder git ignores: %s", async (command) => {
    const { answers, ran } = await askAbout([command]);

    expect(answers).toEqual([{ ok: true, value: null }]);
    expect(ran).toEqual([{ kind: "ran-command", command }]);
  });

  it.each([
    // Unpacked anywhere else, a package.json, git hook or Claude Code setting could arrive
    // without the approval an edit to one needs.
    ["gh run download 123", "off-allowlist"],
    ["gh run download 123 -D .", "off-allowlist"],
    ["gh run download 123 -D .claude", "off-allowlist"],
    ["gh run download 123 -D .claude/ci", "off-allowlist"],
    ["gh run download 123 -D apps", "off-allowlist"],
    ["gh run download 123 -D test-results/ci -D apps", "off-allowlist"],
    ["gh run download 123 -D ../x", "reaches-out"],
    ["gh run download 123 --dir=/path/to/x", "reaches-out"],
    ["gh run download 123 -D test-results/ci -R someone/else", "off-allowlist"],
    ["gh run download 123 -D test-results/ci --repo=someone/else", "off-allowlist"],
  ])("ask the owner anywhere else: %s", async (command, reason) => {
    const { asked, ran } = await askAbout([command]);

    expect(asked).toEqual([{ kind: "command", command, reason }]);
    expect(ran).toEqual([]);
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
