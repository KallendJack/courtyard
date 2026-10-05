import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApiError,
  ProviderList,
  SessionEvent,
  SessionList,
  SessionSummary,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./providers/fake.ts";
import type { Provider } from "./providers/index.ts";
import { asOwner } from "./testing.ts";
import { createWorker } from "./worker.ts";

const FAKE = { provider: "fake", model: "echo" };

let root: string;
let now: number;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  now = Date.parse("2026-10-05T12:00:00Z");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const start = async (providers: Provider[] = [createFakeProvider({ delayMs: 0 })]) => {
  const worker = createWorker({
    env: { COURTYARD_CONTEXT_DIR: join(root, "context"), COURTYARD_DATA_DIR: join(root, "data") },
    now: () => now,
    providers,
  });
  if (!worker.ok) throw new Error(worker.error);
  const request = await asOwner(worker.value.app);
  const post = (path: string, body: unknown) =>
    request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { request, post };
};

type Api = Awaited<ReturnType<typeof start>>;

const startSession = async (api: Api, text: string, model = FAKE) => {
  const response = await api.post("/api/workspaces/garage-gym/sessions", { text, model });
  expect(response.status).toBe(201);
  return SessionSummary.parse(await response.json());
};

/** Reads a session's server-sent events until one of type `until` arrives. */
const readEvents = async (
  api: Api,
  sessionId: string,
  options: { until: SessionEvent["type"]; after?: number; onEvent?: (e: SessionEvent) => void },
) => {
  const response = await api.request(
    `/api/sessions/${sessionId}/events?after=${options.after ?? 0}`,
  );
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
  if (!reader) throw new Error("no event stream");

  const events: SessionEvent[] = [];
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`stream ended before ${options.until}`);
    buffer += value;
    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";
    for (const message of messages) {
      const data = message.split("\n").find((line) => line.startsWith("data: "));
      if (!data) continue;
      const event = SessionEvent.parse(JSON.parse(data.slice("data: ".length)));
      options.onEvent?.(event);
      events.push(event);
      if (event.type === options.until) {
        await reader.cancel();
        return events;
      }
    }
  }
};

/** A fake provider that holds each turn open until the test lets it finish. */
const gatedProvider = () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider = createFakeProvider({ delayMs: 0, beforeReply: () => gate });
  return { provider, release: () => release() };
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

    const session = await startSession(api, "Where should the rack go?");
    const events = await readEvents(api, session.id, { until: "turn-completed" });

    expect(session).toMatchObject({
      workspaceId: "garage-gym",
      title: "Where should the rack go?",
    });
    expect(events[0]).toMatchObject({
      seq: 1,
      type: "user-message",
      text: "Where should the rack go?",
    });
    const text = events.flatMap((e) => (e.type === "text-delta" ? [e.text] : [])).join("");
    expect(text).toBe("You said: Where should the rack go?");
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  });

  it("sends each event only after it's on disk", async () => {
    const api = await start();
    const session = await startSession(api, "Hello");
    const eventsFile = join(root, "data", "sessions", session.id, "events.jsonl");
    const onDiskWhenSent: boolean[] = [];

    await readEvents(api, session.id, {
      until: "turn-completed",
      onEvent: (event) => {
        // Checked synchronously as each event arrives, before anything else can write.
        const lines = readFileSync(eventsFile, "utf8").trim().split("\n");
        onDiskWhenSent.push(lines.some((line: string) => JSON.parse(line).seq === event.seq));
      },
    });

    expect(onDiskWhenSent.every(Boolean)).toBe(true);
  });

  it("keeps the session as plain files, one folder per session", async () => {
    const api = await start();
    const session = await startSession(api, "Hello");
    await readEvents(api, session.id, { until: "turn-completed" });

    const folder = join(root, "data", "sessions", session.id);
    const meta = JSON.parse(await readFile(join(folder, "session.json"), "utf8"));
    const lines = (await readFile(join(folder, "events.jsonl"), "utf8")).trim().split("\n");

    expect(meta).toMatchObject({ id: session.id, workspaceId: "garage-gym" });
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ seq: 1, type: "user-message" });
  });

  it("continues with later messages, numbering events without gaps", async () => {
    const api = await start();
    const session = await startSession(api, "First");
    const first = await readEvents(api, session.id, { until: "turn-completed" });

    const sent = await api.post(`/api/sessions/${session.id}/messages`, {
      text: "Second",
      model: FAKE,
    });
    expect(sent.status).toBe(202);
    const second = await readEvents(api, session.id, {
      until: "turn-completed",
      after: first.length,
    });

    expect(second[0]).toMatchObject({
      seq: first.length + 1,
      type: "user-message",
      text: "Second",
    });
    expect(second.map((e) => e.seq)).toEqual(second.map((_, i) => first.length + i + 1));
  });

  it("replays the whole history to anyone who opens it later", async () => {
    const api = await start();
    const session = await startSession(api, "First");
    const live = await readEvents(api, session.id, { until: "turn-completed" });

    const replayed = await readEvents(api, session.id, { until: "turn-completed" });

    expect(replayed).toEqual(live);
  });

  it("refuses a message while a turn is running", async () => {
    const gated = gatedProvider();
    const api = await start([gated.provider]);
    const session = await startSession(api, "Take your time");

    const busy = await api.post(`/api/sessions/${session.id}/messages`, {
      text: "Hurry",
      model: FAKE,
    });

    expect(busy.status).toBe(409);
    expect(ApiError.parse(await busy.json()).error).toMatch(/already/i);
    gated.release();
    await readEvents(api, session.id, { until: "turn-completed" });
    expect(
      (await api.post(`/api/sessions/${session.id}/messages`, { text: "Now", model: FAKE })).status,
    ).toBe(202);
  });

  it("records a failed turn with its reason in plain words", async () => {
    const api = await start();

    const session = await startSession(api, "please fail");
    const events = await readEvents(api, session.id, { until: "turn-failed" });

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
      model: FAKE,
    });

    expect(noModel.status).toBe(400);
    expect(empty.status).toBe(400);
  });

  it("refuses a session in a workspace that doesn't exist", async () => {
    const api = await start();

    const response = await api.post("/api/workspaces/no-such-place/sessions", {
      text: "Hi",
      model: FAKE,
    });

    expect(response.status).toBe(404);
  });
});

describe("a workspace's sessions", () => {
  it("are listed newest first", async () => {
    const api = await start();
    const older = await startSession(api, "Older");
    await readEvents(api, older.id, { until: "turn-completed" });
    now += 60_000;
    const newer = await startSession(api, "Newer");
    await readEvents(api, newer.id, { until: "turn-completed" });

    const response = await api.request("/api/workspaces/garage-gym/sessions");
    const { sessions } = SessionList.parse(await response.json());

    expect(sessions.map((s) => s.title)).toEqual(["Newer", "Older"]);
  });

  it("answer 404 for a session that doesn't exist", async () => {
    const api = await start();

    expect((await api.request("/api/sessions/not-a-session/events")).status).toBe(404);
  });
});
