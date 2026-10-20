import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubConnection, SessionSummary, StatusLine } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider, type OneOffInput, type Provider } from "../src/providers/index.ts";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  createFakeGitHub,
  errorOf,
  FAKE_MODEL,
  followSession,
  gitIn,
  postJson,
  removeTestFolder,
  startSession,
  testWorker,
} from "./testing.ts";

// The status line under a workspace's name (#256): ✓ just done · ● now · ○ next.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  await writeFile(
    join(root, "context", "garage-gym", "CONTEXT.md"),
    "# Garage gym\n\n## Plans\n\n- Get a rack.\n- Lay the floor.\n",
  );
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** The fake, with each one-off question it's asked kept. */
const watchedFake = () => {
  const fake = createFakeProvider({ delayMs: 0 });
  const asked: OneOffInput[] = [];
  const provider: Provider = {
    ...fake,
    answerOnce: (input) => {
      asked.push(input);
      return fake.answerOnce(input);
    },
  };
  return { provider, asked };
};

describe("a planning workspace", () => {
  it("has no status line, and asks no model to keep one as its turns end (#600)", async () => {
    const watched = watchedFake();
    const request = await asOwner(testWorker({ root, providers: [watched.provider] }));

    const session = await startSession(request, "Rack's ordered.");
    await followSession(request, { sessionId: session.id, until: "turn-completed" });

    const line = await request("/api/workspaces/garage-gym/status-line");
    expect(line.status).toBe(404);
    expect(await errorOf(line)).toBe("Only a code workspace has a status line.");
    // Its title, asked once the turn ends, is the only one-off question a planning turn asks.
    await expect.poll(() => watched.asked.length).toBeGreaterThan(0);
    expect(watched.asked.map(({ purpose }) => purpose)).toEqual(["title"]);
  });
});

describe("a code workspace's status line", () => {
  it("is built from its data: the last merged pull request, the first running build, the first issue in Next up", async () => {
    const { repo, github: onGitHub } = await codeRepo(root);
    await codeWorkspace(root, "side-project", repo);
    const github = createFakeGitHub({
      issues: {
        [onGitHub]: [
          { number: 22, title: "Session slots", milestone: "4 · Code workspaces" },
          { number: 23, title: "Grow the tablet hub", milestone: "5 · Tablet hub" },
        ],
      },
    });
    const jobs: (() => Promise<void>)[] = [];
    let holding: Promise<void> | undefined;
    const request = await asOwner(
      testWorker({
        root,
        github: github.api,
        providers: [createFakeProvider({ delayMs: 0, beforeReply: async () => holding })],
        repeat: (_everyMs, job) => {
          jobs.push(job);
        },
      }),
    );
    const runJobs = async () => {
      for (const job of jobs) await job();
    };
    await postJson(request, "/api/github/sign-in", {});
    github.approve();
    await expect
      .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
      .toBe("signed-in");
    const codeSession = async (text: string) => {
      const response = await postJson(request, "/api/workspaces/side-project/sessions", {
        text,
        model: FAKE_MODEL,
      });
      return SessionSummary.parse(await response.json()).id;
    };
    // One built, its pull request merged.
    const built = await codeSession("Build the review screen");
    await followSession(request, { sessionId: built, until: "turn-completed" });
    const listed = await gitIn(repo, "worktree", "list", "--porcelain");
    const branch = /branch refs\/heads\/(courtyard\/\S+)/.exec(listed)?.[1] ?? "";
    const number = github.openPullRequest({
      repo: onGitHub,
      branch,
      head: "c0ffee1",
      title: "PR review screen (#21)",
    });
    await runJobs();
    github.merge(number);
    await runJobs();
    // One building now.
    let release: () => void = () => {};
    holding = new Promise((resolve) => {
      release = resolve;
    });
    const building = await codeSession("Steer while it answers");
    try {
      const line = StatusLine.parse(
        await (await request("/api/workspaces/side-project/status-line")).json(),
      );

      expect(line).toEqual({
        done: { text: "PR review screen" },
        now: { text: "Steer while it answers" },
        next: { text: "Session slots" },
      });
    } finally {
      release();
      await followSession(request, { sessionId: building, until: "turn-completed" });
    }
  });
});
