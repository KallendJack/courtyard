import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  ApiError,
  GitHubConnection,
  LiveStatus,
  type LiveUpdateResult,
  SessionSummary,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FoundCheckRun } from "../src/integrations/github/api.ts";
import { createFakeProvider, type Provider } from "../src/providers/index.ts";
import type { UpdateCommand } from "../src/worker.ts";
import {
  asOwner,
  CODING_MODEL,
  codeRepo,
  codeWorkspace,
  codingProvider,
  createFakeGitHub,
  errorOf,
  FAKE_MODEL,
  type FakeGitHub,
  followSession,
  gatedProvider,
  postJson,
  type Requester,
  removeTestFolder,
  requesterFor,
  sendJson,
  setUpOwner,
  startSession,
  testWorker,
} from "./testing.ts";

// Updating the live copy from the app (ADR 0011, #35), against real git in temporary folders: a
// remote standing in for GitHub, and a live copy cloned from it.

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) =>
  run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd });

const SECONDS = 1000;
const MINUTES = 60 * SECONDS;

let root: string;
let remote: string;
let pusher: string;
let liveCopy: string;
let dataDir: string;
let now: number;
let started: UpdateCommand[];

/** A new commit on the remote's main, as if a PR had just been merged. Returns its commit. */
const merge = async (title: string) => {
  await writeFile(join(pusher, "notes.md"), `${title}\n`);
  await git(pusher, "commit", "-qam", title);
  await git(pusher, "push", "-q", "origin", "main");
  return (await git(pusher, "rev-parse", "HEAD")).stdout.trim();
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  remote = join(root, "remote.git");
  pusher = join(root, "pusher");
  liveCopy = join(root, "live");
  dataDir = join(root, "data");
  await mkdir(join(root, "context"));
  await run("git", ["init", "-q", "--bare", "-b", "main", remote]);
  await run("git", ["clone", "-q", remote, pusher]);
  await writeFile(join(pusher, "notes.md"), "First\n");
  await git(pusher, "add", ".");
  await git(pusher, "commit", "-qm", "First version");
  await git(pusher, "push", "-q", "origin", "main");
  await run("git", ["clone", "-q", remote, liveCopy]);
  now = Date.parse("2026-10-06T12:00:00Z");
  started = [];
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** A worker running from the live copy, or from nowhere in particular with `live: false`. */
const workerFor = async (options: { live: boolean } = { live: true }): Promise<Requester> => {
  const app = testWorker({
    root,
    env: options.live ? { COURTYARD_LIVE_COPY: liveCopy } : {},
    now: () => now,
    startUpdate: (command) => {
      started.push(command);
    },
  });
  return asOwner(app);
};

const statusOf = async (request: Requester) => {
  const response = await request("/api/live");
  expect(response.status).toBe(200);
  return LiveStatus.parse(await response.json());
};

const startUpdate = (request: Requester) =>
  request("/api/live/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

/** What update.ps1 writes when it finishes (or starts, with "running"). */
const lastUpdateIs = async (result: Partial<LiveUpdateResult>) => {
  const version = { commit: "a".repeat(40), title: "aaaaaaa First version" };
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    join(dataDir, "live-update.json"),
    JSON.stringify({
      outcome: "updated",
      from: version,
      to: version,
      message: "Updated.",
      // As Windows PowerShell writes them: seven decimal places.
      startedAt: "2026-10-06T11:58:00.1234567Z",
      finishedAt: "2026-10-06T11:59:00.1234567Z",
      ...result,
    }),
  );
};

describe("a worker that isn't a live copy", () => {
  it("says updates from the app are off, and refuses to start one", async () => {
    const request = await workerFor({ live: false });

    expect(await statusOf(request)).toEqual({ kind: "off" });
    const response = await startUpdate(request);
    expect(response.status).toBe(404);
    expect(ApiError.safeParse(await response.json()).success).toBe(true);
    expect(started).toEqual([]);
  });
});

describe("what the live copy runs, and whether main is newer", () => {
  it("says main is newer once a PR is merged", async () => {
    const newest = await merge("Add the Update button");
    const request = await workerFor();

    const status = await statusOf(request);

    expect(status).toMatchObject({
      kind: "live",
      running: { title: expect.stringMatching(/^[0-9a-f]{7} First version$/) },
      newest: { commit: newest, title: expect.stringMatching(/ Add the Update button$/) },
      newerOnMain: true,
      lastUpdate: null,
    });
  });

  it("names a merge commit by the title of the pull request it merged (#335)", async () => {
    await writeFile(join(pusher, "notes.md"), "Update button\n");
    await git(
      pusher,
      "commit",
      "-qa",
      "-m",
      "Merge pull request #35 from octo-owner/35-update-button",
      "-m",
      "Add the Update button",
    );
    await git(pusher, "push", "-q", "origin", "main");
    const request = await workerFor();

    const status = await statusOf(request);

    expect(status).toMatchObject({
      newest: { title: expect.stringMatching(/^[0-9a-f]{7} Add the Update button$/) },
    });
  });

  it("says when it's already on the newest main", async () => {
    const request = await workerFor();

    const status = await statusOf(request);

    expect(status).toMatchObject({ kind: "live", newerOnMain: false });
    if (status.kind === "live") expect(status.newest?.commit).toBe(status.running.commit);
  });

  it("sees a merge the next time a page asks, a couple of minutes later", async () => {
    const request = await workerFor();
    await statusOf(request);
    await merge("A later change");

    now += 2 * MINUTES;
    const later = await statusOf(request);

    expect(later).toMatchObject({ newerOnMain: true });
  });

  it("asks the remote once for pages asking within the same minute", async () => {
    const request = await workerFor();
    await statusOf(request);
    await merge("A later change");

    now += 30 * SECONDS;
    const soon = await statusOf(request);

    expect(soon).toMatchObject({ newerOnMain: false });
  });

  it("still says what's running when the remote can't be reached", async () => {
    await git(liveCopy, "remote", "set-url", "origin", join(root, "nowhere.git"));
    const request = await workerFor();

    expect(await statusOf(request)).toMatchObject({
      kind: "live",
      newest: null,
      newerOnMain: false,
    });
  });
});

describe("updating from the app", () => {
  it("starts the update task, which carries on while the worker shuts down", async () => {
    await merge("Add the Update button");
    const request = await workerFor();

    const response = await startUpdate(request);

    expect(response.status).toBe(202);
    expect(started).toEqual([{ task: "Courtyard update" }]);
  });

  it("reads back how the last update went", async () => {
    await lastUpdateIs({ outcome: "failed", message: "Building failed (exit code 1)." });
    const request = await workerFor();

    expect(await statusOf(request)).toMatchObject({
      lastUpdate: { outcome: "failed", message: "Building failed (exit code 1)." },
    });
  });

  it("won't start a second update while one is running", async () => {
    await lastUpdateIs({ outcome: "running", startedAt: "2026-10-06T11:58:00Z", finishedAt: null });
    const request = await workerFor();

    const response = await startUpdate(request);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/already/i);
    expect(started).toEqual([]);
  });

  it("treats an update that's said 'running' for too long as failed, and lets another start", async () => {
    await lastUpdateIs({ outcome: "running", startedAt: "2026-10-06T11:00:00Z", finishedAt: null });
    const request = await workerFor();

    expect(await statusOf(request)).toMatchObject({
      lastUpdate: {
        outcome: "failed",
        message: expect.stringMatching(/live-update\.log/),
        // Finished, so the page shows how it went rather than waiting on it.
        finishedAt: "2026-10-06T11:35:00.000Z",
      },
    });
    expect((await startUpdate(request)).status).toBe(202);
  });
});

describe("a result file that can't be read", () => {
  it("counts as no last update, and doesn't stop an update", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, "live-update.json"), '{ "outcome": "upd');
    const request = await workerFor();

    expect(await statusOf(request)).toMatchObject({ kind: "live", lastUpdate: null });
    expect((await startUpdate(request)).status).toBe(202);
  });
});

describe("main's build (#249)", () => {
  /** The live copy's repository on GitHub, as its remote names it. */
  const ON_GITHUB = "https://github.com/octo-owner/courtyard.git";
  let github: FakeGitHub;
  let request: Requester;

  /** A job of CI on a commit, as GitHub's check runs give it. */
  const job = (
    id: number,
    name: string,
    outcome: FoundCheckRun["outcome"],
    times: { started?: string; completed?: string } = {},
  ): FoundCheckRun => ({
    id,
    name,
    outcome,
    url: `https://github.com/octo-owner/courtyard/actions/runs/1/job/${id}`,
    startedAt: times.started ?? "2026-10-06T11:58:00Z",
    completedAt: outcome === "running" ? null : (times.completed ?? "2026-10-06T12:01:00Z"),
  });
  const jobsOf = (outcomes: readonly FoundCheckRun["outcome"][]) =>
    ["Checks", "Unit tests", "E2E 1/4", "E2E 2/4", "E2E 3/4", "E2E 4/4"].map((name, i) =>
      job(10 + i, name, outcomes[i] ?? "passed"),
    );

  beforeEach(async () => {
    // Its remote is named by its address on GitHub, as the real live copy's is, while git
    // reaches the remote on disk in its place.
    await git(liveCopy, "remote", "set-url", "origin", ON_GITHUB);
    await git(liveCopy, "config", `url.${remote.replaceAll("\\", "/")}.insteadOf`, ON_GITHUB);
    github = createFakeGitHub();
    request = await asOwner(
      testWorker({
        root,
        env: { COURTYARD_LIVE_COPY: liveCopy },
        now: () => now,
        startUpdate: (command) => {
          started.push(command);
        },
        github: github.api,
      }),
    );
    await postJson(request, "/api/github/sign-in", {});
    github.approve();
    await expect
      .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
      .toBe("signed-in");
  });

  /** Main's build, as the live status gives it. */
  const buildOf = async () => {
    const status = await statusOf(request);
    return status.kind === "live" ? status.build : undefined;
  };
  /** Each stage's jobs, by name and how they're going. */
  const stagesOf = async () =>
    (await buildOf())?.stages.map((stage) => stage.map((each) => [each.name, each.outcome]));

  it("with no workflow to go by, shows each job in one stage, in the order GitHub made them", async () => {
    const newest = await merge("Rail and Talk key");
    github.setCommitChecks(newest, [
      job(13, "E2E 2/4", "running", { started: "2026-10-06T11:59:00Z" }),
      job(11, "Unit tests", "running", { started: "2026-10-06T11:59:00Z" }),
      job(10, "Checks", "passed", { started: "2026-10-06T11:59:00Z" }),
      job(12, "E2E 1/4", "running", { started: "2026-10-06T11:59:00Z" }),
    ]);

    expect(await buildOf()).toMatchObject({
      kind: "running",
      startedAt: "2026-10-06T11:59:00.000Z",
    });
    expect(await stagesOf()).toEqual([
      [
        ["Checks", "passed"],
        ["Unit tests", "running"],
        ["E2E 1/4", "running"],
        ["E2E 2/4", "running"],
      ],
    ]);
  });

  it("says it passed, and when, so Update can be offered", async () => {
    const newest = await merge("Rail and Talk key");
    github.setCommitChecks(newest, jobsOf([]));

    expect(await buildOf()).toMatchObject({
      kind: "passed",
      startedAt: "2026-10-06T11:58:00.000Z",
      completedAt: "2026-10-06T12:01:00.000Z",
    });
    expect((await stagesOf())?.flat()).toHaveLength(6);
  });

  it("says which job failed, and where its log is", async () => {
    const newest = await merge("Rail and Talk key");
    github.setCommitChecks(newest, jobsOf(["passed", "failed", "passed", "failed"]));

    expect(await buildOf()).toMatchObject({
      kind: "failed",
      details: "https://github.com/octo-owner/courtyard/actions/runs/1/job/11",
    });
    expect((await stagesOf())?.flat()).toContainEqual(["Unit tests", "failed"]);
  });

  it("shows only the latest try of a job that was run again", async () => {
    const newest = await merge("Rail and Talk key");
    github.setCommitChecks(newest, [
      ...jobsOf(["passed", "failed"]),
      job(20, "Unit tests", "passed"),
    ]);

    expect(await buildOf()).toMatchObject({ kind: "passed" });
    expect((await stagesOf())?.flat().map(([name]) => name)).toEqual([
      "Checks",
      "Unit tests",
      "E2E 1/4",
      "E2E 2/4",
      "E2E 3/4",
      "E2E 4/4",
    ]);
  });

  describe("in stages, from the workflow's own order (#337)", () => {
    /** A workflow where a preview waits on lint and build, and the browser tests on the preview. */
    const DEPLOY = [
      "name: Deploy",
      "on: push",
      "jobs:",
      "  lint:",
      "    name: Lint",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: pnpm lint # needs: nothing",
      "  build:",
      "    name: 'Build'",
      "    steps:",
      "      - run: |",
      "          echo needs: [lint]",
      "  preview:",
      "    name: Deploy preview",
      "    needs: [lint, build]",
      "  e2e:",
      '    name: "E2E"',
      "    needs:",
      "      - preview",
      "",
    ].join("\n");

    it("puts a job after the jobs it needs, and one that hasn't started yet waits", async () => {
      const newest = await merge("New gallery page");
      github.setWorkflows(newest, [{ path: ".github/workflows/deploy.yml", text: DEPLOY }]);
      // GitHub lists them in any order: the stages keep the workflow's.
      github.setCommitChecks(newest, [
        job(3, "Deploy preview", "running", { started: "2026-10-06T11:59:00Z" }),
        job(2, "Build", "passed"),
        job(1, "Lint", "passed"),
      ]);

      const status = await statusOf(request);

      expect(status.kind === "live" && status.build).toMatchObject({
        kind: "running",
        stages: [
          [
            { name: "Lint", outcome: "passed", needs: [] },
            { name: "Build", outcome: "passed", needs: [] },
          ],
          [{ name: "Deploy preview", outcome: "running", needs: ["Lint", "Build"] }],
          [{ name: "E2E", outcome: "waiting", needs: ["Deploy preview"], startedAt: null }],
        ],
      });
    });

    /** Courtyard's own CI: three jobs side by side, the browser tests in four shards. */
    const CI = [
      "name: CI",
      "jobs:",
      "  checks:",
      "    name: Checks",
      "    runs-on: ubuntu-latest",
      "  unit:",
      "    name: Unit tests",
      "  e2e:",
      `    name: E2E \${{ matrix.shard }}/4`,
      "    strategy:",
      "      fail-fast: false",
      "      matrix:",
      "        shard: [1, 2, 3, 4]",
      "",
    ].join("\n");
    const ciOn = (commit: string, workflow: { done?: boolean; startedAt?: string } = {}) =>
      github.setWorkflows(commit, [{ path: ".github/workflows/ci.yml", text: CI, ...workflow }]);

    /** Main's build before the newest, which passed: Checks 1 min, Unit tests 2, E2E 3. */
    const passedBefore = async (started: string) => {
      const before = await merge("The build before");
      const at = (minutes: number) =>
        new Date(Date.parse(started) + minutes * MINUTES).toISOString();
      github.setCommitChecks(before, [
        job(1, "Checks", "passed", { started, completed: at(1) }),
        job(2, "Unit tests", "passed", { started, completed: at(2) }),
        ...[1, 2, 3, 4].map((shard) =>
          job(2 + shard, `E2E ${shard}/4`, "passed", { started, completed: at(3) }),
        ),
      ]);
      return before;
    };

    it("with no job needing another, has one stage, a matrix's runs folded with their count", async () => {
      const newest = await merge("Rail and Talk key");
      ciOn(newest, { startedAt: "2026-10-06T11:58:30Z" });
      github.setCommitChecks(newest, [
        job(13, "E2E 2/4", "running"),
        job(11, "Unit tests", "running"),
        job(10, "Checks", "passed"),
        job(12, "E2E 1/4", "passed"),
        job(14, "E2E 3/4", "running"),
        job(15, "E2E 4/4", "running"),
      ]);

      expect(await buildOf()).toMatchObject({
        kind: "running",
        // Its latest try, as its workflow says.
        startedAt: "2026-10-06T11:58:30.000Z",
        stages: [
          [
            { name: "Checks", outcome: "passed", shards: null, needs: [] },
            { name: "Unit tests", outcome: "running", shards: null },
            { name: "E2E", outcome: "running", shards: { done: 1, total: 4 } },
          ],
        ],
      });
    });

    it("judges when it should end from how long each job usually takes, whatever ran again later", async () => {
      const before = await merge("The build before");
      // A shard of the build before, run again twenty minutes later: still three minutes long.
      github.setCommitChecks(before, [
        job(1, "Checks", "passed", {
          started: "2026-10-06T11:00:00Z",
          completed: "2026-10-06T11:01:00Z",
        }),
        job(2, "Unit tests", "passed", {
          started: "2026-10-06T11:00:00Z",
          completed: "2026-10-06T11:02:00Z",
        }),
        ...[1, 2, 3, 4].map((shard) =>
          job(2 + shard, `E2E ${shard}/4`, shard === 4 ? "failed" : "passed", {
            started: "2026-10-06T11:00:00Z",
            completed: "2026-10-06T11:03:00Z",
          }),
        ),
        job(9, "E2E 4/4", "passed", {
          started: "2026-10-06T11:23:00Z",
          completed: "2026-10-06T11:26:00Z",
        }),
      ]);
      const newest = await merge("Rail and Talk key");
      ciOn(newest);
      github.setCommitChecks(newest, [
        job(10, "Checks", "running", { started: "2026-10-06T11:59:00Z" }),
        job(11, "Unit tests", "running", { started: "2026-10-06T11:59:00Z" }),
        ...[1, 2, 3, 4].map((shard) =>
          job(11 + shard, `E2E ${shard}/4`, "running", { started: "2026-10-06T11:59:00Z" }),
        ),
      ]);

      // Started at 11:59, and the browser tests usually take three minutes.
      expect(await buildOf()).toMatchObject({
        kind: "running",
        endsAround: "2026-10-06T12:02:00.000Z",
      });
    });

    it("is nearly done once its jobs have run longer than they usually do, never later", async () => {
      await passedBefore("2026-10-06T11:00:00Z");
      const newest = await merge("Rail and Talk key");
      ciOn(newest);
      const times = { started: "2026-10-06T11:50:00Z", completed: "2026-10-06T11:53:00Z" };
      github.setCommitChecks(newest, [
        job(10, "Checks", "passed", times),
        job(11, "Unit tests", "passed", times),
        ...[1, 2, 3, 4].map((shard) =>
          job(11 + shard, `E2E ${shard}/4`, shard === 1 ? "running" : "passed", times),
        ),
      ]);

      // Ten minutes in, where the browser tests usually take three.
      const build = await buildOf();
      expect(build).toMatchObject({ kind: "running" });
      const endsAround = build?.kind === "running" ? build.endsAround : null;
      expect(Date.parse(endsAround ?? "")).toBeLessThanOrEqual(now);
    });

    it("waits for a job that hasn't started, until its workflow has finished without it", async () => {
      const newest = await merge("New gallery page");
      github.setWorkflows(newest, [
        { path: ".github/workflows/deploy.yml", text: DEPLOY, done: true },
      ]);
      github.setCommitChecks(newest, [
        job(1, "Lint", "passed"),
        job(2, "Build", "failed"),
        job(3, "Deploy preview", "other"),
      ]);

      expect(await stagesOf()).toEqual([
        [
          ["Lint", "passed"],
          ["Build", "failed"],
        ],
        [["Deploy preview", "other"]],
        [["E2E", "other"]],
      ]);
    });
  });

  it("asks GitHub nothing about builds while the live copy is on main's newest", async () => {
    const status = await statusOf(request);

    expect(status).toMatchObject({ newerOnMain: false, build: null });
    expect(github.commitChecksAsked()).toBe(0);
  });

  it("asks again every few seconds while it runs, and less once it has finished", async () => {
    const newest = await merge("Rail and Talk key");
    github.setCommitChecks(newest, jobsOf(["running"]));
    expect(await statusOf(request)).toMatchObject({ build: { kind: "running" } });

    github.setCommitChecks(newest, jobsOf([]));
    now += 5 * SECONDS;
    expect(await statusOf(request)).toMatchObject({ build: { kind: "running" } });
    now += 10 * SECONDS;
    expect(await statusOf(request)).toMatchObject({ build: { kind: "passed" } });

    const asked = github.commitChecksAsked();
    now += 30 * SECONDS;
    await statusOf(request);
    expect(github.commitChecksAsked()).toBe(asked);
  });

  it("has no build when no one is signed in to GitHub, so Update is offered as before", async () => {
    await merge("Rail and Talk key");
    await postJson(request, "/api/github/sign-out", {});

    expect(await statusOf(request)).toMatchObject({ newerOnMain: true, build: null });
  });
});

describe("asking the remote", () => {
  it("waits five minutes before asking again after it couldn't reach the remote", async () => {
    const reachable = (await git(liveCopy, "remote", "get-url", "origin")).stdout.trim();
    await git(liveCopy, "remote", "set-url", "origin", join(root, "nowhere.git"));
    const request = await workerFor();
    expect(await statusOf(request)).toMatchObject({ newest: null });
    await git(liveCopy, "remote", "set-url", "origin", reachable);
    await merge("A change made while it couldn't reach the remote");

    now += 2 * MINUTES;
    expect(await statusOf(request)).toMatchObject({ newest: null });
    now += 4 * MINUTES;
    expect(await statusOf(request)).toMatchObject({ newerOnMain: true });
  });

  it("asks once for pages loading at the same time", async () => {
    await merge("Add the Update button");
    const request = await workerFor();

    const statuses = await Promise.all([statusOf(request), statusOf(request), statusOf(request)]);

    for (const status of statuses) expect(status).toMatchObject({ newerOnMain: true });
  });
});

describe("Update when ready (#186)", () => {
  const ON_GITHUB = "https://github.com/octo-owner/courtyard.git";
  const DETAILS = "https://github.com/octo-owner/courtyard/actions/runs/1/job/11";
  let github: FakeGitHub;
  let cookie: string | undefined;
  /** The worker's repeating job that runs a waiting Update, run when a test wants it. */
  let watchUpdate: () => Promise<void>;
  let newest: string;

  /** CI on main's newest, as GitHub's check runs give it: Checks passed, Unit tests `outcome`. */
  const ciIs = (outcome: FoundCheckRun["outcome"]) =>
    github.setCommitChecks(newest, [
      {
        id: 10,
        name: "Checks",
        outcome: "passed",
        url: "https://github.com/octo-owner/courtyard/actions/runs/1/job/10",
        startedAt: "2026-10-06T11:58:00Z",
        completedAt: "2026-10-06T11:59:00Z",
      },
      {
        id: 11,
        name: "Unit tests",
        outcome,
        url: DETAILS,
        startedAt: "2026-10-06T11:58:00Z",
        completedAt: outcome === "running" ? null : "2026-10-06T12:01:00Z",
      },
    ]);

  /** A worker on the live copy, signed in to GitHub; a second call is a restart. */
  const start = async (providers: Provider[] = [createFakeProvider({ delayMs: 0 })]) => {
    const app = testWorker({
      root,
      env: { COURTYARD_LIVE_COPY: liveCopy },
      now: () => now,
      startUpdate: (command) => {
        started.push(command);
      },
      github: github.api,
      providers,
      // Only the waiting Update's job, every 10 seconds; the test runs it when it wants.
      repeat: (everyMs, job) => {
        if (everyMs === 10 * SECONDS) watchUpdate = job;
      },
    });
    const first = cookie === undefined;
    cookie ??= await setUpOwner(app);
    const request = requesterFor(app, cookie);
    if (first) {
      await postJson(request, "/api/github/sign-in", {});
      github.approve();
      await expect
        .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
        .toBe("signed-in");
    }
    return request;
  };

  const waitingOf = async (request: Requester) => {
    const status = await statusOf(request);
    return status.kind === "live" ? status.waiting : undefined;
  };
  /** Moves the clock past how long an answer about a running build is reused. */
  const later = () => {
    now += 10 * SECONDS;
  };
  const cancel = (request: Requester) => sendJson(request, "/api/live/update", "DELETE", {});

  beforeEach(async () => {
    await git(liveCopy, "remote", "set-url", "origin", ON_GITHUB);
    await git(liveCopy, "config", `url.${remote.replaceAll("\\", "/")}.insteadOf`, ON_GITHUB);
    await mkdir(join(root, "context", "garage-gym"), { recursive: true });
    github = createFakeGitHub();
    cookie = undefined;
    newest = await merge("Rail and Talk key");
  });

  it("tapped while main's build runs, waits for it, then updates by itself once it passes", async () => {
    ciIs("running");
    const request = await start();

    const tapped = await startUpdate(request);

    expect(tapped.status).toBe(202);
    expect(started).toEqual([]);
    expect(await waitingOf(request)).toEqual({ kind: "ci" });
    ciIs("passed");
    later();
    await watchUpdate();
    expect(started).toEqual([{ task: "Courtyard update" }]);
    expect(await waitingOf(request)).toBeNull();
  });

  it("waits for each session mid-turn to finish, saying how many", async () => {
    ciIs("passed");
    const gated = gatedProvider();
    const request = await start([gated.provider]);
    const session = await startSession(request, "Build the quick questions");
    await gated.held;

    await startUpdate(request);
    await watchUpdate();

    expect(started).toEqual([]);
    expect(await waitingOf(request)).toEqual({
      kind: "sessions",
      count: 1,
      needYou: 0,
      open: null,
    });
    gated.release();
    await followSession(request, { sessionId: session.id, until: "turn-completed" });
    await watchUpdate();
    expect(started).toHaveLength(1);
  });

  it("counts a session waiting on the owner's OK as busy, and names it", async () => {
    ciIs("passed");
    const { repo } = await codeRepo(root);
    await codeWorkspace(root, "side-project", repo);
    const request = await start([codingProvider([{ run: "pnpm add left-pad" }]).provider]);
    const asked = await postJson(request, "/api/workspaces/side-project/sessions", {
      text: "Add left-pad",
      model: CODING_MODEL,
    });
    const { id } = SessionSummary.parse(await asked.json());
    await followSession(request, { sessionId: id, until: "approval-requested" });

    await startUpdate(request);

    expect(await waitingOf(request)).toEqual({
      kind: "sessions",
      count: 1,
      needYou: 1,
      open: { workspaceId: "side-project", sessionId: id },
    });
    await postJson(request, `/api/sessions/${id}/stop`, { turn: 1 });
    await followSession(request, { sessionId: id, until: "turn-stopped" });
  });

  it("runs at once with Update now, and the turns it cuts off carry on by themselves", async () => {
    ciIs("running");
    const gated = gatedProvider();
    const request = await start([gated.provider]);
    const session = await startSession(request, "Build the quick questions");
    await gated.held;

    const now = await postJson(request, "/api/live/update", { now: true });
    expect(now.status).toBe(202);
    expect(started).toHaveLength(1);

    // The update restarts the worker.
    const restarted = await start();
    const events = await followSession(restarted, {
      sessionId: session.id,
      until: "turn-completed",
    });
    expect(events.flatMap((event) => (event.type === "text-delta" ? [] : [event.type]))).toEqual([
      "owner-message",
      "turn-failed",
      "owner-message",
      "turn-completed",
    ]);
    expect(events[2]).toMatchObject({ continues: { turn: 1 } });
    gated.release();
  });

  it("is kept across a crash, and Cancel drops it", async () => {
    ciIs("running");
    await startUpdate(await start());

    const restarted = await start();
    expect(await waitingOf(restarted)).toEqual({ kind: "ci" });
    expect((await cancel(restarted)).status).toBe(204);
    expect(await waitingOf(restarted)).toBeNull();
    ciIs("passed");
    later();
    await watchUpdate();
    expect(started).toEqual([]);
  });

  it("cancelled while main's build is being read, stays cancelled and nothing throws (#586)", async () => {
    ciIs("running");
    // GitHub answers about main's build only when the test lets it, the next time it's asked.
    let reading: () => void = () => {};
    const asked = new Promise<void>((resolve) => {
      reading = resolve;
    });
    let answer: () => void = () => {};
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    let slow = false;
    const real = github.api;
    github = {
      ...github,
      api: {
        ...real,
        commitChecks: async (...args) => {
          if (slow) {
            reading();
            await answered;
          }
          return real.commitChecks(...args);
        },
      },
    };
    const request = await start();
    await startUpdate(request);

    slow = true;
    ciIs("passed");
    later();
    const watched = watchUpdate();
    await asked;
    expect((await cancel(request)).status).toBe(204);
    answer();

    await expect(watched).resolves.toBeUndefined();
    expect(started).toEqual([]);
    expect(await waitingOf(request)).toBeNull();
  });

  it("is dropped when main's build fails while it waits, saying so with the log", async () => {
    ciIs("running");
    const request = await start();
    await startUpdate(request);

    ciIs("failed");
    later();
    await watchUpdate();

    expect(await waitingOf(request)).toEqual({ kind: "dropped", details: DETAILS });
    expect(started).toEqual([]);
    // Main moves on: nothing more to say.
    newest = await merge("Fix the unit tests");
    ciIs("running");
    now += 2 * MINUTES;
    await watchUpdate();
    expect(await waitingOf(request)).toBeNull();
  });

  it("while it waits, queued messages hold and the owner's own still start, until it's cancelled", async () => {
    ciIs("running");
    const gated = gatedProvider();
    const request = await start([gated.provider, createFakeProvider({ delayMs: 0, second: true })]);
    const session = await startSession(request, "Build the quick questions");
    await gated.held;
    await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "Then the tests",
      model: FAKE_MODEL,
    });
    await startUpdate(request);

    gated.release();
    await followSession(request, { sessionId: session.id, until: "turn-completed" });
    const own = await startSession(request, "Something else", {
      provider: "fake-two",
      model: "echo",
    });
    await followSession(request, { sessionId: own.id, until: "turn-completed" });
    const log = await readFile(join(dataDir, "sessions", session.id, "events.jsonl"), "utf8");
    expect(log).not.toContain('"queued":');

    await cancel(request);
    const sent = await followSession(request, {
      sessionId: session.id,
      until: (event) => event.type === "owner-message" && event.queued !== undefined,
    });
    expect(sent.at(-1)).toMatchObject({ text: "Then the tests" });
    await followSession(request, {
      sessionId: session.id,
      until: (event) => event.type === "turn-completed" && event.seq > 4,
    });
  });
});
