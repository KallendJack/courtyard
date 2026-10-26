import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { takePlace } from "@courtyard/builds";
import {
  type BuilderStatus,
  CodeSessionList,
  type FailureReason,
  GitHubConnection,
  LeadStatus,
  NeedsYou,
  SessionSummary,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { err, ok, type Result } from "../src/lib/result.ts";
import type { CodeTurn, Provider, TurnInput } from "../src/providers/index.ts";
import {
  CODING_MODEL,
  codeRepo,
  codeWorkspace,
  codingProvider,
  createFakeGitHub,
  createFakePush,
  type FakeGitHub,
  type FakePush,
  followSession,
  gitIn,
  postJson,
  quotedInGuide,
  type Requester,
  removeTestFolder,
  requesterFor,
  setUpOwner,
  testBuildsLock,
  testWorker,
  updateWaiting,
} from "./testing.ts";

// Each Lead builder's status (#590, ADR 0031): one of eight, recorded by the worker as things
// happen, each with when it began, and served with the Lead. Through the fake provider, against
// the fake GitHub, with real git in temporary folders.

let root: string;
let repo: string;
let onGitHub: string;
let github: FakeGitHub;
/** The worker's repeating jobs, run when a test says, as time passing would. */
let jobs: (() => Promise<void>)[];
/**
 * The job following pull requests: the first every 30 seconds. Run on its own, the Lead hasn't
 * yet let go of a builder whose pull request merged.
 */
let followPullRequests: () => Promise<void>;
/** The worker's clock, which each test moves on. */
let now: number;

const MINUTE = 60 * 1000;
/** How long a test waits on what the worker does next, which a busy machine slows. */
const SLOW = { timeout: 15_000 };
const at = (time: number) => new Date(time).toISOString();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo, github: onGitHub } = await codeRepo(root));
  now = Date.parse("2026-10-20T09:00:00Z");
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** A turn of a builder's, as the test plays it: what it does, then how it ends. */
type Plan = (turn: { code: CodeTurn; input: TurnInput }) => Promise<Result<null, FailureReason>>;

/**
 * A provider that codes, playing each builder turn by the next of `plans`, in order. The Lead's
 * own turns only answer.
 */
const playing = (plans: Plan[]) => {
  const { provider: coder } = codingProvider([]);
  const told: string[] = [];
  const provider: Provider = {
    ...coder,
    runTurn: async (input) => {
      const { code } = input;
      if (code === null) return err({ kind: "unknown", message: "Only codes." });
      const lead =
        input.framing.newMessage.startsWith("Run the build order") ||
        !(await isBuilderWorktree(code.worktree));
      if (lead) {
        await input.emit("Done.");
        return ok(null);
      }
      told.push(input.framing.newMessage);
      const plan = plans.shift();
      if (plan === undefined) {
        await input.emit("Opened its pull request.");
        return ok(null);
      }
      return plan({ code, input });
    },
  };
  return { provider, told };
};

/** The session ids of the builders, once known, so the provider can tell their turns apart. */
let builderIds: string[] = [];
const isBuilderWorktree = async (worktree: string) => {
  if (builderIds.length === 0) {
    builderIds = (await sessionsList()).filter((each) => each.byLead).map((each) => each.id);
  }
  return builderIds.some((id) => worktree.includes(id));
};

let request: Requester;
/** The notifications the worker sends, to the one device that turned them on (#593). */
let push: FakePush;
/** The owner's login, kept across restarts. */
let cookie: string | undefined;
/** Starts the worker again on the same folders, as a restart (a crash, the PC restarting) does. */
let restart: () => Promise<void>;
const sessionsList = async () =>
  CodeSessionList.parse(await (await request("/api/workspaces/side-project/sessions")).json())
    .sessions;

/** A worker with Side project on the fake GitHub, one issue ready to build, signed in. */
const signedIn = async (provider: Provider, env: Record<string, string> = {}) => {
  await codeWorkspace(root, "side-project", repo, { name: "Side project" });
  github = createFakeGitHub({
    issues: { [onGitHub]: [{ number: 22, title: "Which session waits", milestone: "4 · Code" }] },
    milestones: { [onGitHub]: { "4 · Code": "NOW. Build order: #22." } },
  });
  builderIds = [];
  push = createFakePush();
  restart = async () => {
    jobs = [];
    const app = testWorker({
      root,
      env,
      github: github.api,
      providers: [provider],
      sendPush: push.send,
      now: () => now,
      repeat: (everyMs, job) => {
        if (everyMs === 30_000 && !jobs.some((each) => each === followPullRequests)) {
          followPullRequests = job;
        }
        jobs.push(job);
      },
    });
    cookie ??= await setUpOwner(app);
    request = requesterFor(app, cookie);
  };
  cookie = undefined;
  await restart();
  await postJson(request, "/api/notifications/on", {
    endpoint: "https://push.example/fold",
    keys: { p256dh: "p256dh-of-fold", auth: "auth-of-fold" },
  });
  await postJson(request, "/api/github/sign-in", {});
  github.approve();
  await expect
    .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
    .toBe("signed-in");
};

const runJobs = async () => {
  for (const job of jobs) await job();
};

/** Runs the build order, starting a builder for #22: its session. */
const build = async () => {
  const response = await postJson(request, "/api/workspaces/side-project/lead/run", {
    model: CODING_MODEL,
  });
  expect(response.status).toBe(200);
  const builder = (await sessionsList()).find((each) => each.byLead === true);
  if (builder === undefined) throw new Error("No builder started");
  return builder;
};

/** The builder's status, as the Lead serves it. */
const statusOf = async (): Promise<BuilderStatus | undefined> =>
  LeadStatus.parse(await (await request("/api/workspaces/side-project/lead")).json()).statuses[0]
    ?.status;

/** Waits until the builder's status is of `kind`, and gives it. */
const becomes = async (kind: BuilderStatus["kind"]) => {
  await expect.poll(async () => (await statusOf())?.kind, SLOW).toBe(kind);
  return statusOf();
};

const settled = () =>
  expect.poll(async () => (await sessionsList()).filter((each) => each.busy), SLOW).toHaveLength(0);

/** A place the test lets a turn go on from. */
const gate = () => {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  let reached: () => void = () => {};
  const reachedNow = new Promise<void>((resolve) => {
    reached = resolve;
  });
  return {
    /** For the turn: says it's here, and waits to be let go on. */
    pass: async () => {
      reached();
      await opened;
    },
    reached: reachedNow,
    open,
  };
};

describe("a Lead builder's status (#590)", () => {
  it("is Building from its first turn, Checking while a check waits for its place and runs, Building once it ends", async () => {
    const started = gate();
    const waiting = gate();
    const checked = gate();
    const { provider } = playing([
      async ({ code, input }) => {
        await started.pass();
        const allowed = code.run("pnpm -C apps/worker exec vitest run test/live.test.ts");
        await waiting.pass();
        await allowed;
        await checked.pass();
        code.ran("pnpm -C apps/worker exec vitest run test/live.test.ts");
        await input.emit("Done. What should the button say?");
        return ok(null);
      },
    ]);
    await signedIn(provider);
    // Another build holds the machine's only place, so the check waits for it.
    const outside = await takePlace(testBuildsLock(root), { label: "helper /path/to/repo" });

    await build();
    await started.reached;
    expect(await statusOf()).toEqual({ kind: "building", since: at(now) });
    const began = now;
    now += MINUTE;
    started.open();
    await waiting.reached;
    expect(await becomes("checking")).toEqual({
      kind: "checking",
      since: at(began + MINUTE),
      command: "pnpm -C apps/worker exec vitest run test/live.test.ts",
      ahead: 1,
    });
    now += MINUTE;
    outside?.free();
    waiting.open();
    await checked.reached;
    // Its place taken, it runs: Checking still, since the check began.
    expect(await statusOf()).toEqual({
      kind: "checking",
      since: at(began + MINUTE),
      command: "pnpm -C apps/worker exec vitest run test/live.test.ts",
    });
    now += MINUTE;
    checked.open();
    // Its answer asked the owner something: Waiting on you, since the turn ended.
    expect(await becomes("waiting-on-you")).toEqual({
      kind: "waiting-on-you",
      since: at(began + 3 * MINUTE),
    });
    await settled();
  });

  it("waits on you while its approval does, and is Building again once it's answered", async () => {
    const answered = gate();
    const { provider } = playing([
      async ({ code, input }) => {
        const allowed = code.run("curl https://courtyard.example/status");
        await allowed;
        await answered.pass();
        await input.emit("Done.");
        return ok(null);
      },
    ]);
    await signedIn(provider);

    const builder = await build();
    const waits = await becomes("waiting-on-you");
    expect(waits).toMatchObject({ since: at(now), approval: expect.any(Number) });
    now += MINUTE;
    const approval = waits?.kind === "waiting-on-you" ? waits.approval : undefined;
    await postJson(request, `/api/sessions/${builder.id}/approvals/${approval}`, {
      answer: "allow",
    });
    await answered.reached;
    expect(await statusOf()).toEqual({ kind: "building", since: at(now) });
    answered.open();
    await settled();
  });

  it("is In CI once its turn ends with its pull request open, Ready for review once its checks pass, then Merged", async () => {
    const pushed = gate();
    const { provider } = playing([
      async ({ input }) => {
        await pushed.pass();
        await input.emit("Opened its pull request.");
        return ok(null);
      },
    ]);
    await signedIn(provider);
    const builder = await build();
    await pushed.reached;
    const number = github.openPullRequest({
      repo: onGitHub,
      branch: builder.branch ?? "",
      head: "c0ffee1",
    });
    github.setChecks(number, [{ name: "Checks", outcome: "running" }]);

    now += MINUTE;
    pushed.open();
    await settled();
    expect(await becomes("in-ci")).toEqual({
      kind: "in-ci",
      since: at(now),
      pullRequest: number,
    });

    now += MINUTE;
    github.setChecks(number, [{ name: "Checks", outcome: "passed" }]);
    await runJobs();
    expect(await becomes("ready-for-review")).toEqual({
      kind: "ready-for-review",
      since: at(now),
      pullRequest: number,
    });

    now += MINUTE;
    github.merge(number);
    await followPullRequests();
    expect(await becomes("merged")).toEqual({
      kind: "merged",
      since: at(now),
      pullRequest: number,
    });
    await settled();
  });

  it("is Building again when its pull request's checks fail, as it fixes them", async () => {
    const pushed = gate();
    const { provider } = playing([
      async ({ input }) => {
        await pushed.pass();
        await input.emit("Opened its pull request.");
        return ok(null);
      },
    ]);
    await signedIn(provider);
    const builder = await build();
    await pushed.reached;
    const number = github.openPullRequest({
      repo: onGitHub,
      branch: builder.branch ?? "",
      head: "c0ffee1",
    });
    github.setChecks(number, [{ name: "Checks", outcome: "running" }]);
    pushed.open();
    await settled();
    await becomes("in-ci");

    now += MINUTE;
    github.setChecks(number, [{ name: "Checks", outcome: "failed" }]);
    await runJobs();

    expect(await becomes("building")).toEqual({ kind: "building", since: at(now) });
    await settled();
  });

  it("fixes its pull request's failing checks while an Update waits (#621)", async () => {
    const pushed = gate();
    const { provider, told } = playing([
      async ({ input }) => {
        await pushed.pass();
        await input.emit("Opened its pull request.");
        return ok(null);
      },
    ]);
    // Courtyard's live copy is this repository, so an Update can wait on main's build.
    await signedIn(provider, { COURTYARD_LIVE_COPY: repo });
    const builder = await build();
    await pushed.reached;
    const number = github.openPullRequest({
      repo: onGitHub,
      branch: builder.branch ?? "",
      head: "c0ffee1",
    });
    github.setChecks(number, [{ name: "Checks", outcome: "running" }]);
    pushed.open();
    await settled();
    await becomes("in-ci");
    await updateWaiting({ request, repo, github });

    github.setChecks(number, [{ name: "Checks", outcome: "failed" }]);
    await runJobs();

    await expect.poll(() => told.length, SLOW).toBe(2);
    expect(told.at(1)).toMatch(/^The checks on your pull request/);
    await settled();
  });

  it("waits for the limit, saying when it resets, and carries on by itself once it has (#610)", async () => {
    const resetAt = "2026-10-20T10:00:00.000Z";
    const { provider, told } = playing([
      async () => err({ kind: "rate-limited", resetAt }),
      async ({ input }) => {
        await input.emit("Which screen should it go on?");
        return ok(null);
      },
    ]);
    await signedIn(provider);

    const builder = await build();
    await settled();
    expect(await becomes("waiting-for-limit")).toEqual({
      kind: "waiting-for-limit",
      since: at(now),
      resetAt,
    });
    now = Date.parse(resetAt) - MINUTE;
    await runJobs();
    expect(told).toHaveLength(1);

    now = Date.parse(resetAt);
    await runJobs();

    const reset = await quotedInGuide("The usage limit your last turn met has reset");
    const events = await followSession(request, {
      sessionId: builder.id,
      until: (event) => event.type === "owner-message" && event.afterLimit === true,
    });
    expect(events.at(-1)).toMatchObject({ text: reset });
    await expect.poll(() => told.at(-1), SLOW).toBe(reset);
    expect(await becomes("waiting-on-you")).toMatchObject({ kind: "waiting-on-you" });
    await settled();
  });

  it("cut off by a restart it didn't start, carries on by itself once; cut off again, it's Stuck (#610)", async () => {
    const first = gate();
    const second = gate();
    const { provider, told } = playing([
      async ({ input }) => {
        await first.pass();
        await input.emit("Which screen should it go on?");
        return ok(null);
      },
      async ({ input }) => {
        await second.pass();
        await input.emit("Which screen should it go on?");
        return ok(null);
      },
    ]);
    await signedIn(provider);
    const builder = await build();
    await first.reached;

    // The PC restarts mid-turn: the next worker finds the turn cut off.
    await restart();
    await sessionsList();
    await second.reached;

    const carriedOn = await followSession(request, {
      sessionId: builder.id,
      until: (event) => event.type === "owner-message" && event.continues !== undefined,
    });
    expect(carriedOn.at(-1)).toMatchObject({
      text: await quotedInGuide("Courtyard restarted while"),
    });
    expect(await statusOf()).toMatchObject({ kind: "building" });

    // Cut off again, it waits on the owner: Stuck, saying why, and no third turn.
    await restart();
    await sessionsList();
    expect(await becomes("stuck")).toEqual({
      kind: "stuck",
      since: at(now),
      reason: "A restart cut its turn off twice.",
    });
    expect(told).toHaveLength(2);
    first.open();
    second.open();
  });

  it("cut off by a restart after its pull request merged, ends quietly: Merged, not in Needs you, no Continue (#755)", async () => {
    const working = gate();
    const { provider, told } = playing([
      async ({ input }) => {
        await working.pass();
        await input.emit("Opened its pull request.");
        return ok(null);
      },
    ]);
    await signedIn(provider);
    const builder = await build();
    await working.reached;
    const number = github.openPullRequest({
      repo: onGitHub,
      branch: builder.branch ?? "",
      head: "c0ffee1",
    });
    github.setChecks(number, [{ name: "Checks", outcome: "passed" }]);
    github.merge(number);
    await followPullRequests();
    await becomes("merged");

    // The worker restarts while its turn still runs.
    await restart();
    await expect
      .poll(async () => (await sessionsList()).find((each) => each.id === builder.id)?.busy, SLOW)
      .toBe(false);

    const listed = (await sessionsList()).find((each) => each.id === builder.id);
    expect(listed?.waiting).toBe("nothing");
    const needs = NeedsYou.parse(await (await request("/api/needs-you")).json());
    expect(needs.needs).toEqual([]);
    expect(await statusOf()).toMatchObject({ kind: "merged", pullRequest: number });
    await runJobs();
    expect(told).toHaveLength(1);
    working.open();
  });

  it("is told its task has ended while an Update waits (#610)", async () => {
    await writeFile(
      join(repo, "wait.mjs"),
      'import { existsSync } from "node:fs";\nconst timer = setInterval(() => { if (existsSync("go")) { clearInterval(timer); console.log("Went"); } }, 50);\n',
    );
    await gitIn(repo, "add", ".");
    await gitIn(repo, "commit", "--quiet", "-m", "A task that waits");
    await gitIn(repo, "push", "--quiet", "origin", "main");
    const { provider } = playing([
      async ({ code, input }) => {
        const started = await code.task("node wait.mjs");
        await input.emit(
          `${started.ok ? started.value : started.error} Which screen should it go on?`,
        );
        return ok(null);
      },
      async ({ input }) => {
        await input.emit("Its task went. Which screen should it go on?");
        return ok(null);
      },
    ]);
    // Courtyard's live copy is this repository, a version behind main, whose build still runs.
    await signedIn(provider, { COURTYARD_LIVE_COPY: repo });
    const builder = await build();
    await settled();
    await becomes("waiting-on-you");
    await updateWaiting({ request, repo, github });

    await writeFile(join(root, "data", "worktrees", builder.id, "go"), "");

    const events = await followSession(request, {
      sessionId: builder.id,
      until: (event) => event.type === "owner-message" && event.tasksEnded !== undefined,
    });
    expect(events.at(-1)).toMatchObject({ type: "owner-message" });
    await settled();
  });

  it("is Stuck when its turn fails, saying why", async () => {
    const { provider } = playing([
      async () => err({ kind: "unknown", message: "The model connection stopped unexpectedly." }),
    ]);
    await signedIn(provider);

    await build();
    await settled();

    expect(await becomes("stuck")).toEqual({
      kind: "stuck",
      since: at(now),
      reason: "Its turn failed: The model connection stopped unexpectedly.",
    });
  });

  it("Stuck, Retry starts a turn telling it to try again: Building, with its one carry-on again (#592)", async () => {
    const nothing: Plan = async ({ input }) => {
      await input.emit("I've looked around the code.");
      return ok(null);
    };
    const { provider, told } = playing([
      nothing,
      nothing,
      nothing,
      async ({ input }) => {
        await input.emit("Which screen should it go on?");
        return ok(null);
      },
    ]);
    await signedIn(provider);
    const builder = await build();
    await becomes("stuck");
    await settled();

    const retried = await postJson(request, `/api/sessions/${builder.id}/retry`, {});
    expect(retried.status).toBe(202);
    await expect
      .poll(() => told.at(2), SLOW)
      .toBe(await quotedInGuide("Try again with your issue"));
    // Its turn ends with nothing to show: told to carry on once, as a fresh start is.
    await expect.poll(() => told.length, SLOW).toBe(4);
    expect(told.at(3)).toBe(await quotedInGuide("Carry on with your issue"));
    expect(await becomes("waiting-on-you")).toMatchObject({ kind: "waiting-on-you" });
    await settled();

    const again = await postJson(request, `/api/sessions/${builder.id}/retry`, {});
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "Only a stuck builder can be retried." });
  });

  it("ending a turn with no pull request and no question is told to carry on once, then is Stuck", async () => {
    const { provider, told } = playing([
      async ({ input }) => {
        await input.emit("I've looked around the code.");
        return ok(null);
      },
      async ({ input }) => {
        await input.emit("Still looking.");
        return ok(null);
      },
    ]);
    await signedIn(provider);

    const builder = await build();
    await expect.poll(() => told.length, SLOW).toBe(2);

    const carryOn = await quotedInGuide("Carry on with your issue");
    expect(told.at(1)).toBe(carryOn);
    const events = await followSession(request, {
      sessionId: builder.id,
      until: (event) => event.type === "owner-message" && event.carriesOn === true,
    });
    expect(events.at(-1)).toMatchObject({ text: carryOn });
    expect(await becomes("stuck")).toEqual({
      kind: "stuck",
      since: at(now),
      reason: "It ended two turns in a row with no pull request and no question.",
    });
    // Told once only: no third turn.
    await settled();
    expect(told).toHaveLength(2);
  });
});

/** What the notifications sent so far carried, oldest first. */
const notices = () => push.sent.map(({ payload }) => payload);

/** The page a builder's notification opens: its workspace's Home, its row on the Builders board. */
const rowOf = (session: string) => `/workspaces/side-project#builder-${session}`;

describe("notifying the owner of a Lead builder (#593, ADR 0031)", () => {
  it("notifies once when it waits on you for an approval, saying the command, and again for its question", async () => {
    const answered = gate();
    const { provider } = playing([
      async ({ code, input }) => {
        await code.run("curl https://courtyard.example/status");
        await answered.pass();
        await input.emit("Done. Which screen should it go on?");
        return ok(null);
      },
    ]);
    await signedIn(provider);

    const builder = await build();
    const waits = await becomes("waiting-on-you");
    const approval = {
      title: "Which session waits is waiting on you",
      body: "curl https://courtyard.example/status",
      session: builder.id,
      page: rowOf(builder.id),
    };
    await expect.poll(notices, SLOW).toEqual([approval]);
    // No repeat while it waits.
    await runJobs();
    await runJobs();
    expect(notices()).toEqual([approval]);

    const number = waits?.kind === "waiting-on-you" ? waits.approval : undefined;
    await postJson(request, `/api/sessions/${builder.id}/approvals/${number}`, {
      answer: "allow",
    });
    answered.open();
    await settled();

    await expect
      .poll(notices, SLOW)
      .toEqual([approval, { ...approval, body: "Which screen should it go on?" }]);
  });

  it("notifies when it's Stuck, saying why, and nothing more of its failed turn", async () => {
    const { provider } = playing([
      async () => err({ kind: "unknown", message: "The model connection stopped unexpectedly." }),
    ]);
    await signedIn(provider);

    const builder = await build();
    await settled();
    await becomes("stuck");
    await runJobs();

    await expect.poll(notices, SLOW).toEqual([
      {
        title: "Which session waits is Stuck",
        body: "Its turn failed: The model connection stopped unexpectedly.",
        session: builder.id,
        page: rowOf(builder.id),
      },
    ]);
  });

  it("sends none as it starts, is In CI, Ready for review or Merged", async () => {
    const pushed = gate();
    const { provider } = playing([
      async ({ input }) => {
        await pushed.pass();
        await input.emit("Opened its pull request.");
        return ok(null);
      },
    ]);
    await signedIn(provider);
    const builder = await build();
    await pushed.reached;
    const number = github.openPullRequest({
      repo: onGitHub,
      branch: builder.branch ?? "",
      head: "c0ffee1",
    });
    github.setChecks(number, [{ name: "Checks", outcome: "running" }]);
    pushed.open();
    await settled();
    await becomes("in-ci");
    github.setChecks(number, [{ name: "Checks", outcome: "passed" }]);
    await runJobs();
    await becomes("ready-for-review");
    await runJobs();
    github.merge(number);
    await followPullRequests();
    await becomes("merged");
    await runJobs();

    expect(notices()).toEqual([]);
  });

  it("sends none while a restart's cut-off carries on by itself; cut off again, only that it's Stuck", async () => {
    const first = gate();
    const second = gate();
    const { provider } = playing([
      async ({ input }) => {
        await first.pass();
        await input.emit("Which screen should it go on?");
        return ok(null);
      },
      async ({ input }) => {
        await second.pass();
        await input.emit("Which screen should it go on?");
        return ok(null);
      },
    ]);
    await signedIn(provider);
    const builder = await build();
    await first.reached;

    await restart();
    await sessionsList();
    await second.reached;
    expect(notices()).toEqual([]);

    await restart();
    await sessionsList();
    await becomes("stuck");
    await expect.poll(notices, SLOW).toEqual([
      {
        title: "Which session waits is Stuck",
        body: "A restart cut its turn off twice.",
        session: builder.id,
        page: rowOf(builder.id),
      },
    ]);
    first.open();
    second.open();
  });
});

describe("a Lead builder's helpers (#621, ADR 0031)", () => {
  it("starts none: its turns can't start one and aren't told of them, while the owner's sessions keep theirs", async () => {
    const offered: { worktree: string; helpers: boolean; told: boolean }[] = [];
    const { provider: played } = playing([
      async ({ input }) => {
        await input.emit("Which screen should it go on?");
        return ok(null);
      },
    ]);
    const provider: Provider = {
      ...played,
      runTurn: async (input) => {
        if (input.code !== null) {
          offered.push({
            worktree: input.code.worktree,
            helpers: input.code.helper !== null,
            told: /helper|sub-agent/i.test(input.framing.instructions),
          });
        }
        return played.runTurn(input);
      },
    };
    await signedIn(provider);

    const builder = await build();
    await settled();
    const asked = await postJson(request, "/api/workspaces/side-project/sessions", {
      text: "Tidy the README",
      model: CODING_MODEL,
    });
    expect(asked.status).toBe(201);
    const own = SessionSummary.parse(await asked.json());
    await settled();

    const turnsOf = (id: string) =>
      offered
        .filter((each) => each.worktree.includes(id))
        .map(({ helpers, told }) => ({ helpers, told }));
    expect(turnsOf(builder.id)).toEqual([{ helpers: false, told: false }]);
    expect(turnsOf(own.id)).toEqual([{ helpers: true, told: true }]);
  });
});
