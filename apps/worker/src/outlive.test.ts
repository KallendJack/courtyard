import { appendFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SessionEvent, SessionList, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider, type Provider } from "./providers/index.ts";
import {
  FAKE_MODEL,
  followSession,
  gatedProvider,
  postJson,
  requesterFor,
  setUpOwner,
  startSession,
} from "./testing.ts";
import { createWorker } from "./worker.ts";

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

const answerOf = (events: readonly SessionEvent[]) =>
  events.flatMap((e) => (e.type === "text-delta" ? [e.text] : [])).join("");

describe("a session outlives the tab", () => {
  it("keeps running when the tab closes mid-turn", async () => {
    const gated = gatedProvider();
    const request = await startWorker([gated.provider]);
    const session = await startSession(request, "Keep going without me");

    // The tab reads the owner's message, then closes.
    await followSession(request, { sessionId: session.id, until: "owner-message" });
    gated.release();

    const later = await followSession(request, { sessionId: session.id, until: "turn-completed" });
    expect(answerOf(later)).toBe("You said: Keep going without me");
  });

  it("resumes from the last event a reconnecting browser saw, with nothing missing or repeated", async () => {
    const request = await startWorker();
    const session = await startSession(request, "One two three four");
    const everything = await followSession(request, {
      sessionId: session.id,
      until: "turn-completed",
    });

    const resumed = await followSession(request, {
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

    const laptop = followSession(request, { sessionId: session.id, until: "turn-completed" });
    const phone = followSession(request, { sessionId: session.id, until: "turn-completed" });
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
    const recorded = await followSession(beforeRestart, {
      sessionId: session.id,
      until: "turn-completed",
    });

    const afterRestart = await startWorker();
    const list = SessionList.parse(
      await (await afterRestart("/api/workspaces/garage-gym/sessions")).json(),
    );
    const replayed = await followSession(afterRestart, {
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
    const events = await followSession(afterRestart, {
      sessionId: session.id,
      until: "turn-failed",
    });

    expect(events.map((e) => e.type)).toEqual(["owner-message", "turn-failed"]);
    expect(events.at(-1)).toMatchObject({ seq: 2, reason: { kind: "interrupted" } });
    const summary = SessionSummary.parse(
      await (await afterRestart(`/api/sessions/${session.id}`)).json(),
    );
    expect(summary.busy).toBe(false);
    const again = await postJson(afterRestart, `/api/sessions/${session.id}/messages`, {
      text: "Again",
      model: FAKE_MODEL,
    });
    expect(again.status).toBe(202);
    await followSession(afterRestart, { sessionId: session.id, until: "turn-completed", after: 2 });
  });

  it("records the interruption once, however many devices open the session", async () => {
    const stuck = gatedProvider();
    const beforeRestart = await startWorker([stuck.provider]);
    const session = await startSession(beforeRestart, "Cut off");

    const afterRestart = await startWorker();
    const [one, two] = await Promise.all([
      followSession(afterRestart, { sessionId: session.id, until: "turn-failed" }),
      followSession(afterRestart, { sessionId: session.id, until: "turn-failed" }),
    ]);

    expect(one).toEqual(two);
    expect(one.filter((e) => e.type === "turn-failed")).toHaveLength(1);
  });
});

describe("a crash mid-write", () => {
  const eventsFile = (sessionId: string) =>
    join(root, "data", "sessions", sessionId, "events.jsonl");

  it("drops a half-written last line instead of breaking the session for good", async () => {
    const beforeRestart = await startWorker();
    const session = await startSession(beforeRestart, "Finished before the crash");
    const recorded = await followSession(beforeRestart, {
      sessionId: session.id,
      until: "turn-completed",
    });
    await appendFile(eventsFile(session.id), '{"seq":99,"type":"text-de');

    const afterRestart = await startWorker();
    const replayed = await followSession(afterRestart, {
      sessionId: session.id,
      until: "turn-completed",
    });
    const again = await postJson(afterRestart, `/api/sessions/${session.id}/messages`, {
      text: "Still works",
      model: FAKE_MODEL,
    });
    const next = await followSession(afterRestart, {
      sessionId: session.id,
      until: "turn-completed",
      after: recorded.length,
    });

    expect(replayed).toEqual(recorded);
    expect(again.status).toBe(202);
    expect(next[0]).toMatchObject({ seq: recorded.length + 1, type: "owner-message" });
  });

  it("records the turn a torn write cut off as interrupted", async () => {
    const stuck = gatedProvider();
    const beforeRestart = await startWorker([stuck.provider]);
    const session = await startSession(beforeRestart, "Crashed mid-answer");
    await appendFile(eventsFile(session.id), '{"seq":2,"type":"text-delta","te');

    const afterRestart = await startWorker();
    const events = await followSession(afterRestart, {
      sessionId: session.id,
      until: "turn-failed",
    });

    expect(events.map((e) => [e.seq, e.type])).toEqual([
      [1, "owner-message"],
      [2, "turn-failed"],
    ]);
  });
});

describe("loading a session after a restart", () => {
  it("records an interrupted turn as soon as the session list is opened", async () => {
    const stuck = gatedProvider();
    const beforeRestart = await startWorker([stuck.provider]);
    const session = await startSession(beforeRestart, "Cut off");

    const afterRestart = await startWorker();
    await afterRestart("/api/workspaces/garage-gym/sessions");

    const log = await readFile(join(root, "data", "sessions", session.id, "events.jsonl"), "utf8");
    expect(log).toContain('"interrupted"');
  });
});
