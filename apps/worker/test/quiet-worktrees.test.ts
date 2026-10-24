import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubConnection } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  type Requester,
  removeTestFolder,
  testWorker,
} from "./testing.ts";

// A code session's worktree clears itself after 3 quiet days with no pull request (#605), its
// work kept on a `wip/` branch on GitHub first, and its next turn checks the branch out again.

const DAY_MS = 24 * 60 * 60 * 1000;

let root: string;
let repo: string;
let origin: string;
let github: FakeGitHub;
let request: Requester;
/** The worker's clock, which a test moves on. */
let clock: number;
/** While set, each turn waits for it before answering, so a turn can be kept running. */
let holding: Promise<void> | undefined;
/** The worker's repeating jobs, run when a test says, as time passing would. */
let jobs: (() => Promise<void>)[];

const runJobs = async () => {
  for (const job of jobs) await job();
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo, origin } = await codeRepo(root));
  await codeWorkspace(root, "side-project", repo);
  github = createFakeGitHub();
  jobs = [];
  holding = undefined;
  // From now, as the repository's commits are.
  clock = Date.now();
  request = await asOwner(
    testWorker({
      root,
      now: () => clock,
      github: github.api,
      providers: [createFakeProvider({ delayMs: 0, beforeReply: async () => holding })],
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

/** Starts a code session on the fake and follows its first turn to the end: its id and branch. */
const codeSession = async (text: string) => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text,
    model: FAKE_MODEL,
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  // Titled after its first turn: all it does before it's quiet.
  const events = await followSession(request, { sessionId: id, until: "session-titled" });
  const listed = await gitIn(repo, "worktree", "list", "--porcelain");
  const branch = /branch refs\/heads\/(courtyard\/\S+)/.exec(listed)?.[1];
  if (branch === undefined) throw new Error("no session branch");
  return { id, branch, worktree: join(root, "data", "worktrees", id), events };
};

/** A file as a branch on GitHub's copy has it, or `undefined` when the branch isn't there. */
const onGitHub = async (branch: string, path: string) => {
  try {
    return await gitIn(origin, "show", `${branch}:${path}`);
  } catch {
    return undefined;
  }
};

describe("a quiet code session with no pull request", () => {
  it("is cleared after 3 days, its changes pushed to wip/ first", async () => {
    const { id, branch, worktree } = await codeSession(
      "edit file notes.md: The rack goes on the back wall",
    );

    clock += 3 * DAY_MS + 60_000;
    await runJobs();

    expect(existsSync(worktree)).toBe(false);
    expect(await gitIn(repo, "branch", "--list", branch)).toBe("");
    expect(await onGitHub(`wip/${branch}`, "notes.md")).toContain("The rack goes on the back wall");
    const events = await followSession(request, { sessionId: id, until: "worktree-cleared" });
    expect(events.at(-1)).toMatchObject({ type: "worktree-cleared", wip: `wip/${branch}` });
  });

  it("is asked about on GitHub no more once cleared, until it's checked out again", async () => {
    const { id, branch } = await codeSession("Look around");
    clock += 4 * DAY_MS;
    await runJobs();
    const cleared = await followSession(request, { sessionId: id, until: "worktree-cleared" });

    github.openPullRequest({ repo: "octo-owner/side-project", branch, head: "c0ffee1" });
    await runJobs();
    await postJson(request, `/api/sessions/${id}/messages`, {
      text: "Carry on",
      model: FAKE_MODEL,
    });

    const after = await followSession(request, {
      sessionId: id,
      until: "pull-request",
      after: cleared.at(-1)?.seq ?? 0,
    });
    expect(after.map((event) => event.type)).toContain("turn-completed");
  });

  it("is kept until 3 quiet days have passed", async () => {
    const { worktree } = await codeSession("edit file notes.md: The rack goes on the back wall");

    clock += 3 * DAY_MS - 60_000;
    await runJobs();

    expect(existsSync(worktree)).toBe(true);
  });

  it("is kept while a task runs", async () => {
    await mkdir(join(repo, "scripts"));
    await writeFile(join(repo, "scripts", "serve.mjs"), "setInterval(() => {}, 1000);\n");
    await gitIn(repo, "add", ".");
    await gitIn(repo, "commit", "--quiet", "-m", "A server");
    await gitIn(repo, "push", "--quiet", "origin", "main");
    const { id, worktree, events } = await codeSession("start task: node scripts/serve.mjs");

    clock += 4 * DAY_MS;
    await runJobs();

    expect(existsSync(worktree)).toBe(true);
    const started = events.find((event) => event.type === "task-started");
    if (started?.type !== "task-started") throw new Error("no task");
    await postJson(request, `/api/sessions/${id}/tasks/${started.task}/stop`, {});
    await followSession(request, { sessionId: id, until: "task-ended" });
  });

  it("is kept mid-turn", async () => {
    const { id, worktree, events } = await codeSession("Look around");
    let release = () => {};
    holding = new Promise((resolve) => {
      release = resolve;
    });
    await postJson(request, `/api/sessions/${id}/messages`, { text: "Go on", model: FAKE_MODEL });

    clock += 4 * DAY_MS;
    await runJobs();

    expect(existsSync(worktree)).toBe(true);
    release();
    await followSession(request, {
      sessionId: id,
      until: "turn-completed",
      after: events.at(-1)?.seq ?? 0,
    });
  });

  it("is checked out again by its next message, with its work", async () => {
    const { id, branch, worktree } = await codeSession(
      "edit file notes.md: The rack goes on the back wall",
    );
    clock += 4 * DAY_MS;
    await runJobs();
    const cleared = await followSession(request, { sessionId: id, until: "worktree-cleared" });

    await postJson(request, `/api/sessions/${id}/messages`, {
      text: "Carry on",
      model: FAKE_MODEL,
    });
    const after = await followSession(request, {
      sessionId: id,
      until: "turn-completed",
      after: cleared.at(-1)?.seq ?? 0,
    });

    expect(after[0]).toMatchObject({ type: "worktree-restored" });
    expect((await gitIn(worktree, "branch", "--show-current")).trim()).toBe(branch);
    expect(await readFile(join(worktree, "notes.md"), "utf8")).toContain("back wall");
    expect(await gitIn(worktree, "status", "--porcelain")).toBe("");
    // Its work is on its branch again, so its wip branch is deleted on GitHub.
    expect(github.branchesDeleted()).toEqual([
      { repo: "octo-owner/side-project", branch: `wip/${branch}` },
    ]);
  });

  it("with nothing GitHub lacks keeps no wip branch, and starts again from the default branch", async () => {
    const { id, branch, worktree } = await codeSession("Look around");
    clock += 4 * DAY_MS;
    await runJobs();
    const cleared = await followSession(request, { sessionId: id, until: "worktree-cleared" });
    expect(cleared.at(-1)).not.toHaveProperty("wip");
    expect(existsSync(worktree)).toBe(false);

    await postJson(request, `/api/sessions/${id}/messages`, {
      text: "Carry on",
      model: FAKE_MODEL,
    });
    await followSession(request, {
      sessionId: id,
      until: "turn-completed",
      after: cleared.at(-1)?.seq ?? 0,
    });

    expect((await gitIn(worktree, "branch", "--show-current")).trim()).toBe(branch);
    expect(await readFile(join(worktree, "README.md"), "utf8")).toBe("# A project\n");
  });
});
