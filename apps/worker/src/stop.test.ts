import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEvent } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider, type Provider } from "./providers/index.ts";
import {
  asOwner,
  errorOf,
  FAKE_MODEL,
  followSession,
  gatedProvider,
  postJson,
  type Requester,
  startSession,
  testWorker,
} from "./testing.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const start = async (providers: Provider[]) => {
  return asOwner(testWorker({ root, providers }));
};

/** Stops a turn, named by its owner message's event number (the first turn's is 1). */
const stop = (request: Requester, sessionId: string, turn = 1) =>
  postJson(request, `/api/sessions/${sessionId}/stop`, { turn });

const answerOf = (events: readonly SessionEvent[]) =>
  events.flatMap((e) => (e.type === "text-delta" ? [e.text] : [])).join("");

describe("stopping a turn", () => {
  it("stops a turn mid-answer, keeps what was written, and records it as stopped", async () => {
    // Slow enough to stop halfway through a long answer.
    const request = await start([createFakeProvider({ delayMs: 20 })]);
    const session = await startSession(
      request,
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen",
    );

    let stopped = false;
    const events = await followSession(request, {
      sessionId: session.id,
      until: "turn-stopped",
      onEvent: (event) => {
        if (event.type === "text-delta" && !stopped) {
          stopped = true;
          void stop(request, session.id);
        }
      },
    });

    const answer = answerOf(events);
    expect(answer.length).toBeGreaterThan(0);
    expect(answer.length).toBeLessThan("You said: one two three four five six seven".length);
    expect(events.at(-1)?.type).toBe("turn-stopped");
    expect(events.some((e) => e.type === "turn-failed" || e.type === "turn-completed")).toBe(false);
  });

  it("stops a turn that hasn't written anything yet", async () => {
    const gated = gatedProvider();
    const request = await start([gated.provider]);
    const session = await startSession(request, "Take your time");

    expect((await stop(request, session.id)).status).toBe(202);
    const events = await followSession(request, { sessionId: session.id, until: "turn-stopped" });

    expect(events.map((e) => e.type)).toEqual(["owner-message", "turn-stopped"]);
  });

  it("leaves the session ready for the next message", async () => {
    const gated = gatedProvider();
    const request = await start([gated.provider]);
    const session = await startSession(request, "Take your time");
    await stop(request, session.id);
    const first = await followSession(request, { sessionId: session.id, until: "turn-stopped" });
    gated.release();

    const next = await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "Something else",
      model: FAKE_MODEL,
    });

    expect(next.status).toBe(202);
    await followSession(request, {
      sessionId: session.id,
      until: "turn-completed",
      after: first.length,
    });
  });

  it("says there's nothing to stop when no turn is running", async () => {
    const request = await start([createFakeProvider({ delayMs: 0 })]);
    const session = await startSession(request, "Quick one");
    await followSession(request, { sessionId: session.id, until: "turn-completed" });

    const response = await stop(request, session.id);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/nothing/i);
  });

  it("answers 404 for a session that doesn't exist", async () => {
    const request = await start([createFakeProvider({ delayMs: 0 })]);

    expect((await stop(request, "not-a-session")).status).toBe(404);
  });
});

describe("stopping safely", () => {
  it("refuses a late stop for an earlier turn, leaving the next one running", async () => {
    const gated = gatedProvider();
    const request = await start([gated.provider]);
    const session = await startSession(request, "First");
    gated.release();
    const first = await followSession(request, { sessionId: session.id, until: "turn-completed" });

    await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "Second",
      model: FAKE_MODEL,
    });
    const stale = await stop(request, session.id, 1);
    const second = await followSession(request, {
      sessionId: session.id,
      until: "turn-completed",
      after: first.length,
    });

    expect(stale.status).toBe(409);
    expect(second.some((e) => e.type === "turn-stopped")).toBe(false);
  });

  it("ends the turn as stopped even when the provider ignores the stop", async () => {
    let lateEmit: (() => Promise<void>) | undefined;
    const stubborn: Provider = {
      ...createFakeProvider({ delayMs: 0 }),
      // Never returns, never looks at the signal, and writes after being stopped.
      runTurn: (input) =>
        new Promise(() => {
          lateEmit = () => input.emit("written after the stop");
        }),
    };
    const request = await start([stubborn]);
    const session = await startSession(request, "Ignore me");

    expect((await stop(request, session.id)).status).toBe(202);
    const events = await followSession(request, { sessionId: session.id, until: "turn-stopped" });
    await lateEmit?.();
    const next = await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "Hello again",
      model: FAKE_MODEL,
    });

    expect(events.map((e) => e.type)).toEqual(["owner-message", "turn-stopped"]);
    expect(next.status).toBe(202);
  });
});
