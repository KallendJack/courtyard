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
  quotedInGuide,
  type Requester,
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

const owner = () => asOwner(testWorker({ root, providers: [createFakeProvider({ delayMs: 0 })] }));

const lineOf = async (request: Requester) =>
  StatusLine.parse(await (await request("/api/workspaces/garage-gym/status-line")).json());

const change = (request: Requester, body: unknown) =>
  postJson(request, "/api/workspaces/garage-gym/status-line", body);

describe("a planning workspace's status line", () => {
  it("starts empty, and the owner can set it a line at a time", async () => {
    const request = await owner();
    expect(await lineOf(request)).toEqual({ done: null, now: null, next: null, editable: true });

    expect((await change(request, { kind: "edit", place: "now", text: " The rack " })).status).toBe(
      200,
    );
    await change(request, { kind: "edit", place: "next", text: "The floor" });

    expect(await lineOf(request)).toEqual({
      done: null,
      now: { text: "The rack", edited: true },
      next: { text: "The floor", edited: true },
      editable: true,
    });
  });

  it("moves along on Done: now is just done, next is now", async () => {
    const request = await owner();
    await change(request, { kind: "edit", place: "done", text: "Measured up" });
    await change(request, { kind: "edit", place: "now", text: "The rack" });
    await change(request, { kind: "edit", place: "next", text: "The floor" });

    const done = StatusLine.parse(
      await (await change(request, { kind: "done", place: "now" })).json(),
    );

    expect(done).toEqual({
      done: { text: "The rack", edited: true },
      now: { text: "The floor", edited: true },
      next: null,
      editable: true,
    });
    expect(await lineOf(request)).toEqual(done);
  });

  it("ticks next straight to just done, leaving now as it is", async () => {
    const request = await owner();
    await change(request, { kind: "edit", place: "now", text: "The rack" });
    await change(request, { kind: "edit", place: "next", text: "The floor" });

    await change(request, { kind: "done", place: "next" });

    expect(await lineOf(request)).toMatchObject({
      done: { text: "The floor" },
      now: { text: "The rack" },
      next: null,
    });
  });

  it("removes an item", async () => {
    const request = await owner();
    await change(request, { kind: "edit", place: "now", text: "The rack" });

    await change(request, { kind: "remove", place: "now" });

    expect((await lineOf(request)).now).toBeNull();
  });

  it("refuses Done on an empty place, and words that don't fit", async () => {
    const request = await owner();

    const empty = await change(request, { kind: "done", place: "now" });
    expect(empty.status).toBe(404);
    expect(await errorOf(empty)).toBe("There's nothing there to tick.");
    const long = await change(request, { kind: "edit", place: "now", text: "x".repeat(41) });
    expect(long.status).toBe(400);
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
        editable: false,
      });
      const edit = await postJson(request, "/api/workspaces/side-project/status-line", {
        kind: "edit",
        place: "now",
        text: "Something else",
      });
      expect(edit.status).toBe(409);
    } finally {
      release();
      await followSession(request, { sessionId: building, until: "turn-completed" });
    }
  });
});

/** The time the tests' worker reads. */
const clock = Date.parse("2026-10-19T09:00:00.000Z");

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

/** Starts a session in the workspace and waits for its first turn to end. */
const talk = async (request: Requester, text: string) => {
  const session = await startSession(request, text);
  await followSession(request, { sessionId: session.id, until: "turn-completed" });
  return session.id;
};

describe("keeping a planning workspace's line current", () => {
  it("is a short question to the errand model as a session's turn ends, given the plans and the line", async () => {
    const watched = watchedFake();
    const request = await asOwner(
      testWorker({ root, providers: [watched.provider], now: () => clock }),
    );
    await change(request, { kind: "edit", place: "now", text: "Measuring up" });

    const session = await talk(request, "Rack's ordered. now: The rack; next: The floor");

    await expect.poll(async () => (await lineOf(request)).now?.text).toBe("The rack");
    const at = new Date(clock).toISOString();
    expect(await lineOf(request)).toEqual({
      done: null,
      now: { text: "The rack", from: { session, at } },
      next: { text: "The floor", from: { session, at } },
      editable: true,
    });
    const [question] = watched.asked.filter(({ purpose }) => purpose === "status-line");
    expect(question).toMatchObject({
      model: "echo",
      effort: "low",
      instructions: await quotedInGuide("You keep the status line"),
    });
    expect(question?.message).toContain("[P1] Get a rack.");
    expect(question?.message).toContain("Now: Measuring up (the owner's own words)");
    expect(question?.message).toContain("Owner: Rack's ordered.");
  });

  it("keeps an item the turn left alone as it was, the owner's words and all", async () => {
    const request = await asOwner(
      testWorker({ root, providers: [watchedFake().provider], now: () => clock }),
    );
    await change(request, { kind: "edit", place: "next", text: "The floor" });

    const session = await talk(request, "just done: Measured up");

    await expect.poll(async () => (await lineOf(request)).done?.text).toBe("Measured up");
    expect(await lineOf(request)).toEqual({
      done: { text: "Measured up", from: { session, at: new Date(clock).toISOString() } },
      now: null,
      next: { text: "The floor", edited: true },
      editable: true,
    });
  });
});
