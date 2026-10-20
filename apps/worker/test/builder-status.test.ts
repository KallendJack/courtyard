import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { takePlace } from "@courtyard/builds";
import {
  type BuilderStatus,
  CodeSessionList,
  type FailureReason,
  GitHubConnection,
  LeadStatus,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { err, ok, type Result } from "../src/lib/result.ts";
import type { CodeTurn, Provider, TurnInput } from "../src/providers/index.ts";
import {
  asOwner,
  CODING_MODEL,
  codeRepo,
  codeWorkspace,
  codingProvider,
  createFakeGitHub,
  type FakeGitHub,
  followSession,
  postJson,
  quotedInGuide,
  type Requester,
  removeTestFolder,
  testBuildsLock,
  testWorker,
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
const sessionsList = async () =>
  CodeSessionList.parse(await (await request("/api/workspaces/side-project/sessions")).json())
    .sessions;

/** A worker with Side project on the fake GitHub, one issue ready to build, signed in. */
const signedIn = async (provider: Provider) => {
  await codeWorkspace(root, "side-project", repo, { name: "Side project" });
  github = createFakeGitHub({
    issues: { [onGitHub]: [{ number: 22, title: "Which session waits", milestone: "4 · Code" }] },
    milestones: { [onGitHub]: { "4 · Code": "NOW. Build order: #22." } },
  });
  jobs = [];
  builderIds = [];
  request = await asOwner(
    testWorker({
      root,
      github: github.api,
      providers: [provider],
      now: () => now,
      repeat: (everyMs, job) => {
        if (everyMs === 30_000 && !jobs.some((each) => each === followPullRequests)) {
          followPullRequests = job;
        }
        jobs.push(job);
      },
    }),
  );
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
  await expect.poll(async () => (await statusOf())?.kind).toBe(kind);
  return statusOf();
};

const settled = () =>
  expect.poll(async () => (await sessionsList()).filter((each) => each.busy)).toHaveLength(0);

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

  it("waits for the limit, saying when it resets", async () => {
    const resetAt = "2026-10-20T10:00:00.000Z";
    const { provider } = playing([async () => err({ kind: "rate-limited", resetAt })]);
    await signedIn(provider);

    await build();
    await settled();

    expect(await becomes("waiting-for-limit")).toEqual({
      kind: "waiting-for-limit",
      since: at(now),
      resetAt,
    });
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
    await expect.poll(() => told.length).toBe(2);

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
