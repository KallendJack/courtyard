import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ContextBackup } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asOwner, postJson, type Requester, testWorker } from "./testing.ts";

const run = promisify(execFile);

/** Git in `folder`, for looking at what the worker did. */
const gitIn = async (folder: string, ...args: string[]) =>
  (await run("git", args, { cwd: folder })).stdout.trim();

/** The context folder's commits, newest first: each one's title and trailers. */
const changes = async () => {
  const log = await gitIn(contextDir, "log", "--format=%s%x1f%b%x1e");
  return log
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const [title = "", body = ""] = entry.split("\x1f");
      return { title, trailers: body.split("\n").filter((line) => line.trim() !== "") };
    });
};

const backup = async () => {
  const response = await request("/api/backup");
  expect(response.status).toBe(200);
  return ContextBackup.parse(await response.json());
};

let root: string;
let contextDir: string;
let request: Requester;
/** The job the worker asked to have run at start and every so often. */
let keepUp: () => Promise<void>;

const startWorker = async (env: Record<string, string> = {}) => {
  request = await asOwner(
    testWorker({
      root,
      env,
      repeat: (_everyMs, job) => {
        keepUp = job;
      },
    }),
  );
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(contextDir);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the context folder's repository", () => {
  it("is set up by the worker, with whatever was there in its first change", async () => {
    await mkdir(join(contextDir, "garage-gym"));
    await writeFile(join(contextDir, "garage-gym", "CONTEXT.md"), "# Garage gym\n");
    await startWorker();

    await keepUp();

    expect(await gitIn(contextDir, "log", "--format=%s%n%b")).toContain("Courtyard-Change: setup");
    expect(await gitIn(contextDir, "ls-files")).toBe("garage-gym/CONTEXT.md");
    expect(await gitIn(contextDir, "log", "-1", "--format=%an")).toBe("Courtyard");
  });

  it("gets one change for each change made in the app, saying what and where", async () => {
    await startWorker();

    await postJson(request, "/api/workspaces", { name: "Garage gym" });
    await postJson(request, "/api/workspaces/garage-gym/archive", {});
    await postJson(request, "/api/owner-context", {});

    expect(await changes()).toEqual([
      {
        title: "Start the owner context",
        trailers: ["Courtyard-Change: owner-context", "Courtyard-Place: owner-context"],
      },
      {
        title: "Archive the workspace garage-gym",
        trailers: ["Courtyard-Change: workspace", "Courtyard-Place: workspace/garage-gym"],
      },
      {
        title: "New workspace: Garage gym",
        trailers: ["Courtyard-Change: workspace", "Courtyard-Place: workspace/garage-gym"],
      },
      { title: "Start keeping the context folder in git", trailers: ["Courtyard-Change: setup"] },
    ]);
    expect(await gitIn(contextDir, "status", "--porcelain")).toBe("");
  });

  it("commits the owner's own edits as a change of their own, before the next change", async () => {
    await startWorker();
    await postJson(request, "/api/workspaces", { name: "Garage gym" });
    await writeFile(join(contextDir, "garage-gym", "CONTEXT.md"), "# Garage gym\n\n## Facts\n");
    await writeFile(join(contextDir, "OWNER.md"), "# Owner context\n");

    await request("/api/workspaces/garage-gym", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Home gym" }),
    });

    const [renamed, handEdit] = await changes();
    expect(renamed?.title).toBe("Change the workspace Home gym");
    expect(handEdit).toEqual({
      title: "Edited by hand",
      trailers: [
        "Courtyard-Change: hand-edit",
        "Courtyard-Place: owner-context",
        "Courtyard-Place: workspace/garage-gym",
      ],
    });
    expect(await gitIn(contextDir, "show", "--name-only", "--format=", "HEAD")).toBe(
      "garage-gym/workspace.json",
    );
  });

  it("commits the owner's own edits when it keeps up, with no change from the app", async () => {
    await startWorker();
    await keepUp();
    await writeFile(join(contextDir, "OWNER.md"), "# Owner context\n");

    await keepUp();

    expect((await changes())[0]?.title).toBe("Edited by hand");
    expect(await gitIn(contextDir, "status", "--porcelain")).toBe("");
  });

  it("commits two changes asked for at once, one after the other", async () => {
    await startWorker();

    const answers = await Promise.all([
      postJson(request, "/api/workspaces", { name: "Garage gym" }),
      postJson(request, "/api/workspaces", { name: "Bike shed" }),
    ]);

    expect(answers.map((answer) => answer.status)).toEqual([201, 201]);
    const titles = (await changes()).map((change) => change.title);
    expect(titles).toContain("New workspace: Garage gym");
    expect(titles).toContain("New workspace: Bike shed");
    expect(await gitIn(contextDir, "status", "--porcelain")).toBe("");
  });

  it("still makes changes when git can't use the folder, and says why nothing is kept", async () => {
    await writeFile(join(contextDir, ".git"), "not a repository\n");
    await startWorker();

    const created = await postJson(request, "/api/workspaces", { name: "Garage gym" });

    expect(created.status).toBe(201);
    expect(await backup()).toMatchObject({ kind: "not-kept", reason: expect.any(String) });
  });
});

describe("the backup", () => {
  it("isn't set up without a remote, and changes still commit", async () => {
    await startWorker();
    await postJson(request, "/api/workspaces", { name: "Garage gym" });

    expect(await backup()).toEqual({ kind: "not-set-up" });
    expect((await changes())[0]?.title).toBe("New workspace: Garage gym");
  });

  it("gets each change pushed to it", async () => {
    const remote = join(root, "backup.git");
    await run("git", ["init", "--quiet", "--bare", remote]);
    await startWorker({ COURTYARD_CONTEXT_REMOTE: remote });

    await postJson(request, "/api/workspaces", { name: "Garage gym" });

    expect(await backup()).toEqual({ kind: "up-to-date" });
    expect(await gitIn(remote, "log", "-1", "--format=%s", "main")).toBe(
      "New workspace: Garage gym",
    );
  });

  it("falls behind while it can't be reached, says why, and catches up when it can", async () => {
    const remote = join(root, "backup.git");
    await startWorker({ COURTYARD_CONTEXT_REMOTE: remote });
    const before = Date.now();

    await postJson(request, "/api/workspaces", { name: "Garage gym" });
    await postJson(request, "/api/workspaces", { name: "Bike shed" });

    const behind = await backup();
    expect(behind).toMatchObject({ kind: "behind", reason: expect.stringContaining("backup.git") });
    expect(behind.kind === "behind" && Date.parse(behind.since)).toBeGreaterThanOrEqual(
      Math.floor(before / 1000) * 1000,
    );
    expect((await changes()).map((change) => change.title)).toContain("New workspace: Bike shed");

    await run("git", ["init", "--quiet", "--bare", remote]);
    await keepUp();

    expect(await backup()).toEqual({ kind: "up-to-date" });
    expect(await gitIn(remote, "log", "--format=%s", "main")).toBe(
      [
        "New workspace: Bike shed",
        "New workspace: Garage gym",
        "Start keeping the context folder in git",
      ].join("\n"),
    );
  });
});
