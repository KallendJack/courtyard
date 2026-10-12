import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ApiError, GitHubConnection, LiveStatus, type LiveUpdateResult } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FoundCheckRun } from "./github/api.ts";
import {
  asOwner,
  createFakeGitHub,
  errorOf,
  type FakeGitHub,
  postJson,
  type Requester,
  removeTestFolder,
  testWorker,
} from "./testing.ts";
import type { UpdateCommand } from "./worker.ts";

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

  it("shows main's newest build running, each job in the order the workflow starts them", async () => {
    const before = await merge("The build before");
    github.setCommitChecks(before, [
      job(1, "Checks", "passed", {
        started: "2026-10-06T11:00:00Z",
        completed: "2026-10-06T11:01:00Z",
      }),
      job(2, "E2E 1/4", "passed", {
        started: "2026-10-06T11:00:00Z",
        completed: "2026-10-06T11:03:00Z",
      }),
    ]);
    const newest = await merge("Rail and Talk key");
    // GitHub lists them in any order: the bar keeps the workflow's.
    github.setCommitChecks(newest, [
      job(13, "E2E 2/4", "running", { started: "2026-10-06T11:59:00Z" }),
      job(11, "Unit tests", "running", { started: "2026-10-06T11:59:00Z" }),
      job(10, "Checks", "passed", { started: "2026-10-06T11:59:00Z" }),
      job(12, "E2E 1/4", "running", { started: "2026-10-06T11:59:00Z" }),
    ]);

    expect(await statusOf(request)).toMatchObject({
      newerOnMain: true,
      build: {
        kind: "running",
        jobs: [
          { name: "Checks", outcome: "passed" },
          { name: "Unit tests", outcome: "running" },
          { name: "E2E 1/4", outcome: "running" },
          { name: "E2E 2/4", outcome: "running" },
        ],
        // Started at 11:59, and the build before took 3 minutes.
        endsAround: "2026-10-06T12:02:00.000Z",
      },
    });
  });

  it("says it passed, so Update can be offered", async () => {
    const newest = await merge("Rail and Talk key");
    github.setCommitChecks(newest, jobsOf([]));

    const status = await statusOf(request);

    expect(status).toMatchObject({ newerOnMain: true, build: { kind: "passed" } });
    if (status.kind === "live") expect(status.build?.jobs).toHaveLength(6);
  });

  it("says which job failed, and where its log is", async () => {
    const newest = await merge("Rail and Talk key");
    github.setCommitChecks(newest, jobsOf(["passed", "failed", "passed", "failed"]));

    expect(await statusOf(request)).toMatchObject({
      build: {
        kind: "failed",
        details: "https://github.com/octo-owner/courtyard/actions/runs/1/job/11",
        jobs: expect.arrayContaining([{ name: "Unit tests", outcome: "failed" }]),
      },
    });
  });

  it("shows only the latest try of a job that was run again", async () => {
    const newest = await merge("Rail and Talk key");
    github.setCommitChecks(newest, [
      ...jobsOf(["passed", "failed"]),
      job(20, "Unit tests", "passed"),
    ]);

    const status = await statusOf(request);

    expect(status).toMatchObject({ build: { kind: "passed" } });
    if (status.kind === "live") {
      expect(status.build?.jobs.map((each) => each.name)).toEqual([
        "Checks",
        "Unit tests",
        "E2E 1/4",
        "E2E 2/4",
        "E2E 3/4",
        "E2E 4/4",
      ]);
    }
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
