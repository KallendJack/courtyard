import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHubConnection, type SessionEvent } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./providers/fake.ts";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  createFakeGitHub,
  errorOf,
  FAKE_MODEL,
  type FakeGitHub,
  followSession,
  gitIn,
  postJson,
  quotedInGuide,
  type Requester,
  testWorker,
} from "./testing.ts";

// From session to pull request (#172): the session opens its PR with gh, and the worker follows
// the PR's state and checks on the fake GitHub, recording each change in the session's events.

let root: string;
let repo: string;
/** The repository on GitHub, as `owner/name`: what the code workspace's remote names. */
let onGitHub: string;
let github: FakeGitHub;
let request: Requester;
/** While set, each turn waits for it before answering, so a turn can be kept running. */
let holding: Promise<void> | undefined;
/** The worker's repeating jobs, run when a test says, as time passing would. */
let jobs: (() => Promise<void>)[];

const runJobs = async () => {
  for (const job of jobs) await job();
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo, github: onGitHub } = await codeRepo(root));
  await codeWorkspace(root, "side-project", repo);
  github = createFakeGitHub();
  jobs = [];
  holding = undefined;
  request = await asOwner(
    testWorker({
      root,
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
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

/** Every event in a session so far. */
const eventsOf = async (id: string) => {
  const events: SessionEvent[] = [];
  // Reads up to the last event there is, then stops at the first one past it that never comes.
  const response = await request(`/api/sessions/${id}/events?after=0`);
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  if (reader === undefined) throw new Error("no event stream");
  let buffer = "";
  const quiet = () => new Promise<"quiet">((resolve) => setTimeout(() => resolve("quiet"), 200));
  // There is always a first event, the first message; the rest arrive with it.
  for (let first = true; ; first = false) {
    const read = first ? await reader.read() : await Promise.race([reader.read(), quiet()]);
    if (read === "quiet" || read.done) break;
    buffer += read.value;
  }
  await reader.cancel();
  for (const message of buffer.split("\n\n")) {
    const data = message.split("\n").find((line) => line.startsWith("data: "));
    if (data !== undefined) events.push(JSON.parse(data.slice("data: ".length)));
  }
  return events;
};

/** Each time the session's pull request changed, as it was then. */
const pullRequestsIn = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "pull-request" ? [event.pullRequest] : []));

/** Starts a code session on the fake and follows its first turn to the end: its id and branch. */
const codeSession = async (text = "Implement #79") => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text,
    model: FAKE_MODEL,
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const events = await followSession(request, { sessionId: id, until: "turn-completed" });
  const listed = await gitIn(repo, "worktree", "list", "--porcelain");
  const branch = /branch refs\/heads\/(courtyard\/\S+)/.exec(listed)?.[1];
  if (branch === undefined) throw new Error("no session branch");
  return { id, branch, lastSeq: events.at(-1)?.seq ?? 0 };
};

describe("a code session's pull request", () => {
  it("shows once it's opened, with its checks as they run, recorded only when they change", async () => {
    const { id, branch } = await codeSession();

    await runJobs();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    await runJobs();
    github.setChecks(number, [{ name: "e2e", outcome: "running" }]);
    await runJobs();
    await runJobs();
    github.setChecks(number, [
      { name: "e2e", outcome: "passed" },
      { name: "check", outcome: "passed" },
    ]);
    await runJobs();

    const url = `https://github.com/${onGitHub}/pull/${number}`;
    expect(pullRequestsIn(await eventsOf(id))).toEqual([
      { number, url, state: "open", head: "c0ffee1", checks: { kind: "none" } },
      { number, url, state: "open", head: "c0ffee1", checks: { kind: "running" } },
      { number, url, state: "open", head: "c0ffee1", checks: { kind: "passed" } },
    ]);
  });

  it("is looked for as soon as a turn ends, so one the model just opened shows at once", async () => {
    const { id, branch, lastSeq } = await codeSession();
    github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });

    await postJson(request, `/api/sessions/${id}/messages`, {
      text: "Open the PR",
      model: FAKE_MODEL,
    });

    const events = await followSession(request, {
      sessionId: id,
      until: "pull-request",
      after: lastSeq,
    });
    expect(events.at(-1)).toMatchObject({ pullRequest: { state: "open", head: "c0ffee1" } });
  });

  it("isn't followed while GitHub isn't connected", async () => {
    const { id, branch } = await codeSession();
    github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    await postJson(request, "/api/github/sign-out", {});

    await runJobs();

    expect(pullRequestsIn(await eventsOf(id))).toEqual([]);
  });
});

describe("a failing check", () => {
  it("starts a turn asking the model to fix it or say why it can't, with the failed check in its activity", async () => {
    const { id, branch, lastSeq } = await codeSession();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    github.setChecks(number, [
      { name: "e2e", outcome: "failed" },
      { name: "check", outcome: "passed" },
    ]);

    await runJobs();

    const events = await followSession(request, {
      sessionId: id,
      until: "turn-completed",
      after: lastSeq,
    });
    const asked = events.find((event) => event.type === "owner-message");
    expect(asked).toMatchObject({
      text: await quotedInGuide("The checks on your pull request", {
        number: String(number),
        checks: "e2e",
      }),
      model: FAKE_MODEL,
      checksFailed: { pullRequest: number, head: "c0ffee1", checks: ["e2e"] },
    });
    const activities = events.flatMap((event) =>
      event.type === "activity" ? [event.activity] : [],
    );
    expect(activities[0]).toEqual({ kind: "check-failed", name: "e2e" });
    expect(pullRequestsIn(events).at(-1)?.checks).toEqual({ kind: "failed", failed: ["e2e"] });
  });

  it("starts one fixing turn for each commit that fails, not one each time it's looked at", async () => {
    const { id, branch } = await codeSession();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    github.setChecks(number, [{ name: "e2e", outcome: "failed" }]);
    const fixingTurns = async () =>
      (await eventsOf(id)).filter(
        (event) => event.type === "owner-message" && event.checksFailed !== undefined,
      ).length;

    await runJobs();
    await expect.poll(async () => (await eventsOf(id)).at(-1)?.type).toBe("turn-completed");
    await runJobs();
    await runJobs();
    expect(await fixingTurns()).toBe(1);

    // The fix is pushed, and fails again.
    github.setChecks(number, [{ name: "e2e", outcome: "failed" }], "c0ffee2");
    await runJobs();

    await expect.poll(fixingTurns).toBe(2);
  });

  it("waits for a turn already running to end", async () => {
    const { id, branch, lastSeq } = await codeSession();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    github.setChecks(number, [{ name: "e2e", outcome: "failed" }]);
    // The owner's own message is still being answered.
    let answer: () => void = () => {};
    holding = new Promise((resolve) => {
      answer = resolve;
    });
    await postJson(request, `/api/sessions/${id}/messages`, {
      text: "And this",
      model: FAKE_MODEL,
    });

    await runJobs();
    holding = undefined;
    answer();
    await followSession(request, { sessionId: id, until: "turn-completed", after: lastSeq });
    await runJobs();
    await expect.poll(async () => (await eventsOf(id)).at(-1)?.type).toBe("turn-completed");

    const asked = (await eventsOf(id)).filter((event) => event.type === "owner-message");
    expect(asked.map((event) => event.type === "owner-message" && event.checksFailed)).toEqual([
      undefined,
      undefined,
      expect.objectContaining({ head: "c0ffee1" }),
    ]);
  });
});

describe("a merged or closed pull request", () => {
  it.each(["merged", "closed"] as const)(
    "once %s, anywhere, ends the session: it takes no more messages, and its worktree and branch are cleared away",
    async (how) => {
      const { id, branch } = await codeSession();
      const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
      await runJobs();

      if (how === "merged") github.merge(number);
      else github.close(number);
      await runJobs();

      expect(pullRequestsIn(await eventsOf(id)).at(-1)?.state).toBe(how);
      const sent = await postJson(request, `/api/sessions/${id}/messages`, {
        text: "One more thing",
        model: FAKE_MODEL,
      });
      expect(sent.status).toBe(409);
      expect(await errorOf(sent)).toBe(
        `This session's pull request was ${how}, so it takes no more messages. Start a new session to carry on.`,
      );
      expect(await gitIn(repo, "worktree", "list", "--porcelain")).not.toContain(branch);
      expect(await gitIn(repo, "branch", "--list", branch)).toBe("");
      // Still readable.
      expect((await request(`/api/sessions/${id}`)).status).toBe(200);
    },
  );
});
