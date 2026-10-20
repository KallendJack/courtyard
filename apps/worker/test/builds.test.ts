import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { takePlace } from "@courtyard/builds";
import { RunningTasks, type SessionEvent } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok, type Result } from "../src/lib/result.ts";
import { createFakeProvider, type Provider } from "../src/providers/index.ts";
import type { Environment } from "../src/worker.ts";
import {
  asOwner,
  BUILDING_MODEL,
  CODING_MODEL,
  codeRepo,
  codeWorkspace,
  codingProvider,
  FAKE_MODEL,
  followSession,
  gitIn,
  heldBuilder,
  postJson,
  type Requester,
  removeTestFolder,
  testBuildsLock,
  testWorker,
} from "./testing.ts";

// The builds queue (#281): the heavy checks code sessions run (`pnpm verify`, `vitest run`) go
// through one queue across the worker, so several sessions building at once can't lock the
// machine up. With real git in temporary repositories.

let root: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo } = await codeRepo(root));
  await codeWorkspace(root, "side-project", repo);
});

afterEach(async () => {
  await removeTestFolder(root);
});

/**
 * How long a test waits for a build to start: a session's turn first takes its slot and its
 * worktree, which a busy machine makes slower than `vi.waitFor`'s one second (#548).
 */
const STARTS = { timeout: 10_000 };

const start = async (providers: Provider[], env: Environment = {}) =>
  asOwner(testWorker({ root, providers, env }));

/** Starts a session in the code workspace on `model`, without waiting for its turn. */
const startCoding = async (request: Requester, text: string, model = BUILDING_MODEL) => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text,
    model,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

/** The activities in a turn's events. */
const activitiesIn = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "activity" ? [event.activity] : []));

/** Stops a session's turn, as the owner's Stop does. */
const stop = (request: Requester, sessionId: string, turn = 1) =>
  postJson(request, `/api/sessions/${sessionId}/stop`, { turn });

/** A session's tasks still running. */
const tasksOf = async (request: Requester, sessionId: string) =>
  RunningTasks.parse(await (await request(`/api/sessions/${sessionId}/tasks`)).json()).tasks;

/** Follows a session until it says it's waiting with `ahead` builds ahead of it. */
const waitingWith = (request: Requester, sessionId: string, ahead: number) =>
  followSession(request, {
    sessionId,
    until: (event) =>
      event.type === "activity" &&
      event.activity.kind === "waiting-for-build" &&
      event.activity.ahead === ahead,
  });

describe("the builds queue (#281)", () => {
  it("runs one heavy check at a time across sessions: the second waits, saying so, and starts once the first ends", async () => {
    const { provider, builds } = heldBuilder("pnpm verify");
    const request = await start([provider]);
    await startCoding(request, "Talk into the box");
    await vi.waitFor(() => expect(builds).toHaveLength(1), STARTS);

    const second = await startCoding(request, "Chat scrolling");

    await waitingWith(request, second, 1);
    expect(builds).toHaveLength(1);

    builds[0]?.finish();

    await vi.waitFor(() => expect(builds).toHaveLength(2), STARTS);
    builds[1]?.finish();
    const events = await followSession(request, { sessionId: second, until: "turn-completed" });
    expect(activitiesIn(events)).toEqual([
      { kind: "waiting-for-build", ahead: 1 },
      { kind: "ran-command", command: "pnpm verify" },
    ]);
  });

  it("lets a stopped session leave the queue, and the next one runs", async () => {
    const { provider, builds } = heldBuilder("pnpm verify");
    const request = await start([provider]);
    await startCoding(request, "Talk into the box");
    await vi.waitFor(() => expect(builds).toHaveLength(1), STARTS);
    const second = await startCoding(request, "Chat scrolling");
    await waitingWith(request, second, 1);
    const third = await startCoding(request, "A photo on its own");
    await waitingWith(request, third, 2);

    expect((await stop(request, second)).status).toBe(202);

    await followSession(request, { sessionId: second, until: "turn-stopped" });
    // One fewer ahead of the third, which starts next.
    await waitingWith(request, third, 1);
    builds[0]?.finish();
    await vi.waitFor(() => expect(builds).toHaveLength(2), STARTS);
    builds[1]?.finish();
    const events = await followSession(request, { sessionId: third, until: "turn-completed" });
    expect(activitiesIn(events).at(-1)).toEqual({ kind: "ran-command", command: "pnpm verify" });
  });

  it("frees a build when its turn ends, even when the provider never said the build ended", async () => {
    const { provider, builds } = heldBuilder("pnpm verify");
    const request = await start([provider]);
    const first = await startCoding(request, "Talk into the box");
    await vi.waitFor(() => expect(builds).toHaveLength(1), STARTS);
    const second = await startCoding(request, "Chat scrolling");
    await waitingWith(request, second, 1);

    // Stopped mid-build, the held builder ends its turn without saying the build ended.
    await stop(request, first);

    await vi.waitFor(() => expect(builds).toHaveLength(2), STARTS);
    builds[1]?.finish();
    await followSession(request, { sessionId: second, until: "turn-completed" });
  });

  it.each([
    "pnpm test",
    "pnpm run e2e",
    "pnpm --filter web build",
    "npm test",
    "pnpm exec vitest run",
    "pnpm --filter web exec vitest run",
    "pnpm exec playwright test --workers=1",
  ])("has %s wait its turn too", async (command) => {
    const { provider: builder, builds } = heldBuilder("pnpm verify");
    const { provider: coder } = codingProvider([{ run: command }]);
    const request = await start([builder, coder]);
    await startCoding(request, "Talk into the box");
    await vi.waitFor(() => expect(builds).toHaveLength(1), STARTS);

    const second = await startCoding(request, "Chat scrolling", CODING_MODEL);

    await waitingWith(request, second, 1);
    builds[0]?.finish();
    await followSession(request, { sessionId: second, until: "turn-completed" });
  });

  it("never holds back a light command while a build runs", async () => {
    const { provider: builder, builds } = heldBuilder("pnpm verify");
    const light = [
      "pnpm check",
      "pnpm typecheck",
      "pnpm --filter web typecheck",
      "pnpm exec tsc --noEmit",
      "git status",
      "cat README.md",
    ];
    const { provider: coder, answers } = codingProvider(light.map((run) => ({ run })));
    const request = await start([builder, coder]);
    await startCoding(request, "Talk into the box");
    await vi.waitFor(() => expect(builds).toHaveLength(1), STARTS);

    const second = await startCoding(request, "Chat scrolling", CODING_MODEL);

    const events = await followSession(request, { sessionId: second, until: "turn-completed" });
    expect(answers.every((answer) => answer.ok)).toBe(true);
    expect(activitiesIn(events).map((activity) => activity.kind)).not.toContain(
      "waiting-for-build",
    );
    builds[0]?.finish();
  });

  it("runs a session's second build of the same command when its first ends, even when that end is heard twice (#575)", async () => {
    const { provider: coder } = codingProvider([]);
    const answers: Result<null, string>[] = [];
    const provider: Provider = {
      ...coder,
      runTurn: async (input) => {
        const { code } = input;
        if (code === null) return err({ kind: "unknown", message: "Only builds." });
        expect(await code.run("pnpm verify")).toEqual(ok(null));
        const second = code.run("pnpm verify").then((answer) => answers.push(answer));
        await vi.waitFor(() => expect(waitingSeen).toBe(true), STARTS);
        // The first ends, and is heard ended again (a provider's hooks, a refused call of the
        // same command), while the second is still taking its place.
        code.ran("pnpm verify");
        code.ran("pnpm verify");
        await second;
        code.ran("pnpm verify");
        return ok(null);
      },
    };
    let waitingSeen = false;
    const request = await start([provider]);
    const id = await startCoding(request, "Talk into the box", CODING_MODEL);
    await waitingWith(request, id, 1);
    waitingSeen = true;

    await followSession(request, { sessionId: id, until: "turn-completed" });
    expect(answers).toEqual([ok(null)]);
  });

  it("runs as many builds at once as the worker's setting allows", async () => {
    const { provider, builds } = heldBuilder("pnpm verify");
    const request = await start([provider], { COURTYARD_BUILDS_AT_ONCE: "2" });
    await startCoding(request, "Talk into the box");
    await startCoding(request, "Chat scrolling");

    await vi.waitFor(() => expect(builds).toHaveLength(2), STARTS);
    const third = await startCoding(request, "A photo on its own");
    await waitingWith(request, third, 2);
    for (const build of builds) build.finish();
    await vi.waitFor(() => expect(builds).toHaveLength(3), STARTS);
    builds[2]?.finish();
  });
});

describe("the machine's builds lock (#306)", () => {
  /** Another build on the same machine, such as a helper's `pnpm verify`, taking a place. */
  const outsideBuild = (atOnce = 1, signal?: AbortSignal) =>
    takePlace(testBuildsLock(root, atOnce), {
      label: "helper /path/to/repo",
      ...(signal === undefined ? {} : { signal }),
    });

  it("waits while a build outside Courtyard holds the machine's place, and starts once it's freed", async () => {
    const outside = await outsideBuild();
    const { provider, builds } = heldBuilder("pnpm verify");
    const request = await start([provider]);

    const id = await startCoding(request, "Talk into the box");

    await waitingWith(request, id, 1);
    expect(builds).toHaveLength(0);
    outside?.free();
    await vi.waitFor(() => expect(builds).toHaveLength(1), STARTS);
    builds[0]?.finish();
    const events = await followSession(request, { sessionId: id, until: "turn-completed" });
    expect(activitiesIn(events)).toEqual([
      { kind: "waiting-for-build", ahead: 1 },
      { kind: "ran-command", command: "pnpm verify" },
    ]);
  });

  it("holds the machine's place while a session builds, so a build outside Courtyard waits, and frees it when the turn ends", async () => {
    const { provider, builds } = heldBuilder("pnpm verify");
    const request = await start([provider]);
    const id = await startCoding(request, "Talk into the box");
    await vi.waitFor(() => expect(builds).toHaveLength(1), STARTS);

    expect(await outsideBuild(1, AbortSignal.timeout(1000))).toBeNull();

    builds[0]?.finish();
    await followSession(request, { sessionId: id, until: "turn-completed" });
    const after = await outsideBuild(1, AbortSignal.timeout(5000));
    expect(after).not.toBeNull();
    after?.free();
  });

  it("frees the machine's place when a building session is stopped", async () => {
    const { provider, builds } = heldBuilder("pnpm verify");
    const request = await start([provider]);
    const id = await startCoding(request, "Talk into the box");
    await vi.waitFor(() => expect(builds).toHaveLength(1), STARTS);

    await stop(request, id);

    await followSession(request, { sessionId: id, until: "turn-stopped" });
    const after = await outsideBuild(1, AbortSignal.timeout(5000));
    expect(after).not.toBeNull();
    after?.free();
  });

  it("tells a session's commands it holds a place, so its own pnpm verify doesn't wait again", async () => {
    const { provider, builds } = heldBuilder("pnpm verify");
    const request = await start([provider]);
    await startCoding(request, "Talk into the box");

    await vi.waitFor(() => expect(builds).toHaveLength(1), STARTS);
    expect(builds[0]?.env.COURTYARD_BUILD_HELD).toBe("1");
    builds[0]?.finish();
  });

  it("clears a place a crashed build left behind, rather than waiting on it for ever", async () => {
    const lock = testBuildsLock(root);
    const builds = pathToFileURL(join(import.meta.dirname, "../../../packages/builds/index.ts"));
    // A run that takes a place and ends without freeing it.
    execFileSync(process.execPath, [
      "--input-type=module",
      "-e",
      `import { takePlace } from ${JSON.stringify(builds.href)};
await takePlace(${JSON.stringify(lock)}, { label: "crashed" });
process.exit(0);`,
    ]);
    const { provider, builds: started } = heldBuilder("pnpm verify");
    const request = await start([provider]);

    const id = await startCoding(request, "Talk into the box");

    await vi.waitFor(() => expect(started).toHaveLength(1), STARTS);
    started[0]?.finish();
    const events = await followSession(request, { sessionId: id, until: "turn-completed" });
    expect(activitiesIn(events)).toEqual([{ kind: "ran-command", command: "pnpm verify" }]);
  });

  it("has a task's package-level vitest run wait for a place a session's check holds (#589)", async () => {
    const { provider: builder, builds } = heldBuilder("pnpm verify");
    const request = await start([builder, createFakeProvider({ delayMs: 0 })]);
    await startCoding(request, "Talk into the box");
    await vi.waitFor(() => expect(builds).toHaveLength(1), STARTS);

    const second = await startCoding(
      request,
      "start task: pnpm --filter app exec vitest run test/talk.test.ts",
      FAKE_MODEL,
    );

    await waitingWith(request, second, 1);
    expect(await tasksOf(request, second)).toEqual([]);
    builds[0]?.finish();
    const started = await followSession(request, {
      sessionId: second,
      until: (event) => event.type === "task-started",
    });
    expect(started.at(-1)).toMatchObject({
      command: "pnpm --filter app exec vitest run test/talk.test.ts",
    });
    // It fails at once in a repository with no such package, and a turn tells the model.
    await followSession(request, {
      sessionId: second,
      until: (event) => event.type === "owner-message" && event.tasksEnded !== undefined,
    });
    await followSession(request, {
      sessionId: second,
      until: (event) => event.type === "turn-completed" && event.seq > 3,
    });
  });

  it("holds the machine's place while a task's check runs, its commands told so, and frees it when the task ends (#589)", async () => {
    await writeFile(
      join(repo, "held.mjs"),
      'console.log("held=" + process.env.COURTYARD_BUILD_HELD);\nsetInterval(() => {}, 1000);\n',
    );
    await writeFile(
      join(repo, "package.json"),
      JSON.stringify({ name: "side-project", private: true, scripts: { test: "node held.mjs" } }),
    );
    await gitIn(repo, "add", ".");
    await gitIn(repo, "commit", "--quiet", "-m", "A test that runs on");
    await gitIn(repo, "push", "--quiet", "origin", "main");
    const request = await start([createFakeProvider({ delayMs: 0 })]);

    const id = await startCoding(request, "start task: pnpm test", FAKE_MODEL);

    await followSession(request, { sessionId: id, until: "turn-completed" });
    const [task] = await tasksOf(request, id);
    await expect.poll(async () => (await tasksOf(request, id))[0]?.lastLine).toBe("held=1");
    expect(await outsideBuild(1, AbortSignal.timeout(1000))).toBeNull();
    await postJson(request, `/api/sessions/${id}/tasks/${task?.task}/stop`, {});
    const after = await outsideBuild(1, AbortSignal.timeout(5000));
    expect(after).not.toBeNull();
    after?.free();
  });

  it("shares the machine's places with builds outside Courtyard when it allows more than one", async () => {
    const outside = await outsideBuild(2);
    const { provider, builds } = heldBuilder("pnpm verify");
    const request = await start([provider], { COURTYARD_BUILDS_AT_ONCE: "2" });
    await startCoding(request, "Talk into the box");
    await vi.waitFor(() => expect(builds).toHaveLength(1), STARTS);

    const second = await startCoding(request, "Chat scrolling");

    await waitingWith(request, second, 2);
    outside?.free();
    await vi.waitFor(() => expect(builds).toHaveLength(2), STARTS);
    for (const build of builds) build.finish();
  });
});
