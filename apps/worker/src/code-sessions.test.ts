import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./providers/fake.ts";
import type { Provider } from "./providers/index.ts";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  errorOf,
  FAKE_MODEL,
  followSession,
  gitIn,
  postJson,
  type Requester,
  SAVING_MODEL,
  savingProvider,
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
