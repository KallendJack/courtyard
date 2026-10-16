import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunningTasks, SessionEvent } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "../src/providers/fake.ts";
import type { Framing } from "../src/providers/index.ts";
import {
  codeRepo,
  codeWorkspace,
  FAKE_MODEL,
  followSession,
  gitIn,
  postJson,
  quotedInGuide,
  type Requester,
  removeTestFolder,
  requesterFor,
  sendJson,
  setUpOwner,
  testWorker,
} from "./testing.ts";

// A code session's tasks (#182): long commands that outlive the turn that starts them, run by the
// worker in real processes, in a session's worktree on a real temporary repository.

let root: string;

/** Scripts the repository runs as tasks: one that passes, one that fails, one that runs on. */
const SCRIPTS = {
  "pass.mjs": 'console.log("Building");\nsetTimeout(() => console.log("All 12 passed"), 300);\n',
  "fail.mjs":
    'console.log("Checking");\nsetTimeout(() => { console.error("2 failed"); process.exit(3); }, 300);\n',
  "serve.mjs": 'console.log("Listening on 5173");\nsetInterval(() => {}, 1000);\n',
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  const { repo } = await codeRepo(root);
  await mkdir(join(repo, "scripts"));
  for (const [name, text] of Object.entries(SCRIPTS)) {
    await writeFile(join(repo, "scripts", name), text);
  }
  await gitIn(repo, "add", ".");
  await gitIn(repo, "commit", "--quiet", "-m", "Scripts");
  await gitIn(repo, "push", "--quiet", "origin", "main");
  await codeWorkspace(root, "side-project", repo);
});

afterEach(async () => {
  await removeTestFolder(root);
});

/**
 * A worker on the test's folders with the fake, keeping each turn's framing: the owner set up on
 * it, or, given the cookie a device logged in with, that device.
 */
const start = async (cookie?: string) => {
  const framings: Framing[] = [];
  const provider = createFakeProvider({ delayMs: 0, framed: (framing) => framings.push(framing) });
  const app = testWorker({ root, providers: [provider] });
  const loggedIn = cookie ?? (await setUpOwner(app));
  return { request: requesterFor(app, loggedIn), framings, cookie: loggedIn };
};

/** Starts a session in the code workspace with `text`: its id. */
const startIn = async (request: Requester, text: string) => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text,
    model: FAKE_MODEL,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

/** What the fake answered in some events. */
const answerIn = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "text-delta" ? [event.text] : [])).join("");

/** Picks out the `count`th event `pick` picks, from where the stream starts. */
const nth = (count: number, pick: (event: SessionEvent) => boolean) => {
  let seen = 0;
  return (event: SessionEvent) => pick(event) && ++seen === count;
};

const completed = (event: SessionEvent) => event.type === "turn-completed";

describe("a code session's tasks", () => {
  it("run on after the turn that starts them, and a passing one starts a turn telling the model, with its last lines of output", async () => {
    const { request, framings } = await start();
    const id = await startIn(request, "start task: node scripts/pass.mjs (for: Build it)");

    const events = await followSession(request, { sessionId: id, until: nth(2, completed) });

    const started = await quotedInGuide("Courtyard started this as a task");
    const first = events.findIndex(completed);
    expect(answerIn(events.slice(0, first))).toContain(started);
    const taskStarted = events.find((event) => event.type === "task-started");
    expect(taskStarted).toMatchObject({ command: "node scripts/pass.mjs" });
    // It ended after the turn that started it, which it outlived.
    const ended = events.findIndex((event) => event.type === "task-ended");
    expect(ended).toBeGreaterThan(first);
    expect(events[ended]).toMatchObject({ ending: { kind: "passed" } });
    // Then a turn of its own tells the model, on the model the owner last used.
    const told = events.slice(ended).find((event) => event.type === "owner-message");
    expect(told).toMatchObject({
      model: FAKE_MODEL,
      tasksEnded: [taskStarted?.type === "task-started" ? taskStarted.task : ""],
    });
    const line = await quotedInGuide("Your task `<command>` <ended> after <time>.", {
      command: "node scripts/pass.mjs",
      ended: "passed",
    });
    const [before] = line.split("<time>");
    expect(told?.type === "owner-message" ? told.text : "").toMatch(
      new RegExp(`^${literally(before ?? "")}0:0\\d\\.$`),
    );
    // The output goes to the model alone, never in the event log.
    expect(framings[1]?.newMessage).toMatch(
      /Its last lines of output:\n\n<output>\nBuilding\nAll 12 passed\n<\/output>$/,
    );
    expect(JSON.stringify(events)).not.toContain("All 12 passed");
  });

  it("tell the model one failed, with its exit code and what it printed last", async () => {
    const { request, framings } = await start();
    const id = await startIn(request, "start task: node scripts/fail.mjs");

    const events = await followSession(request, { sessionId: id, until: nth(2, completed) });

    expect(events.find((event) => event.type === "task-ended")).toMatchObject({
      ending: { kind: "failed", exitCode: 3 },
    });
    expect(framings[1]?.newMessage).toMatch(
      /^Your task `node scripts\/fail.mjs` failed with exit code 3 after 0:0\d\. Its last lines of output:\n\n<output>\nChecking\n2 failed\n<\/output>$/,
    );
  });

  it("go into the answer that's running when one ends, as a message the owner adds does", async () => {
    const { request } = await start();
    const id = await startIn(request, "start task: node scripts/pass.mjs\nwait for more");

    const events = await followSession(request, { sessionId: id, until: "turn-completed" });

    const added = events.find((event) => event.type === "message-added");
    expect(added).toMatchObject({ task: expect.any(String) });
    expect(added?.type === "message-added" ? added.text : "").toMatch(
      /^Your task `node scripts\/pass.mjs` passed after 0:0\d\.$/,
    );
    // The model read it, output and all; the event log keeps only the line.
    expect(answerIn(events)).toContain("noted: Your task `node scripts/pass.mjs` passed after");
    expect(answerIn(events)).toContain("All 12 passed");
    expect(JSON.stringify(events.filter((event) => event.type !== "text-delta"))).not.toContain(
      "All 12 passed",
    );
    // Told already, so no turn of its own follows.
    const all = await sessionEvents(request, id);
    expect(all.filter((event) => event.type === "owner-message")).toHaveLength(1);
  });
});

describe("what runs as a task", () => {
  it("is what may run in the foreground, and the dev and start scripts, which run only as tasks", async () => {
    const { request } = await start();
    const id = await startIn(
      request,
      [
        "run command: pnpm dev",
        "run command: npm start",
        "start task: node scripts/serve.mjs",
      ].join("\n"),
    );

    const events = await followSession(request, { sessionId: id, until: "turn-completed" });

    const onlyTask = await quotedInGuide("Run it as a task");
    expect(answerIn(events)).toContain(`Couldn't run pnpm dev: ${onlyTask}`);
    expect(answerIn(events)).toContain(`Couldn't run npm start: ${onlyTask}`);
    expect(events.filter((event) => event.type === "task-started")).toHaveLength(1);
    await stopAll(request, id);
  });

  it("is at most three at once in a session; the owner sees each running, reads its output and stops it, telling nobody", async () => {
    const { request } = await start();
    const serve = "start task: node scripts/serve.mjs";
    const id = await startIn(request, [serve, serve, serve, serve].join("\n"));
    const events = await followSession(request, { sessionId: id, until: "turn-completed" });

    expect(answerIn(events)).toContain(
      `Couldn't start node scripts/serve.mjs: ${await quotedInGuide("You have three tasks running already")}`,
    );
    const running = await listed(request, id);
    expect(running.tasks).toHaveLength(3);
    // Its last line, once it has printed one.
    await expect
      .poll(async () => (await listed(request, id)).tasks[0]?.lastLine)
      .toBe("Listening on 5173");
    const [first] = running.tasks;
    const output = await request(`/api/sessions/${id}/tasks/${first?.task}/output`);
    expect(await output.json()).toEqual({ output: "Listening on 5173\n", cut: false });

    const stopped = await postJson(request, `/api/sessions/${id}/tasks/${first?.task}/stop`, {});
    expect(stopped.status).toBe(204);
    const after = await followSession(request, {
      sessionId: id,
      after: events.at(-1)?.seq ?? 0,
      until: "task-ended",
    });
    expect(after.filter((event) => event.type === "task-ended")).toMatchObject([
      { ending: { kind: "stopped", by: "owner" } },
    ]);
    expect((await listed(request, id)).tasks).toHaveLength(2);
    // Stopping one that's no longer running is refused.
    const again = await postJson(request, `/api/sessions/${id}/tasks/${first?.task}/stop`, {});
    expect(again.status).toBe(404);
    await stopAll(request, id);
    // Stopped by the owner, none starts a turn.
    expect(
      (await sessionEvents(request, id)).filter((event) => event.type === "owner-message"),
    ).toHaveLength(1);
  });
});

describe("a session's tasks end with it", () => {
  it("when it's deleted", async () => {
    const { request } = await start();
    const id = await startIn(request, "start task: node scripts/serve.mjs");
    await followSession(request, { sessionId: id, until: "turn-completed" });
    expect((await listed(request, id)).tasks).toHaveLength(1);

    const deleted = await sendJson(request, `/api/sessions/${id}`, "DELETE", {});

    expect(deleted.status).toBe(204);
    expect((await request(`/api/sessions/${id}/tasks`)).status).toBe(404);
  });

  it("and with the worker: the next worker records each as stopped by a restart, and the model reads so next turn", async () => {
    const { request, cookie } = await start();
    const id = await startIn(request, "start task: node scripts/serve.mjs");
    await followSession(request, { sessionId: id, until: "turn-completed" });

    // A new worker on the same folders, as after an Update.
    const { request: restarted, framings } = await start(cookie);
    const events = await sessionEvents(restarted, id);
    expect(events.at(-1)).toMatchObject({
      type: "task-ended",
      ending: { kind: "stopped", by: "restart" },
    });
    await postJson(restarted, `/api/sessions/${id}/messages`, {
      text: "Carry on",
      model: FAKE_MODEL,
    });
    await followSession(restarted, {
      sessionId: id,
      after: events.at(-1)?.seq ?? 0,
      until: "turn-completed",
    });
    expect(framings[0]?.message).toContain(
      await quotedInGuide("Courtyard: your task `<command>` <how>.", {
        command: "node scripts/serve.mjs",
        how: "was stopped by a restart",
      }),
    );
    // The first worker's task is still its own to stop.
    await stopAll(request, id);
  });
});

/** The session's tasks still running, as the owner's page asks. */
const listed = async (request: Requester, id: string) => {
  const response = await request(`/api/sessions/${id}/tasks`);
  expect(response.status).toBe(200);
  return RunningTasks.parse(await response.json());
};

/** Stops every task the session runs, as the owner's Stop does. */
const stopAll = async (request: Requester, id: string) => {
  for (const { task } of (await listed(request, id)).tasks) {
    await postJson(request, `/api/sessions/${id}/tasks/${task}/stop`, {});
  }
};

/** Every event the session has recorded so far. */
const sessionEvents = async (request: Requester, id: string) => {
  const events: SessionEvent[] = [];
  const response = await request(`/api/sessions/${id}/events?after=0`);
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  // The replay comes at once; a moment's quiet ends it.
  let text = "";
  for (;;) {
    const read = await Promise.race([
      reader?.read(),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 300)),
    ]);
    if (read === undefined || read.done) break;
    text += read.value;
  }
  await reader?.cancel();
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) events.push(SessionEvent.parse(JSON.parse(line.slice(6))));
  }
  return events;
};

/** Text as a regular expression matches it. */
const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
