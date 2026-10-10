import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEvent } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider, type Provider } from "./providers/index.ts";
import {
  errorOf,
  FAKE_MODEL,
  followSession,
  gatedProvider,
  postJson,
  type Requester,
  requesterFor,
  sendJson,
  setUpOwner,
  startSession,
  testWorker,
} from "./testing.ts";

// Queued messages (#177): a message the owner sends while a turn runs waits as a session event,
// which every device sees and can remove, and goes as soon as the session can take a turn.

let root: string;
let cookie: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  cookie = undefined;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

/** Starts a worker on this test's folders; a second call is a restart, with the owner still in. */
const startWorker = async (providers: Provider[]) => {
  const app = testWorker({ root, providers });
  cookie ??= await setUpOwner(app);
  return requesterFor(app, cookie);
};

const send = (request: Requester, sessionId: string, text: string) =>
  postJson(request, `/api/sessions/${sessionId}/messages`, { text, model: FAKE_MODEL });

const removeQueued = (request: Requester, sessionId: string, queued: number | string) =>
  sendJson(request, `/api/sessions/${sessionId}/queued/${queued}`, "DELETE", {});

/** The owner's messages in a session's events, in the order they went, with any they came from the queue as. */
const sentIn = (events: readonly SessionEvent[]) =>
  events.flatMap((event) =>
    event.type === "owner-message" ? [{ text: event.text, queued: event.queued }] : [],
  );

/** Follows a session until the turn answering its `count`th message has completed. */
const untilTurns = (request: Requester, sessionId: string, count: number) => {
  let completed = 0;
  return followSession(request, {
    sessionId,
    until: (event) => event.type === "turn-completed" && ++completed === count,
  });
};

describe("a message sent while a turn runs", () => {
  it("is queued, as an event every device sees, and goes once the turn ends", async () => {
    const gated = gatedProvider();
    const request = await startWorker([gated.provider]);
    const session = await startSession(request, "Take your time");

    const sent = await send(request, session.id, "And then this");
    expect(sent.status).toBe(202);
    const before = await followSession(request, { sessionId: session.id, until: "message-queued" });
    const queued = before.at(-1);
    expect(queued).toMatchObject({
      type: "message-queued",
      text: "And then this",
      model: FAKE_MODEL,
    });

    gated.release();
    const events = await untilTurns(request, session.id, 2);
    expect(sentIn(events)).toEqual([
      { text: "Take your time", queued: undefined },
      { text: "And then this", queued: queued?.seq },
    ]);
    // It goes only after the first turn has ended.
    const firstEnd = events.findIndex((event) => event.type === "turn-completed");
    const second = events.findLastIndex((event) => event.type === "owner-message");
    expect(second).toBeGreaterThan(firstEnd);
  });

  it("queues behind others, each going in order, one turn each", async () => {
    const gated = gatedProvider();
    const request = await startWorker([gated.provider]);
    const session = await startSession(request, "First");
    await send(request, session.id, "Second");
    await send(request, session.id, "Third");

    gated.release();
    const events = await untilTurns(request, session.id, 3);

    expect(sentIn(events).map((message) => message.text)).toEqual(["First", "Second", "Third"]);
  });

  it("can be removed before it goes, from any device, and then never goes", async () => {
    const gated = gatedProvider();
    const request = await startWorker([gated.provider]);
    const session = await startSession(request, "First");
    await send(request, session.id, "Never mind this");
    await send(request, session.id, "But this");
    const queued = (
      await followSession(request, {
        sessionId: session.id,
        until: (event) => event.type === "message-queued" && event.text === "But this",
      })
    ).find((event) => event.type === "message-queued");
    if (queued === undefined) throw new Error("nothing queued");

    expect((await removeQueued(request, session.id, queued.seq)).status).toBe(204);
    gated.release();
    const events = await untilTurns(request, session.id, 2);

    expect(events).toContainEqual(
      expect.objectContaining({ type: "queued-message-removed", queued: queued.seq }),
    );
    expect(sentIn(events).map((message) => message.text)).toEqual(["First", "But this"]);
    // Gone already, so it can't be removed now.
    const gone = (
      await followSession(request, {
        sessionId: session.id,
        until: (event) => event.type === "message-queued" && event.text === "But this",
      })
    ).at(-1);
    const late = await removeQueued(request, session.id, gone?.seq ?? 0);
    expect(late.status).toBe(409);
    expect(await errorOf(late)).toBe("That message has gone already.");
  });

  it("is the only thing removing names: anything else is no queued message", async () => {
    const request = await startWorker([createFakeProvider({ delayMs: 0 })]);
    const session = await startSession(request, "Just one");
    await untilTurns(request, session.id, 1);

    for (const named of ["1", "99", "not-a-number"]) {
      const response = await removeQueued(request, session.id, named);
      expect(response.status).toBe(404);
      expect(await errorOf(response)).toBe("No such queued message in this session.");
    }
  });

  it("still goes when the owner stops the turn: Stop ends the turn now and leaves the queue", async () => {
    const gated = gatedProvider();
    const request = await startWorker([gated.provider]);
    const session = await startSession(request, "Take your time");
    await send(request, session.id, "Then this");
    await followSession(request, { sessionId: session.id, until: "message-queued" });

    await postJson(request, `/api/sessions/${session.id}/stop`, { turn: 1 });
    gated.release();
    const events = await untilTurns(request, session.id, 1);

    expect(events.map((event) => event.type)).toContain("turn-stopped");
    expect(sentIn(events).map((message) => message.text)).toEqual(["Take your time", "Then this"]);
  });

  it("survives a worker restart, and goes once the restarted worker can take a turn", async () => {
    const stuck = gatedProvider(); // Never released: the worker "stops" mid-turn.
    const beforeRestart = await startWorker([stuck.provider]);
    const session = await startSession(beforeRestart, "This answer never arrives");
    await send(beforeRestart, session.id, "Still wanted");
    await followSession(beforeRestart, { sessionId: session.id, until: "message-queued" });

    // Nobody opens the session after the restart: the worker sends it by itself.
    let asked: () => void = () => {};
    const modelAsked = new Promise<void>((resolve) => {
      asked = resolve;
    });
    const afterRestart = await startWorker([
      createFakeProvider({ delayMs: 0, heard: () => asked() }),
    ]);
    await modelAsked;
    const events = await untilTurns(afterRestart, session.id, 1);

    expect(events.flatMap((e) => (e.type === "text-delta" ? [] : [e.type]))).toEqual([
      "owner-message",
      "message-queued",
      "turn-failed",
      "owner-message",
      "turn-completed",
    ]);
    expect(sentIn(events).at(-1)?.text).toBe("Still wanted");
  });
});
