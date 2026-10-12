import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CodeSessionList,
  GitHubConnection,
  OpenPullRequestList,
  PullRequestReview,
  PushNotice,
  type SessionEvent,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./providers/fake.ts";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  createFakeGitHub,
  createFakePush,
  errorOf,
  FAKE_MODEL,
  type FakeGitHub,
  type FakePush,
  followSession,
  gitIn,
  postJson,
  quotedInGuide,
  type Requester,
  removeTestFolder,
  testWorker,
} from "./testing.ts";

// From session to pull request (#172): the session opens its PR with gh, and the worker follows
// the PR's state and checks on the fake GitHub, recording each change in the session's events.

let root: string;
let repo: string;
/** The repository on GitHub, as `owner/name`: what the code workspace's remote names. */
let onGitHub: string;
let github: FakeGitHub;
let push: FakePush;
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
  push = createFakePush();
  jobs = [];
  holding = undefined;
  request = await asOwner(
    testWorker({
      root,
      github: github.api,
      sendPush: push.send,
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
    const number = github.openPullRequest({
      repo: onGitHub,
      branch,
      head: "c0ffee1",
      title: "Talk",
    });
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
    const changes = { additions: 0, deletions: 0, files: 0 };
    const pullRequest = {
      number,
      title: "Talk",
      url,
      state: "open",
      head: "c0ffee1",
      changes,
      conflicts: false,
    };
    expect(pullRequestsIn(await eventsOf(id))).toEqual([
      { ...pullRequest, checks: { kind: "none" } },
      { ...pullRequest, checks: { kind: "running" } },
      { ...pullRequest, checks: { kind: "passed" } },
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

  it("is in its workspace's list of sessions, with its title and the session's branch, for the PRs tab (#240)", async () => {
    const { id, branch } = await codeSession();
    const waiting = await codeSession("Not opened yet");
    const number = github.openPullRequest({
      repo: onGitHub,
      branch,
      head: "c0ffee1",
      title: "Talk into the message box",
    });
    github.setChecks(number, [{ name: "e2e", outcome: "failed" }]);
    await runJobs();

    const response = await request("/api/workspaces/side-project/sessions");
    const { sessions } = CodeSessionList.parse(await response.json());

    expect(sessions.find((session) => session.id === id)).toMatchObject({
      branch,
      pullRequest: {
        number,
        title: "Talk into the message box",
        state: "open",
        checks: { kind: "failed", failed: ["e2e"] },
      },
    });
    const notOpened = sessions.find((session) => session.id === waiting.id);
    expect(notOpened?.branch).toMatch(/^courtyard\//);
    expect(notOpened?.pullRequest).toBeUndefined();
  });

  it("isn't followed while GitHub isn't connected", async () => {
    const { id, branch } = await codeSession();
    // Signed out before the pull request exists: the follow that runs as the session's turn ends
    // would otherwise see the pull request while still signed in.
    await postJson(request, "/api/github/sign-out", {});
    github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });

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

  it("whose fixing turn ends with it still failing says so in the notification, not just that the turn finished", async () => {
    await postJson(request, "/api/notifications/on", {
      endpoint: "https://push.example/fold",
      keys: { p256dh: "p256dh-of-fold", auth: "auth-of-fold" },
    });
    const { id, branch } = await codeSession();
    await expect
      .poll(() => push.sent.map(({ payload }) => PushNotice.parse(payload).body))
      .toEqual(["Turn finished"]);
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    github.setChecks(number, [
      { name: "e2e", outcome: "failed" },
      { name: "check", outcome: "passed" },
    ]);

    await runJobs();

    await expect
      .poll(() => push.sent.map(({ payload }) => PushNotice.parse(payload).body))
      .toEqual(["Turn finished", "Checks still failing: e2e"]);
    expect(PushNotice.parse(push.sent.at(-1)?.payload).session).toBe(id);
  });

  it("that fails again after its fixing turn re-ran it asks the owner, with no second fixing turn (#356)", async () => {
    await postJson(request, "/api/notifications/on", {
      endpoint: "https://push.example/fold",
      keys: { p256dh: "p256dh-of-fold", auth: "auth-of-fold" },
    });
    const { id, branch } = await codeSession();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    github.setChecks(number, [{ name: "e2e", outcome: "failed" }]);
    const bodies = () => push.sent.map(({ payload }) => PushNotice.parse(payload).body);
    await runJobs();
    await expect.poll(bodies).toEqual(["Turn finished", "Checks still failing: e2e"]);

    // The fixing turn re-ran its failed jobs, on the same commit, and they fail again.
    github.setChecks(number, [{ name: "e2e", outcome: "running" }]);
    await runJobs();
    github.setChecks(number, [{ name: "e2e", outcome: "failed" }]);
    await runJobs();
    await runJobs();

    await expect
      .poll(bodies)
      .toEqual([
        "Turn finished",
        "Checks still failing: e2e",
        "Failed again after a re-run: e2e. Flaky, or does it need fixing?",
      ]);
    expect(PushNotice.parse(push.sent.at(-1)?.payload).session).toBe(id);
    const fixingTurns = (await eventsOf(id)).filter(
      (event) => event.type === "owner-message" && event.checksFailed !== undefined,
    );
    expect(fixingTurns).toHaveLength(1);
  });

  it("waits for a turn already running to end", async () => {
    const { id, branch, lastSeq } = await codeSession();
    // The owner's own message is still being answered.
    let answer: () => void = () => {};
    holding = new Promise((resolve) => {
      answer = resolve;
    });
    const sent = await postJson(request, `/api/sessions/${id}/messages`, {
      text: "And this",
      model: FAKE_MODEL,
    });
    expect(sent.status).toBe(202);
    // Its checks fail meanwhile.
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    github.setChecks(number, [{ name: "e2e", outcome: "failed" }]);

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

// Reviewing a session's pull request in Courtyard (#160): its changed files with their diffs, and
// Merge (refused with the reason until it can merge) and Close.

/** The review of a session's pull request, as the session page asks for it. */
const reviewOf = async (id: string) => {
  const response = await request(`/api/sessions/${id}/pull-request`);
  expect(response.status).toBe(200);
  return PullRequestReview.parse(await response.json());
};

const TALK_PATCH =
  "@@ -1,2 +1,3 @@\n const listen = useSpeech({\n-  keyboard: true,\n+  onWords: show,\n+  onStop: send,";

describe("reviewing a pull request", () => {
  it("shows the files it changes, each with its diff, and its checks by name", async () => {
    const { id, branch } = await codeSession();
    const number = github.openPullRequest({
      repo: onGitHub,
      branch,
      head: "c0ffee1",
      files: [
        {
          path: "apps/web/src/talk-button.tsx",
          status: "modified",
          additions: 2,
          deletions: 1,
          patch: TALK_PATCH,
        },
        { path: "e2e/talk.spec.ts", status: "added", additions: 18, deletions: 0, patch: null },
      ],
    });
    github.setChecks(number, [
      { name: "verify", outcome: "passed" },
      { name: "e2e", outcome: "running" },
    ]);

    const review = await reviewOf(id);

    expect(review).toMatchObject({
      pullRequest: { number, state: "open", changes: { additions: 20, deletions: 1, files: 2 } },
      branch,
      base: "main",
      checks: [
        { name: "verify", outcome: "passed" },
        { name: "e2e", outcome: "running" },
      ],
      files: [
        { path: "apps/web/src/talk-button.tsx", additions: 2, deletions: 1, patch: TALK_PATCH },
        { path: "e2e/talk.spec.ts", status: "added", patch: null },
      ],
    });
  });

  it("shows its title and the description the session wrote (#240)", async () => {
    const { id, branch } = await codeSession();
    const body = "## Summary\n\nTalk into the message box.\n\n## Evidence\n\nA new e2e test.";
    github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1", title: "Talk", body });

    const review = await reviewOf(id);

    expect(review.pullRequest.title).toBe("Talk");
    expect(review.body).toBe(body);
  });

  it.each([
    {
      what: "a check is running",
      checks: [
        { name: "verify", outcome: "passed" },
        { name: "e2e", outcome: "running" },
      ],
      conflicts: false,
      reason: "Merge waits for e2e to finish.",
    },
    {
      what: "checks failed",
      checks: [
        { name: "check", outcome: "failed" },
        { name: "e2e", outcome: "failed" },
        { name: "build", outcome: "running" },
      ],
      conflicts: false,
      reason: "Merge waits for check and e2e to pass.",
    },
    {
      what: "it conflicts",
      checks: [{ name: "e2e", outcome: "passed" }],
      conflicts: true,
      reason: "It conflicts with main: Bring it up to date.",
    },
  ] as const)("refuses Merge with the reason while $what", async (when) => {
    const { id, branch } = await codeSession();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    github.setChecks(number, when.checks);
    github.setConflicts(number, when.conflicts);

    expect((await reviewOf(id)).merge).toEqual({ kind: "refused", reason: when.reason });
    const merging = await postJson(request, `/api/sessions/${id}/pull-request/merge`, {
      head: "c0ffee1",
    });

    expect(merging.status).toBe(409);
    expect(await errorOf(merging)).toBe(when.reason);
    expect(github.stateOf(number)).toBe("open");
  });

  it("merges once its checks pass, which ends the session and clears its worktree and branch away", async () => {
    const { id, branch } = await codeSession();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    github.setChecks(number, [{ name: "e2e", outcome: "passed" }]);
    expect((await reviewOf(id)).merge).toEqual({ kind: "ready" });

    const merging = await postJson(request, `/api/sessions/${id}/pull-request/merge`, {
      head: "c0ffee1",
    });

    expect(merging.status).toBe(204);
    expect(github.stateOf(number)).toBe("merged");
    expect(pullRequestsIn(await eventsOf(id)).at(-1)?.state).toBe("merged");
    expect(await gitIn(repo, "worktree", "list", "--porcelain")).not.toContain(branch);
    expect(await gitIn(repo, "branch", "--list", branch)).toBe("");
  });

  it("refuses Merge when the pull request changed since the owner reviewed it", async () => {
    const { id, branch } = await codeSession();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    github.setChecks(number, [{ name: "e2e", outcome: "passed" }]);
    expect((await reviewOf(id)).pullRequest.head).toBe("c0ffee1");
    // The session pushed again, and its checks passed, while the owner read the diff.
    github.setChecks(number, [{ name: "e2e", outcome: "passed" }], "decafe2");

    const merging = await postJson(request, `/api/sessions/${id}/pull-request/merge`, {
      head: "c0ffee1",
    });
    const unsaid = await postJson(request, `/api/sessions/${id}/pull-request/merge`, {});

    expect(merging.status).toBe(409);
    expect(await errorOf(merging)).toBe(
      "The pull request changed since you looked. Review it again.",
    );
    expect(unsaid.status).toBe(400);
    expect(github.stateOf(number)).toBe("open");
  });

  it("merges a repository with no checks", async () => {
    const { id, branch } = await codeSession();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });

    const merging = await postJson(request, `/api/sessions/${id}/pull-request/merge`, {
      head: "c0ffee1",
    });

    expect(merging.status).toBe(204);
    expect(github.stateOf(number)).toBe("merged");
  });

  it("closes it without merging, which ends the session and clears its worktree and branch away", async () => {
    const { id, branch } = await codeSession();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    github.setChecks(number, [{ name: "e2e", outcome: "failed" }]);

    const closing = await postJson(request, `/api/sessions/${id}/pull-request/close`, {});

    expect(closing.status).toBe(204);
    expect(github.stateOf(number)).toBe("closed");
    expect(pullRequestsIn(await eventsOf(id)).at(-1)?.state).toBe("closed");
    expect(await gitIn(repo, "branch", "--list", branch)).toBe("");
    const again = await postJson(request, `/api/sessions/${id}/pull-request/close`, {});
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe("It's closed already.");
  });

  it("says GitHub isn't connected when no one is signed in", async () => {
    const { id, branch } = await codeSession();
    github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    await postJson(request, "/api/github/sign-out", {});

    const response = await request(`/api/sessions/${id}/pull-request`);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe(
      "GitHub isn't connected. Sign in to GitHub from Connections in Settings.",
    );
  });

  it("says when the session has no pull request yet", async () => {
    const { id } = await codeSession();

    const response = await request(`/api/sessions/${id}/pull-request`);

    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe("This session has no pull request yet.");
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
      // And on GitHub: the session branch it pushed, once only.
      await runJobs();
      expect(github.branchesDeleted()).toEqual([{ repo: onGitHub, branch }]);
      // Still readable.
      expect((await request(`/api/sessions/${id}`)).status).toBe(200);
    },
  );

  it("clears away a worktree git has already half-removed, folder and all, and only once", async () => {
    const { id, branch } = await codeSession();
    const worktree = join(root, "data", "worktrees", id);
    // What `git worktree remove` leaves on Windows when a package install nests deeper than its
    // path limit: git has forgotten the worktree, but the folder and its files are still there.
    const deep = join(worktree, "node_modules", ...Array.from({ length: 12 }, () => "nested-pkg"));
    await mkdir(deep, { recursive: true });
    await writeFile(join(deep, "index.js"), "");
    await rm(join(worktree, ".git"), { force: true });
    await gitIn(repo, "worktree", "prune");
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    await runJobs();
    github.merge(number);

    await runJobs();
    await runJobs();

    expect(existsSync(worktree)).toBe(false);
    expect(await gitIn(repo, "branch", "--list", branch)).toBe("");
    expect(github.branchesDeleted()).toEqual([{ repo: onGitHub, branch }]);
  });
});

// The PR page (#278): every open pull request on the repository, whoever opened it; a conflict
// said as one; one tap to bring a pull request up to date; and a session started on a pull
// request that has none.

/** Every open pull request on Side project's repository, as the PRs list asks for them. */
const openPullRequests = async () => {
  const response = await request("/api/workspaces/side-project/pull-requests");
  expect(response.status).toBe(200);
  return OpenPullRequestList.parse(await response.json()).pullRequests;
};

/** A branch pushed to GitHub's copy by someone other than a session: its latest commit. */
const pushedBranch = async (branch: string) => {
  await gitIn(repo, "switch", "--quiet", "-c", branch);
  await writeFile(join(repo, "builds.md"), "Builds take turns\n");
  await gitIn(repo, "add", ".");
  await gitIn(repo, "commit", "--quiet", "-m", "Builds take turns");
  await gitIn(repo, "push", "--quiet", "origin", branch);
  const head = (await gitIn(repo, "rev-parse", "HEAD")).trim();
  await gitIn(repo, "switch", "--quiet", "main");
  await gitIn(repo, "branch", "--quiet", "-D", branch);
  return head;
};

/** A description a Claude Code helper wrote: signed as its PR skill signs them. */
const SIGNED =
  "## Summary\n\nBuilds take turns.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)";

describe("the PRs list (#278)", () => {
  it("lists every open pull request on the repository, whoever opened it, a session's with its link", async () => {
    const { id, branch } = await codeSession();
    const fromSession = github.openPullRequest({
      repo: onGitHub,
      branch,
      head: "c0ffee1",
      title: "Talk",
    });
    const fromHelper = github.openPullRequest({
      repo: onGitHub,
      branch: "306-machine-lock",
      head: "c0ffee2",
      title: "Builds queue across the whole PC",
      body: SIGNED,
    });
    const fromSomeone = github.openPullRequest({
      repo: onGitHub,
      branch: "readme",
      head: "c0ffee3",
      title: "README",
      author: "someone-else",
    });
    const merged = github.openPullRequest({ repo: onGitHub, branch: "old", head: "c0ffee4" });
    github.merge(merged);
    github.openPullRequest({ repo: "octo-owner/stacks", branch: "elsewhere", head: "c0ffee5" });

    const listed = await openPullRequests();

    expect(listed.map((open) => open.pullRequest.number)).toEqual([
      fromSomeone,
      fromHelper,
      fromSession,
    ]);
    expect(listed).toEqual([
      expect.objectContaining({
        branch: "readme",
        from: { kind: "github", login: "someone-else" },
      }),
      expect.objectContaining({ branch: "306-machine-lock", from: { kind: "claude-code" } }),
      expect.objectContaining({
        branch,
        from: { kind: "session", sessionId: id, title: expect.any(String) },
        pullRequest: expect.objectContaining({ title: "Talk", state: "open" }),
      }),
    ]);
  });

  it("says a pull request conflicts with its base, in the list and in its session", async () => {
    const { id, branch } = await codeSession();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    github.setConflicts(number, true);

    await runJobs();

    expect((await openPullRequests())[0]?.pullRequest.conflicts).toBe(true);
    expect(pullRequestsIn(await eventsOf(id)).at(-1)?.conflicts).toBe(true);
    const { sessions } = CodeSessionList.parse(
      await (await request("/api/workspaces/side-project/sessions")).json(),
    );
    expect(sessions.find((session) => session.id === id)?.pullRequest?.conflicts).toBe(true);
  });

  it("says what each waits on the owner for (#334): failing checks, a merge, a conflict, or nothing", async () => {
    const opened = (branch: string) =>
      github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1", author: "someone-else" });
    const failing = opened("failing");
    github.setChecks(failing, [{ name: "e2e", outcome: "failed" }]);
    const ready = opened("ready");
    github.setChecks(ready, [{ name: "e2e", outcome: "passed" }]);
    const conflicting = opened("conflicting");
    github.setChecks(conflicting, [{ name: "e2e", outcome: "failed" }]);
    github.setConflicts(conflicting, true);
    const running = opened("running");
    github.setChecks(running, [{ name: "e2e", outcome: "running" }]);

    const listed = await openPullRequests();

    const waiting = (number: number) =>
      listed.find((open) => open.pullRequest.number === number)?.waiting;
    expect(waiting(failing)).toBe("failed");
    expect(waiting(ready)).toBe("merge");
    expect(waiting(conflicting)).toBe("conflict");
    expect(waiting(running)).toBe("nothing");
  });

  it("doesn't wait on the owner for checks the session is fixing, and does once it's done", async () => {
    const { branch } = await codeSession();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    github.setChecks(number, [{ name: "e2e", outcome: "failed" }]);
    let release = () => {};
    holding = new Promise((resolve) => {
      release = resolve;
    });

    await runJobs();

    await expect.poll(async () => (await openPullRequests())[0]?.waiting).toBe("nothing");
    release();
    holding = undefined;
    await expect.poll(async () => (await openPullRequests())[0]?.waiting).toBe("failed");
  });

  it("still lists its sessions' open pull requests, as last seen, while GitHub isn't connected", async () => {
    const { branch } = await codeSession();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    await runJobs();
    await postJson(request, "/api/github/sign-out", {});

    const listed = await openPullRequests();

    expect(listed.map((open) => open.pullRequest.number)).toEqual([number]);
  });
});

describe("bringing a pull request up to date (#278)", () => {
  it("sends its session the message to merge main in and fix the conflict, on the model it last used", async () => {
    const { id, branch, lastSeq } = await codeSession();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    github.setConflicts(number, true);

    const brought = await postJson(
      request,
      `/api/sessions/${id}/pull-request/bring-up-to-date`,
      {},
    );

    expect(brought.status).toBe(202);
    const events = await followSession(request, {
      sessionId: id,
      until: "turn-completed",
      after: lastSeq,
    });
    expect(events.find((event) => event.type === "owner-message")).toMatchObject({
      text: await quotedInGuide("Your pull request #<number> conflicts", {
        number: String(number),
        base: "main",
      }),
      model: FAKE_MODEL,
    });
  });

  it("queues the message while a turn runs", async () => {
    const { id, branch } = await codeSession();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });
    github.setConflicts(number, true);
    let answer: () => void = () => {};
    holding = new Promise((resolve) => {
      answer = resolve;
    });
    await postJson(request, `/api/sessions/${id}/messages`, { text: "Busy", model: FAKE_MODEL });

    const brought = await postJson(
      request,
      `/api/sessions/${id}/pull-request/bring-up-to-date`,
      {},
    );

    expect(brought.status).toBe(202);
    const queued = await followSession(request, { sessionId: id, until: "message-queued" });
    expect(queued.at(-1)).toMatchObject({
      type: "message-queued",
      text: expect.stringContaining(`Your pull request #${number} conflicts with main`),
    });
    holding = undefined;
    answer();
  });

  it("says when the session has no pull request yet", async () => {
    const { id } = await codeSession();

    const brought = await postJson(
      request,
      `/api/sessions/${id}/pull-request/bring-up-to-date`,
      {},
    );

    expect(brought.status).toBe(404);
    expect(await errorOf(brought)).toBe("This session has no pull request yet.");
  });
});

describe("a pull request no session opened (#278)", () => {
  it("is reviewed, merged and closed by its number", async () => {
    const head = await pushedBranch("306-machine-lock");
    const number = github.openPullRequest({
      repo: onGitHub,
      branch: "306-machine-lock",
      head,
      title: "Builds queue",
      body: SIGNED,
    });
    github.setChecks(number, [{ name: "e2e", outcome: "passed" }]);
    const other = github.openPullRequest({ repo: onGitHub, branch: "readme", head: "c0ffee3" });

    const reviewed = await request(`/api/workspaces/side-project/pull-requests/${number}`);
    expect(reviewed.status).toBe(200);
    expect(PullRequestReview.parse(await reviewed.json())).toMatchObject({
      pullRequest: { number, title: "Builds queue" },
      branch: "306-machine-lock",
      merge: { kind: "ready" },
    });

    const merging = await postJson(
      request,
      `/api/workspaces/side-project/pull-requests/${number}/merge`,
      { head },
    );
    expect(merging.status).toBe(204);
    expect(github.stateOf(number)).toBe("merged");
    const after = PullRequestReview.parse(
      await (await request(`/api/workspaces/side-project/pull-requests/${number}`)).json(),
    );
    expect(after.pullRequest.state).toBe("merged");
    expect(after.mergedAt).toEqual(expect.any(String));

    const closing = await postJson(
      request,
      `/api/workspaces/side-project/pull-requests/${other}/close`,
      {},
    );
    expect(closing.status).toBe(204);
    expect(github.stateOf(other)).toBe("closed");
    const missing = await request("/api/workspaces/side-project/pull-requests/99");
    expect(missing.status).toBe(404);
  });

  it("gets a session on its branch, started with the owner's question, which then opens it", async () => {
    const head = await pushedBranch("306-machine-lock");
    const number = github.openPullRequest({
      repo: onGitHub,
      branch: "306-machine-lock",
      head,
      body: SIGNED,
    });

    const started = await postJson(
      request,
      `/api/workspaces/side-project/pull-requests/${number}/sessions`,
      { kind: "ask", text: "Can this be merged?", model: FAKE_MODEL },
    );

    expect(started.status).toBe(201);
    const { id } = (await started.json()) as { id: string };
    const events = await followSession(request, { sessionId: id, until: "turn-completed" });
    expect(events[0]).toMatchObject({ type: "owner-message", text: "Can this be merged?" });
    const worktree = join(root, "data", "worktrees", id);
    expect((await gitIn(worktree, "branch", "--show-current")).trim()).toBe("306-machine-lock");
    expect((await gitIn(worktree, "rev-parse", "HEAD")).trim()).toBe(head);
    expect((await openPullRequests())[0]?.from).toEqual({
      kind: "session",
      sessionId: id,
      title: expect.any(String),
    });
    // Once it's merged, the branch on GitHub stays: it isn't one of Courtyard's.
    github.merge(number);
    await runJobs();
    await runJobs();
    expect(github.branchesDeleted()).toEqual([]);
    expect(existsSync(worktree)).toBe(false);
  });

  it("gets a session on its branch to bring it up to date", async () => {
    const head = await pushedBranch("306-machine-lock");
    const number = github.openPullRequest({ repo: onGitHub, branch: "306-machine-lock", head });
    github.setConflicts(number, true);

    const started = await postJson(
      request,
      `/api/workspaces/side-project/pull-requests/${number}/sessions`,
      { kind: "bring-up-to-date", model: FAKE_MODEL },
    );

    expect(started.status).toBe(201);
    const { id, title } = (await started.json()) as { id: string; title: string };
    expect(title).toBe(`Bring #${number} up to date`);
    const events = await followSession(request, { sessionId: id, until: "turn-completed" });
    expect(events[0]).toMatchObject({
      type: "owner-message",
      text: await quotedInGuide("Your pull request #<number> conflicts", {
        number: String(number),
        base: "main",
      }),
    });
  });

  it("can't get a second session while one is on it", async () => {
    const { branch } = await codeSession();
    const number = github.openPullRequest({ repo: onGitHub, branch, head: "c0ffee1" });

    const started = await postJson(
      request,
      `/api/workspaces/side-project/pull-requests/${number}/sessions`,
      { kind: "ask", text: "Can this be merged?", model: FAKE_MODEL },
    );

    expect(started.status).toBe(409);
    expect(await errorOf(started)).toBe(
      "A session is on this pull request already: ask it from its page.",
    );
  });
});
