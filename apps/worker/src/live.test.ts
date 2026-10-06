import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ApiError, LiveStatus, type LiveUpdateResult } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asOwner, errorOf, type Requester, testWorker } from "./testing.ts";
import type { UpdateCommand } from "./worker.ts";

// Updating the live copy from the app (ADR 0011, #35), against real git in temporary folders: a
// remote standing in for GitHub, and a live copy cloned from it.

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) =>
  run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd });

const HOURS = 60 * 60 * 1000;

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
  await rm(root, { recursive: true, force: true });
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

  it("asks the remote at most every few hours", async () => {
    const request = await workerFor();
    await statusOf(request);
    await merge("A later change");

    const soon = await statusOf(request);
    now += 3 * HOURS;
    const later = await statusOf(request);

    expect(soon).toMatchObject({ newerOnMain: false });
    expect(later).toMatchObject({ newerOnMain: true });
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

describe("asking the remote", () => {
  it("asks again soon after it couldn't reach the remote, rather than in hours", async () => {
    const reachable = (await git(liveCopy, "remote", "get-url", "origin")).stdout.trim();
    await git(liveCopy, "remote", "set-url", "origin", join(root, "nowhere.git"));
    const request = await workerFor();
    expect(await statusOf(request)).toMatchObject({ newest: null });
    await git(liveCopy, "remote", "set-url", "origin", reachable);
    await merge("A change made while it couldn't reach the remote");

    now += 6 * 60 * 1000;

    expect(await statusOf(request)).toMatchObject({ newerOnMain: true });
  });

  it("asks once for pages loading at the same time", async () => {
    await merge("Add the Update button");
    const request = await workerFor();

    const statuses = await Promise.all([statusOf(request), statusOf(request), statusOf(request)]);

    for (const status of statuses) expect(status).toMatchObject({ newerOnMain: true });
  });
});
