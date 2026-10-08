import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Effort, ProviderList, type SessionEvent, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./providers/fake.ts";
import {
  asOwner,
  errorOf,
  FAKE_MODEL,
  followSession,
  postJson,
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

/** A worker on the fake, and the effort each of its turns was asked for. */
const start = async () => {
  const heard: (Effort | undefined)[] = [];
  const provider = createFakeProvider({
    delayMs: 0,
    heard: (turn) => {
      heard.push(turn.effort);
    },
  });
  const request = await asOwner(testWorker({ root, providers: [provider] }));
  return { request, heard };
};

const ownerMessages = (events: SessionEvent[]) =>
  events.flatMap((event) => (event.type === "owner-message" ? [event] : []));

describe("effort", () => {
  it("is listed with each model: the levels it takes, and its default", async () => {
    const { request } = await start();

    const { providers } = ProviderList.parse(await (await request("/api/providers")).json());

    const fake = providers[0];
    if (!fake?.available) throw new Error("expected the fake to be available");
    expect(fake.models[0]).toMatchObject({
      efforts: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
      ],
      defaultEffort: "medium",
    });
  });

  it("is recorded with the owner's message and reaches the model", async () => {
    const { request, heard } = await start();

    const response = await postJson(request, "/api/workspaces/garage-gym/sessions", {
      text: "Plan the whole garage",
      model: FAKE_MODEL,
      effort: "high",
    });
    expect(response.status).toBe(201);
    const { id } = SessionSummary.parse(await response.json());
    const events = await followSession(request, { sessionId: id, until: "turn-completed" });

    expect(ownerMessages(events)).toEqual([
      expect.objectContaining({ model: FAKE_MODEL, effort: "high" }),
    ]);
    expect(heard).toEqual(["high"]);
  });

  it("is left out for the model's default, and the model is asked for none", async () => {
    const { request, heard } = await start();

    const session = await startSession(request, "Where should the rack go?");
    const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });

    expect(ownerMessages(events)[0]).not.toHaveProperty("effort");
    expect(heard).toEqual([undefined]);
  });

  it("gives back the last model and effort from the session's events", async () => {
    const { request } = await start();
    const session = await startSession(request, "Where should the rack go?");
    const first = await followSession(request, { sessionId: session.id, until: "turn-completed" });

    const sent = await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "Think harder about it",
      model: FAKE_MODEL,
      effort: "low",
    });
    expect(sent.status).toBe(202);
    const second = await followSession(request, {
      sessionId: session.id,
      after: first.length,
      until: "turn-completed",
    });
    // Everything the session's page replays, from the start.
    const events = [...first, ...second];

    expect(ownerMessages(events).at(-1)).toMatchObject({ model: FAKE_MODEL, effort: "low" });
  });

  it("refuses a level the model doesn't take", async () => {
    const { request, heard } = await start();
    const session = await startSession(request, "Where should the rack go?");
    await followSession(request, { sessionId: session.id, until: "turn-completed" });

    const sent = await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "Think as hard as you can",
      model: FAKE_MODEL,
      effort: "max",
    });
    const started = await postJson(request, "/api/workspaces/garage-gym/sessions", {
      text: "Think as hard as you can",
      model: FAKE_MODEL,
      effort: "max",
    });

    expect(sent.status).toBe(400);
    expect(await errorOf(sent)).toMatch(/doesn't take that effort/);
    expect(started.status).toBe(400);
    expect(heard).toEqual([undefined]);
  });

  it("is always the default when getting to know a workspace", async () => {
    const { request, heard } = await start();

    const response = await postJson(request, "/api/workspaces/garage-gym/get-to-know", {
      model: FAKE_MODEL,
    });
    const { id } = SessionSummary.parse(await response.json());
    await followSession(request, { sessionId: id, until: "turn-completed" });

    expect(heard).toEqual([undefined]);
  });
});
