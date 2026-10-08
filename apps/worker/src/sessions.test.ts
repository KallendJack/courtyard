import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderList, SessionEvent, SessionList, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./providers/fake.ts";
import type { Provider } from "./providers/index.ts";
import {
  asOwner,
  errorOf,
  FAKE_MODEL,
  followSession,
  gatedProvider,
  postJson,
  startSession,
  testWorker,
} from "./testing.ts";

let root: string;
let now: number;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  now = Date.parse("2026-10-05T12:00:00Z");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const start = async (providers: Provider[] = [createFakeProvider({ delayMs: 0 })]) => {
  const request = await asOwner(testWorker({ root, now: () => now, providers }));
  const post = (path: string, body: unknown) => postJson(request, path, body);
  return { request, post };
};

describe("providers", () => {
  it("lists the fake provider with its models", async () => {
    const api = await start();

    const { providers } = ProviderList.parse(await (await api.request("/api/providers")).json());

    expect(providers).toEqual([
      expect.objectContaining({
        id: "fake",
        available: true,
        models: [expect.objectContaining({ id: "echo" })],
      }),
    ]);
  });
});

describe("a session", () => {
  it("starts with the owner's message, returns at once, and streams the answer", async () => {
    const api = await start();

    const session = await startSession(api.request, "Where should the rack go?");
    const events = await followSession(api.request, {
      sessionId: session.id,
      until: "turn-completed",
    });

    expect(session).toMatchObject({
      workspaceId: "garage-gym",
      title: "Where should the rack go?",
    });
    expect(events[0]).toMatchObject({
      seq: 1,
      type: "owner-message",
      text: "Where should the rack go?",
    });
    const text = events.flatMap((e) => (e.type === "text-delta" ? [e.text] : [])).join("");
    expect(text).toBe("You said: Where should the rack go?");
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  });

  it("sends each event only after it's on disk", async () => {
    const api = await start();
    const session = await startSession(api.request, "Hello");
    const eventsFile = join(root, "data", "sessions", session.id, "events.jsonl");
    const onDiskWhenSent: boolean[] = [];

    await followSession(api.request, {
      sessionId: session.id,
      until: "turn-completed",
      onEvent: (event) => {
        // Checked synchronously as each event arrives, before anything else can write.
        const lines = readFileSync(eventsFile, "utf8").trim().split("\n");
        onDiskWhenSent.push(
          lines.some((line) => SessionEvent.parse(JSON.parse(line)).seq === event.seq),
        );
      },
    });

    expect(onDiskWhenSent.every(Boolean)).toBe(true);
  });

  it("keeps the session as plain files, one folder per session", async () => {
    const api = await start();
    const session = await startSession(api.request, "Hello");
    await followSession(api.request, { sessionId: session.id, until: "turn-completed" });

    const folder = join(root, "data", "sessions", session.id);
    const meta = SessionSummary.omit({ busy: true }).parse(
      JSON.parse(await readFile(join(folder, "session.json"), "utf8")),
    );
    const lines = (await readFile(join(folder, "events.jsonl"), "utf8")).trim().split("\n");

    expect(meta).toMatchObject({ id: session.id, workspaceId: "garage-gym" });
    expect(SessionEvent.parse(JSON.parse(lines[0] ?? ""))).toMatchObject({
      seq: 1,
      type: "owner-message",
    });
  });

  it("continues with later messages, numbering events without gaps", async () => {
    const api = await start();
    const session = await startSession(api.request, "First");
    // After its first answer, the session is titled.
    const first = await followSession(api.request, {
      sessionId: session.id,
      until: "session-titled",
    });

    const sent = await api.post(`/api/sessions/${session.id}/messages`, {
      text: "Second",
      model: FAKE_MODEL,
    });
    expect(sent.status).toBe(202);
    const second = await followSession(api.request, {
      sessionId: session.id,
      until: "turn-completed",
      after: first.length,
    });

    expect(second[0]).toMatchObject({
      seq: first.length + 1,
      type: "owner-message",
      text: "Second",
    });
    expect(second.map((e) => e.seq)).toEqual(second.map((_, i) => first.length + i + 1));
  });

  it("replays the whole event log to anyone who opens it later", async () => {
    const api = await start();
    const session = await startSession(api.request, "First");
    const live = await followSession(api.request, {
      sessionId: session.id,
      until: "turn-completed",
    });

    const replayed = await followSession(api.request, {
      sessionId: session.id,
      until: "turn-completed",
    });

    expect(replayed).toEqual(live);
  });

  it("refuses a message while a turn is running", async () => {
    const gated = gatedProvider();
    const api = await start([gated.provider]);
    const session = await startSession(api.request, "Take your time");

    const busy = await api.post(`/api/sessions/${session.id}/messages`, {
      text: "Hurry",
      model: FAKE_MODEL,
    });

    expect(busy.status).toBe(409);
    expect(await errorOf(busy)).toMatch(/already/i);
    gated.release();
    const first = await followSession(api.request, {
      sessionId: session.id,
      until: "turn-completed",
    });
    expect(
      (await api.post(`/api/sessions/${session.id}/messages`, { text: "Now", model: FAKE_MODEL }))
        .status,
    ).toBe(202);
    // Let the second turn finish before the test's folder is removed.
    await followSession(api.request, {
      sessionId: session.id,
      until: "turn-completed",
      after: first.length,
    });
  });

  it("records what the model did, such as a file it read, in the event log", async () => {
    const api = await start();

    const session = await startSession(api.request, "please read the context file");
    const events = await followSession(api.request, {
      sessionId: session.id,
      until: "turn-completed",
    });

    const activity = events.find((e) => e.type === "activity");
    expect(activity).toMatchObject({ activity: { kind: "read-file", path: "CONTEXT.md" } });
    expect(events.findIndex((e) => e.type === "activity")).toBeLessThan(
      events.findIndex((e) => e.type === "text-delta"),
    );
  });

  it("records a failed turn with its reason in plain words", async () => {
    const api = await start();

    const session = await startSession(api.request, "please fail");
    const events = await followSession(api.request, {
      sessionId: session.id,
      until: "turn-failed",
    });

    expect(events.at(-1)).toMatchObject({
      type: "turn-failed",
      reason: { kind: "unknown", message: expect.stringMatching(/fail/i) },
    });
  });

  it("refuses a model that isn't available, and an empty message", async () => {
    const api = await start();

    const noModel = await api.post("/api/workspaces/garage-gym/sessions", {
      text: "Hi",
      model: { provider: "claude", model: "opus" },
    });
    const empty = await api.post("/api/workspaces/garage-gym/sessions", {
      text: "  ",
      model: FAKE_MODEL,
    });

    expect(noModel.status).toBe(400);
    expect(empty.status).toBe(400);
  });

  it("refuses a session in a workspace that doesn't exist", async () => {
    const api = await start();

    const response = await api.post("/api/workspaces/no-such-place/sessions", {
      text: "Hi",
      model: FAKE_MODEL,
    });

    expect(response.status).toBe(404);
  });
});

describe("an event stream that can't start", () => {
  it("says why, instead of an empty stream the browser would retry forever", async () => {
    const api = await start();
    const session = await startSession(api.request, "Hello");
    await followSession(api.request, { sessionId: session.id, until: "turn-completed" });
    const eventsFile = join(root, "data", "sessions", session.id, "events.jsonl");
    await rm(eventsFile);
    await mkdir(eventsFile);

    const response = await api.request(`/api/sessions/${session.id}/events`);
    const text = await response.text();

    expect(text).toContain("event: problem");
    expect(text).toContain("can't be read");
  });
});

describe("a workspace's sessions", () => {
  it("are listed newest first", async () => {
    const api = await start();
    const older = await startSession(api.request, "Older");
    await followSession(api.request, { sessionId: older.id, until: "turn-completed" });
    now += 60_000;
    const newer = await startSession(api.request, "Newer");
    await followSession(api.request, { sessionId: newer.id, until: "turn-completed" });

    const response = await api.request("/api/workspaces/garage-gym/sessions");
    const { sessions } = SessionList.parse(await response.json());

    expect(sessions.map((s) => s.title)).toEqual(["Newer", "Older"]);
  });

  it("answer 404 for a session that doesn't exist", async () => {
    const api = await start();

    expect((await api.request("/api/sessions/not-a-session/events")).status).toBe(404);
  });
});
