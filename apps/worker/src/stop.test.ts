import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, type SessionEvent } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider, type Provider } from "./providers/index.ts";
import {
  asOwner,
  FAKE_MODEL,
  followSession,
  gatedProvider,
  postJson,
  type Requester,
  startSession,
} from "./testing.ts";
import { createWorker } from "./worker.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const start = async (providers: Provider[]) => {
  const worker = createWorker({
    env: { COURTYARD_CONTEXT_DIR: join(root, "context"), COURTYARD_DATA_DIR: join(root, "data") },
    providers,
  });
  if (!worker.ok) throw new Error(worker.error);
  return asOwner(worker.value.app);
};

const stop = (request: Requester, sessionId: string) =>
  postJson(request, `/api/sessions/${sessionId}/stop`, {});

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
    expect(ApiError.parse(await response.json()).error).toMatch(/nothing/i);
  });

  it("answers 404 for a session that doesn't exist", async () => {
    const request = await start([createFakeProvider({ delayMs: 0 })]);

    expect((await stop(request, "not-a-session")).status).toBe(404);
  });
});
