import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { takePlace } from "@courtyard/builds";
import type { SessionEvent } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "./agent/providers/index.ts";
import {
  asOwner,
  BUILDING_MODEL,
  CODING_MODEL,
  codeRepo,
  codeWorkspace,
  codingProvider,
  followSession,
  heldBuilder,
  postJson,
  type Requester,
  removeTestFolder,
  testBuildsLock,
  testWorker,
} from "./testing.ts";
import type { Environment } from "./worker.ts";

// The builds queue (#281): the heavy checks code sessions run (`pnpm verify`, `vitest run`) go
// through one queue across the worker, so several sessions building at once can't lock the
// machine up. With real git in temporary repositories.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  const { repo } = await codeRepo(root);
  await codeWorkspace(root, "side-project", repo);
});

afterEach(async () => {
  await removeTestFolder(root);
});

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
    await vi.waitFor(() => expect(builds).toHaveLength(1));

    const second = await startCoding(request, "Chat scrolling");

    await waitingWith(request, second, 1);
    expect(builds).toHaveLength(1);

    builds[0]?.finish();

    await vi.waitFor(() => expect(builds).toHaveLength(2));
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
    await vi.waitFor(() => expect(builds).toHaveLength(1));
    const second = await startCoding(request, "Chat scrolling");
    await waitingWith(request, second, 1);
    const third = await startCoding(request, "A photo on its own");
    await waitingWith(request, third, 2);

    expect((await stop(request, second)).status).toBe(202);

    await followSession(request, { sessionId: second, until: "turn-stopped" });
    // One fewer ahead of the third, which starts next.
    await waitingWith(request, third, 1);
    builds[0]?.finish();
    await vi.waitFor(() => expect(builds).toHaveLength(2));
    builds[1]?.finish();
    const events = await followSession(request, { sessionId: third, until: "turn-completed" });
    expect(activitiesIn(events).at(-1)).toEqual({ kind: "ran-command", command: "pnpm verify" });
  });

  it("frees a build when its turn ends, even when the provider never said the build ended", async () => {
    const { provider, builds } = heldBuilder("pnpm verify");
    const request = await start([provider]);
    const first = await startCoding(request, "Talk into the box");
    await vi.waitFor(() => expect(builds).toHaveLength(1));
    const second = await startCoding(request, "Chat scrolling");
    await waitingWith(request, second, 1);

    // Stopped mid-build, the held builder ends its turn without saying the build ended.
    await stop(request, first);

    await vi.waitFor(() => expect(builds).toHaveLength(2));
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
    await vi.waitFor(() => expect(builds).toHaveLength(1));

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
    await vi.waitFor(() => expect(builds).toHaveLength(1));

    const second = await startCoding(request, "Chat scrolling", CODING_MODEL);

    const events = await followSession(request, { sessionId: second, until: "turn-completed" });
    expect(answers.every((answer) => answer.ok)).toBe(true);
    expect(activitiesIn(events).map((activity) => activity.kind)).not.toContain(
      "waiting-for-build",
    );
    builds[0]?.finish();
  });

  it("runs as many builds at once as the worker's setting allows", async () => {
    const { provider, builds } = heldBuilder("pnpm verify");
    const request = await start([provider], { COURTYARD_BUILDS_AT_ONCE: "2" });
    await startCoding(request, "Talk into the box");
    await startCoding(request, "Chat scrolling");

    await vi.waitFor(() => expect(builds).toHaveLength(2));
    const third = await startCoding(request, "A photo on its own");
    await waitingWith(request, third, 2);
    for (const build of builds) build.finish();
    await vi.waitFor(() => expect(builds).toHaveLength(3));
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
    await vi.waitFor(() => expect(builds).toHaveLength(1));
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
    await vi.waitFor(() => expect(builds).toHaveLength(1));

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
    await vi.waitFor(() => expect(builds).toHaveLength(1));

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

    await vi.waitFor(() => expect(builds).toHaveLength(1));
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

    await vi.waitFor(() => expect(started).toHaveLength(1));
    started[0]?.finish();
    const events = await followSession(request, { sessionId: id, until: "turn-completed" });
    expect(activitiesIn(events)).toEqual([{ kind: "ran-command", command: "pnpm verify" }]);
  });

  it("shares the machine's places with builds outside Courtyard when it allows more than one", async () => {
    const outside = await outsideBuild(2);
    const { provider, builds } = heldBuilder("pnpm verify");
    const request = await start([provider], { COURTYARD_BUILDS_AT_ONCE: "2" });
    await startCoding(request, "Talk into the box");
    await vi.waitFor(() => expect(builds).toHaveLength(1));

    const second = await startCoding(request, "Chat scrolling");

    await waitingWith(request, second, 2);
    outside?.free();
    await vi.waitFor(() => expect(builds).toHaveLength(2));
    for (const build of builds) build.finish();
  });
});
