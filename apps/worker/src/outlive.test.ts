import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SessionEvent, SessionList, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider, type Provider } from "./providers/index.ts";
import { type Requester, readEvents, requesterFor, setUpOwner } from "./testing.ts";
import { createWorker } from "./worker.ts";

const FAKE = { provider: "fake", model: "echo" };

let root: string;
let cookie: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  cookie = undefined;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * Starts a worker on this test's folders. Every call is a fresh worker process as far as the code
 * can tell, so a second call is a restart. The owner is set up once and stays logged in.
 */
const startWorker = async (providers: Provider[] = [createFakeProvider({ delayMs: 0 })]) => {
  const worker = createWorker({
    env: { COURTYARD_CONTEXT_DIR: join(root, "context"), COURTYARD_DATA_DIR: join(root, "data") },
    providers,
  });
  if (!worker.ok) throw new Error(worker.error);
  cookie ??= await setUpOwner(worker.value.app);
  return requesterFor(worker.value.app, cookie);
};

const post = (request: Requester, path: string, body: unknown) =>
  request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const startSession = async (request: Requester, text: string) => {
  const response = await post(request, "/api/workspaces/garage-gym/sessions", {
    text,
    model: FAKE,
  });
  expect(response.status).toBe(201);
  return SessionSummary.parse(await response.json());
};

/** A provider that holds each turn open until the test lets it go, if ever. */
const gatedProvider = () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { provider: createFakeProvider({ delayMs: 0, beforeReply: () => gate }), release };
};

const answerOf = (events: readonly SessionEvent[]) =>
  events.flatMap((e) => (e.type === "text-delta" ? [e.text] : [])).join("");

describe("a session outlives the tab", () => {
  it("keeps running when the tab closes mid-turn", async () => {
    const gated = gatedProvider();
    const request = await startWorker([gated.provider]);
    const session = await startSession(request, "Keep going without me");

    // The tab reads the owner's message, then closes.
    await readEvents(request, { sessionId: session.id, until: "owner-message" });
    gated.release();

    const later = await readEvents(request, { sessionId: session.id, until: "turn-completed" });
    expect(answerOf(later)).toBe("You said: Keep going without me");
  });

  it("resumes from the last event a reconnecting browser saw, with nothing missing or repeated", async () => {
    const request = await startWorker();
    const session = await startSession(request, "One two three four");
    const everything = await readEvents(request, {
      sessionId: session.id,
      until: "turn-completed",
    });

    const resumed = await readEvents(request, {
      sessionId: session.id,
      until: "turn-completed",
      lastEventId: 3,
    });

    expect(resumed).toEqual(everything.slice(3));
  });

  it("lets a second device replay everything and then follow live", async () => {
    const gated = gatedProvider();
    const request = await startWorker([gated.provider]);
    const session = await startSession(request, "Seen on two devices");

    const laptop = readEvents(request, { sessionId: session.id, until: "turn-completed" });
    const phone = readEvents(request, { sessionId: session.id, until: "turn-completed" });
    gated.release();

    const [onLaptop, onPhone] = await Promise.all([laptop, phone]);
    expect(onPhone).toEqual(onLaptop);
    expect(answerOf(onPhone)).toBe("You said: Seen on two devices");
  });
});

describe("a session outlives the worker", () => {
  it("is still listed and replayed in full after a restart", async () => {
    const beforeRestart = await startWorker();
    const session = await startSession(beforeRestart, "Remember this");
    const recorded = await readEvents(beforeRestart, {
      sessionId: session.id,
      until: "turn-completed",
    });

    const afterRestart = await startWorker();
    const list = SessionList.parse(
      await (await afterRestart("/api/workspaces/garage-gym/sessions")).json(),
    );
    const replayed = await readEvents(afterRestart, {
      sessionId: session.id,
      until: "turn-completed",
    });

    expect(list.sessions.map((s) => s.id)).toEqual([session.id]);
    expect(replayed).toEqual(recorded);
  });

  it("records a turn cut off by a restart as interrupted, and is usable again", async () => {
    const stuck = gatedProvider(); // Never released: the worker "stops" mid-turn.
    const beforeRestart = await startWorker([stuck.provider]);
    const session = await startSession(beforeRestart, "This answer never arrives");

    const afterRestart = await startWorker();
    const events = await readEvents(afterRestart, { sessionId: session.id, until: "turn-failed" });

    expect(events.map((e) => e.type)).toEqual(["owner-message", "turn-failed"]);
    expect(events.at(-1)).toMatchObject({ seq: 2, reason: { kind: "interrupted" } });
    const summary = SessionSummary.parse(
      await (await afterRestart(`/api/sessions/${session.id}`)).json(),
    );
    expect(summary.busy).toBe(false);
    const again = await post(afterRestart, `/api/sessions/${session.id}/messages`, {
      text: "Again",
      model: FAKE,
    });
    expect(again.status).toBe(202);
    await readEvents(afterRestart, { sessionId: session.id, until: "turn-completed", after: 2 });
  });

  it("records the interruption once, however many devices open the session", async () => {
    const stuck = gatedProvider();
    const beforeRestart = await startWorker([stuck.provider]);
    const session = await startSession(beforeRestart, "Cut off");

    const afterRestart = await startWorker();
    const [one, two] = await Promise.all([
      readEvents(afterRestart, { sessionId: session.id, until: "turn-failed" }),
      readEvents(afterRestart, { sessionId: session.id, until: "turn-failed" }),
    ]);

    expect(one).toEqual(two);
    expect(one.filter((e) => e.type === "turn-failed")).toHaveLength(1);
  });
});
