import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CodeSessionList, GitHubConnection, type SessionEvent } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FoundCheckRun } from "../src/integrations/github/api.ts";
import { createFakeProvider } from "../src/providers/fake.ts";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  createFakeGitHub,
  FAKE_MODEL,
  type FakeGitHub,
  followSession,
  gitIn,
  postJson,
  quotedInGuide,
  type Requester,
  removeTestFolder,
  testWorker,
} from "./testing.ts";

// A pull request's failed checks, tried again by the worker before any fixing turn (#740): a
// branch behind main is brought up to date first, a conflict goes to the session, and a failure in
// a test the pull request doesn't touch is re-run once. Against the fake GitHub, with real git.

let root: string;
let repo: string;
let origin: string;
let onGitHub: string;
let github: FakeGitHub;
let request: Requester;
/** The worker's repeating jobs, run when a test says, as time passing would. */
let jobs: (() => Promise<void>)[];

const runJobs = async () => {
  for (const job of jobs) await job();
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo, origin, github: onGitHub } = await codeRepo(root));
  await codeWorkspace(root, "side-project", repo, { name: "Side project" });
  // One issue for the Lead to build, when a test runs it.
  github = createFakeGitHub({
    issues: { [onGitHub]: [{ number: 22, title: "Which session waits", milestone: "4 · Code" }] },
    milestones: { [onGitHub]: { "4 · Code": "NOW. Build order: #22." } },
  });
  jobs = [];
  request = await asOwner(
    testWorker({
      root,
      github: github.api,
      providers: [createFakeProvider({ delayMs: 0 })],
      repeat: (_everyMs, job) => {
        jobs.push(job);
      },
    }),
  );
  await postJson(request, "/api/github/sign-in", {});
  github.approve();
  await expect
    .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
    .toBe("signed-in");
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** The failing test a browser test's job names, and the file it's in. */
const SPEC = "e2e/live.spec.ts";
const FAILURE = `[chromium] › ${SPEC}:12:3 › Live › says what's new`;

let ids = 0;
const failedJob = (name: string): FoundCheckRun => {
  ids += 1;
  return {
    id: ids,
    name,
    outcome: "failed",
    url: `https://github.com/${onGitHub}/actions/runs/1/job/${ids}`,
    startedAt: "2026-10-27T09:00:00Z",
    completedAt: "2026-10-27T09:03:00Z",
  };
};

const sessionsOf = async () =>
  CodeSessionList.parse(await (await request("/api/workspaces/side-project/sessions")).json())
    .sessions;

/** The owner's own code session, once its first turn has ended: its id. */
const ownSession = async () => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text: "Implement #79",
    model: FAKE_MODEL,
  });
  const { id } = (await response.json()) as { id: string };
  await followSession(request, { sessionId: id, until: "turn-completed" });
  return id;
};

/** The Lead's builder for #22, once no turn runs: its id. */
const leadBuilder = async () => {
  await postJson(request, "/api/workspaces/side-project/lead/run", { model: FAKE_MODEL });
  await expect
    .poll(async () => (await sessionsOf()).filter((each) => each.byLead === true).length)
    .toBe(1);
  await expect
    .poll(async () => (await sessionsOf()).filter((each) => each.busy), { timeout: 15_000 })
    .toHaveLength(0);
  return (await sessionsOf()).find((each) => each.byLead === true)?.id ?? "";
};

/**
 * A code session (the owner's own, or `of` the Lead's builder) whose branch has one commit,
 * pushed, changing `file`, with its pull request open and changing that file: its id, worktree,
 * branch and pull request.
 */
const sessionWithPullRequest = async (
  file = "notes.md",
  text = "A note\n",
  of: () => Promise<string> = ownSession,
) => {
  const id = await of();
  const branch = (await sessionsOf()).find((each) => each.id === id)?.branch ?? "";
  const listed = await gitIn(repo, "worktree", "list", "--porcelain");
  const worktree = new RegExp(
    `worktree (\\S+)\\nHEAD \\w+\\nbranch refs/heads/${branch}$`,
    "m",
  ).exec(listed)?.[1];
  // Never git in the folder the tests run from.
  if (branch === "" || worktree === undefined) throw new Error(`No worktree for ${id}`);
  await mkdir(dirname(join(worktree, file)), { recursive: true });
  await writeFile(join(worktree, file), text);
  await gitIn(worktree, "add", ".");
  await gitIn(worktree, "commit", "--quiet", "-m", "Its change");
  await gitIn(worktree, "push", "--quiet", "origin", `HEAD:refs/heads/${branch}`);
  const head = await gitIn(worktree, "rev-parse", "HEAD");
  const number = github.openPullRequest({
    repo: onGitHub,
    branch,
    head,
    files: [{ path: file, status: "added", additions: 1, deletions: 0, patch: null }],
  });
  return { id, worktree, branch, head, number };
};

/** Its jobs on `head` failed: `runs`, as GitHub lists them and as the pull request shows them. */
const failsOn = (number: number, head: string, runs: readonly FoundCheckRun[]) => {
  github.setCommitChecks(head, runs);
  github.setChecks(
    number,
    runs.map(({ name, outcome }) => ({ name, outcome })),
    head,
  );
};

/** Main moves on: a commit changing `file`, pushed to GitHub. */
const mainMovesOn = async (file = "main.md", text = "On main\n") => {
  await writeFile(join(repo, file), text);
  await gitIn(repo, "add", ".");
  await gitIn(repo, "commit", "--quiet", "-m", "Main moves on");
  await gitIn(repo, "push", "--quiet", "origin", "main");
  return gitIn(repo, "rev-parse", "HEAD");
};

/** Waits until no turn runs in the session. */
const settled = (id: string) =>
  expect
    .poll(async () => {
      const response = await request("/api/workspaces/side-project/sessions");
      const { sessions } = CodeSessionList.parse(await response.json());
      return sessions.find((session) => session.id === id)?.busy;
    })
    .toBe(false);

/** The worker's messages asking the session to fix its pull request. */
const fixingTurns = async (id: string) => {
  const response = await request(`/api/sessions/${id}/events?after=0`);
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  if (reader === undefined) throw new Error("no event stream");
  let text = "";
  for (;;) {
    const quiet = new Promise<"quiet">((resolve) => setTimeout(() => resolve("quiet"), 300));
    const read = await Promise.race([reader.read(), quiet]);
    if (read === "quiet" || read.done) break;
    text += read.value;
  }
  await reader.cancel();
  return text
    .split("\n\n")
    .flatMap((message) => message.split("\n").filter((line) => line.startsWith("data: ")))
    .map((line) => JSON.parse(line.slice("data: ".length)) as SessionEvent)
    .filter(
      (event) =>
        event.type === "owner-message" &&
        (event.checksFailed !== undefined || event.conflicted !== undefined),
    );
};

describe("a failed check in a test the pull request doesn't touch (#740)", () => {
  it("is re-run once by the worker, with no fixing turn", async () => {
    const { id, head, number } = await sessionWithPullRequest();
    const job = failedJob("E2E 1/5");
    github.setFailure(job.id, FAILURE);
    failsOn(number, head, [job]);

    await runJobs();
    await runJobs();

    expect(github.reruns()).toEqual([{ repo: onGitHub, commit: head }]);
    expect(await fixingTurns(id)).toEqual([]);
  });

  it("failing again after the re-run goes to the session, which is told the failure is real", async () => {
    const { id, head, number } = await sessionWithPullRequest();
    const job = failedJob("E2E 1/5");
    github.setFailure(job.id, FAILURE);
    failsOn(number, head, [job]);
    await runJobs();

    // The re-run is a new try of the job, and fails too.
    const again = failedJob("E2E 1/5");
    github.setFailure(again.id, FAILURE);
    failsOn(number, head, [again]);
    await runJobs();
    await runJobs();

    expect(github.reruns()).toHaveLength(1);
    const turns = await fixingTurns(id);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      text: await quotedInGuide("The checks on your pull request #<number> failed again", {
        number: String(number),
        checks: "E2E 1/5",
      }),
      checksFailed: { pullRequest: number, head, checks: ["E2E 1/5"] },
    });
    await settled(id);
  });
});

describe("a failed check that isn't an untouched test (#740)", () => {
  it("goes to the session with no re-run: a test the pull request changes, or a check naming no test", async () => {
    const { id, head, number } = await sessionWithPullRequest(SPEC, "test('says', () => {});\n");
    const spec = failedJob("E2E 1/5");
    github.setFailure(spec.id, FAILURE);
    // Lint names no test.
    failsOn(number, head, [spec, failedJob("Check")]);

    await runJobs();

    expect(github.reruns()).toEqual([]);
    const turns = await fixingTurns(id);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      text: await quotedInGuide("The checks on your pull request", {
        number: String(number),
        checks: "E2E 1/5, Check",
      }),
    });
    await settled(id);
  });
});

describe("a failed check on a Lead builder's branch behind main (#740)", () => {
  it("brings the branch up to date first, main merged in and pushed, before any re-run", async () => {
    const { id, worktree, branch, head, number } = await sessionWithPullRequest(
      undefined,
      undefined,
      leadBuilder,
    );
    const onMain = await mainMovesOn();
    const job = failedJob("E2E 1/5");
    github.setFailure(job.id, FAILURE);
    failsOn(number, head, [job]);

    await runJobs();
    await runJobs();

    const updated = await gitIn(origin, "rev-parse", `refs/heads/${branch}`);
    expect(updated).not.toBe(head);
    expect(await gitIn(origin, "rev-list", "--parents", "-n", "1", updated)).toBe(
      `${updated} ${head} ${onMain}`,
    );
    expect(await gitIn(worktree, "rev-parse", "HEAD")).toBe(updated);
    expect(github.reruns()).toEqual([]);
    expect(await fixingTurns(id)).toEqual([]);
  });

  it("sends a conflict in that update to the session, leaving its branch as it was", async () => {
    const { id, worktree, branch, head, number } = await sessionWithPullRequest(
      "README.md",
      "# The session's project\n",
      leadBuilder,
    );
    await mainMovesOn("README.md", "# Main's project\n");
    failsOn(number, head, [failedJob("E2E 1/5")]);

    await runJobs();

    expect(await gitIn(origin, "rev-parse", `refs/heads/${branch}`)).toBe(head);
    expect(await gitIn(worktree, "status", "--porcelain")).toBe("");
    expect(await gitIn(worktree, "rev-parse", "HEAD")).toBe(head);
    const turns = await fixingTurns(id);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      text: await quotedInGuide("Your pull request #<number> conflicts with <base>", {
        number: String(number),
        base: "main",
      }),
      conflicted: { pullRequest: number, head },
    });
    expect(github.reruns()).toEqual([]);
    await settled(id);
  });
});

describe("what the worker never updates, nor re-runs blind (#740)", () => {
  it("leaves the owner's own session's branch behind main as it is, re-running instead", async () => {
    const { branch, head, number } = await sessionWithPullRequest();
    await mainMovesOn();
    const job = failedJob("E2E 1/5");
    github.setFailure(job.id, FAILURE);
    failsOn(number, head, [job]);

    await runJobs();

    expect(await gitIn(origin, "rev-parse", `refs/heads/${branch}`)).toBe(head);
    expect(github.reruns()).toEqual([{ repo: onGitHub, commit: head }]);
  });

  it("leaves a builder's branch with work not yet committed as it is", async () => {
    const { worktree, branch, head, number } = await sessionWithPullRequest(
      undefined,
      undefined,
      leadBuilder,
    );
    await mainMovesOn();
    await writeFile(join(worktree, "half-done.md"), "Not yet committed\n");
    const job = failedJob("E2E 1/5");
    github.setFailure(job.id, FAILURE);
    failsOn(number, head, [job]);

    await runJobs();

    expect(await gitIn(origin, "rev-parse", `refs/heads/${branch}`)).toBe(head);
    expect(await gitIn(worktree, "rev-parse", "HEAD")).toBe(head);
    expect(await gitIn(worktree, "status", "--porcelain")).toBe("?? half-done.md");
  });

  it("doesn't bring the commit its update pushed up to date again", async () => {
    const { branch, head, number } = await sessionWithPullRequest(
      undefined,
      undefined,
      leadBuilder,
    );
    await mainMovesOn();
    failsOn(number, head, [failedJob("E2E 1/5")]);
    await runJobs();
    const updated = await gitIn(origin, "rev-parse", `refs/heads/${branch}`);
    expect(updated).not.toBe(head);

    // The merge commit fails in an untouched test while main moves on again.
    await mainMovesOn("later.md", "Later on main\n");
    const job = failedJob("E2E 1/5");
    github.setFailure(job.id, FAILURE);
    failsOn(number, updated, [job]);
    await runJobs();

    expect(await gitIn(origin, "rev-parse", `refs/heads/${branch}`)).toBe(updated);
    expect(github.reruns()).toEqual([{ repo: onGitHub, commit: updated }]);
  });

  it("goes to the session when any test a failed job names is in a file the pull request changes", async () => {
    const touched = "e2e/notes.spec.ts";
    const { id, head, number } = await sessionWithPullRequest(touched, "test('a', () => {});\n");
    const job = failedJob("E2E 1/5");
    // The first test it names is untouched; the second is the pull request's.
    github.setFailure(job.id, FAILURE, `[chromium] › ${touched}:3:1 › Notes › keeps one`);
    failsOn(number, head, [job]);

    await runJobs();

    expect(github.reruns()).toEqual([]);
    expect(await fixingTurns(id)).toHaveLength(1);
    await settled(id);
  });

  it("goes to the session when what was tried can't be read, re-running nothing", async () => {
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "failed-checks.json"), "{ not json");
    const { id, head, number } = await sessionWithPullRequest();
    const job = failedJob("E2E 1/5");
    github.setFailure(job.id, FAILURE);
    failsOn(number, head, [job]);

    await runJobs();

    expect(github.reruns()).toEqual([]);
    expect(await fixingTurns(id)).toHaveLength(1);
    await settled(id);
  });
});
