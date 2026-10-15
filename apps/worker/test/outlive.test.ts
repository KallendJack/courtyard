import { appendFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SessionEvent, SessionList, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createFakeProvider, type Provider } from "../src/providers/index.ts";
import {
  createFakePush,
  errorOf,
  FAKE_MODEL,
  type FakePush,
  followSession,
  gatedProvider,
  postJson,
  type Requester,
  removeTestFolder,
  requesterFor,
  setUpOwner,
  startSession,
  testWorker,
} from "./testing.ts";

let root: string;
let cookie: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  cookie = undefined;
});

afterEach(async () => {
  await removeTestFolder(root);
});

/**
 * Starts a worker on this test's folders. Every call is a fresh worker process as far as the code
 * can tell, so a second call is a restart. The owner is set up once and stays logged in.
 */
const startWorker = async (
  providers: Provider[] = [createFakeProvider({ delayMs: 0 })],
  push: FakePush = createFakePush(),
) => {
  const app = testWorker({ root, providers, sendPush: push.send });
  cookie ??= await setUpOwner(app);
  return requesterFor(app, cookie);
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
    // A restart ends the worker before it; in a test it's still there, so its turn is let go.
    stuck.release();
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
    stuck.release();
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
      until: "session-titled",
    });
    await appendFile(eventsFile(session.id), '{"seq":99,"type":"text-de');

    const afterRestart = await startWorker();
    const replayed = await followSession(afterRestart, {
      sessionId: session.id,
      until: "session-titled",
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
    // Torn mid-answer, once the turn is being answered: a turn still starting reads its log,
    // and on finding it torn records its own failure after the torn line (#218).
    await stuck.held;
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
    stuck.release();
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
    stuck.release();
  });
});

describe("a turn a restart cut off (#186)", () => {
  /** A session's turn cut off by a restart, as a crash or the PC restarting leaves it. */
  const cutOff = async (text: string) => {
    const stuck = gatedProvider();
    const beforeRestart = await startWorker([stuck.provider]);
    const session = await startSession(beforeRestart, text);
    await stuck.held;
    return { session, stuck };
  };
  const listed = async (request: Requester) =>
    SessionList.parse(await (await request("/api/workspaces/garage-gym/sessions")).json()).sessions;

  it("is found as the worker starts, and one notification names every turn it stopped", async () => {
    const stuck = gatedProvider();
    const push = createFakePush();
    const beforeRestart = await startWorker([stuck.provider], push);
    await postJson(beforeRestart, "/api/notifications/on", {
      endpoint: "https://push.example/fold",
      keys: { p256dh: "p256dh-of-fold", auth: "auth-of-fold" },
    });
    const one = await startSession(beforeRestart, "Slim new-session screen");
    const two = await startSession(beforeRestart, "Fix model chip");
    await stuck.held;

    // A crash: nothing opens a session, yet both are checked as it starts.
    await startWorker(undefined, push);

    await expect.poll(() => push.sent).toHaveLength(1);
    const payload = z
      .object({ title: z.string(), body: z.string(), session: z.string() })
      .parse(push.sent[0]?.payload);
    expect(payload.title).toBe("Courtyard restarted · 2 turns stopped");
    expect(payload.body).toMatch(/^.+, .+\. Tap to continue them\.$/);
    expect(payload.body).toContain("Slim new-session screen");
    expect(payload.body).toContain("Fix model chip");
    expect([one.id, two.id]).toContain(payload.session);
    stuck.release();
  });

  it("waits in Needs you until Continue, which carries it on, telling its model so", async () => {
    const { session, stuck } = await cutOff("Run the tests");
    const afterRestart = await startWorker();
    await followSession(afterRestart, { sessionId: session.id, until: "turn-failed" });
    expect((await listed(afterRestart))[0]).toMatchObject({ id: session.id, waiting: "cut-off" });

    const continued = await postJson(afterRestart, `/api/sessions/${session.id}/continue`, {
      turn: 1,
    });
    const events = await followSession(afterRestart, {
      sessionId: session.id,
      until: "turn-completed",
      after: 2,
    });

    expect(continued.status).toBe(202);
    expect(events[0]).toMatchObject({
      type: "owner-message",
      continues: { turn: 1 },
      text: expect.stringMatching(/^Courtyard restarted while you were working on your last turn/),
    });
    expect(answerOf(events)).toMatch(/^You said: Courtyard restarted/);
    expect((await listed(afterRestart))[0]).toMatchObject({ waiting: "reply" });
    stuck.release();
  });

  it("continues from a list, naming no turn, the session's last", async () => {
    const { session, stuck } = await cutOff("Run the tests");
    const afterRestart = await startWorker();
    await followSession(afterRestart, { sessionId: session.id, until: "turn-failed" });

    const continued = await postJson(afterRestart, `/api/sessions/${session.id}/continue`, {});
    const events = await followSession(afterRestart, {
      sessionId: session.id,
      until: "turn-completed",
      after: 2,
    });

    expect(continued.status).toBe(202);
    expect(events[0]).toMatchObject({ type: "owner-message", continues: { turn: 1 } });
    stuck.release();
  });

  it("waits no more once the owner sends a message of their own", async () => {
    const { session, stuck } = await cutOff("Run the tests");
    const afterRestart = await startWorker();
    await followSession(afterRestart, { sessionId: session.id, until: "turn-failed" });

    await postJson(afterRestart, `/api/sessions/${session.id}/messages`, {
      text: "Never mind",
      model: FAKE_MODEL,
    });
    await followSession(afterRestart, { sessionId: session.id, until: "turn-completed", after: 2 });

    expect((await listed(afterRestart))[0]).toMatchObject({ waiting: "reply" });
    stuck.release();
  });

  it("won't continue a turn that wasn't cut off", async () => {
    const request = await startWorker();
    const session = await startSession(request, "Finished");
    await followSession(request, { sessionId: session.id, until: "turn-completed" });

    const refused = await postJson(request, `/api/sessions/${session.id}/continue`, { turn: 1 });

    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toMatch(/cut it off/);
  });
});
