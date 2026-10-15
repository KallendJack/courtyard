import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEvent } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider, type Provider } from "./agent/providers/index.ts";
import {
  codeRepo,
  codeWorkspace,
  FAKE_MODEL,
  FAKE_TWO_MODEL,
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

// Steer while it answers (#252): a message the owner sends while a turn runs goes into that
// answer, where it was sent, on a provider that can take it mid-turn; the model reads it at its
// next step. A provider that can't steer queues it, as before (#177).

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
});

afterEach(async () => {
  await removeTestFolder(root);
});

const startWorker = async (providers: Provider[]) => {
  const app = testWorker({ root, providers });
  return requesterFor(app, await setUpOwner(app));
};

const send = (request: Requester, sessionId: string, text: string, model = FAKE_MODEL) =>
  postJson(request, `/api/sessions/${sessionId}/messages`, { text, model });

const answerOf = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "text-delta" ? [event.text] : [])).join("");

/** The session's events, in order, without the answer's pieces. */
const typesOf = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "text-delta" ? [] : [event.type]));

describe("a message sent while it answers", () => {
  it("goes into the answer, where it was sent, and the answer carries on from it", async () => {
    const request = await startWorker([createFakeProvider({ delayMs: 0 })]);
    // The fake waits for what the owner adds, then says it noted it.
    const session = await startSession(request, "wait for more");
    await followSession(request, { sessionId: session.id, until: "owner-message" });

    expect((await send(request, session.id, "Use the blue one")).status).toBe(202);
    const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });

    expect(typesOf(events)).toEqual(["owner-message", "message-added", "turn-completed"]);
    expect(events.find((event) => event.type === "message-added")).toMatchObject({
      text: "Use the blue one",
    });
    expect(answerOf(events)).toContain("noted: Use the blue one");
    // The answer to it comes after it, in the same turn.
    const added = events.findIndex((event) => event.type === "message-added");
    const noted = events.findIndex(
      (event) => event.type === "text-delta" && event.text.includes("noted"),
    );
    expect(noted).toBeGreaterThan(added);
  });

  it("added before the model gets to it, is still answered in the same reply", async () => {
    const gated = gatedProvider({ steers: true });
    const request = await startWorker([gated.provider]);
    const session = await startSession(request, "Take your time");
    await gated.held;

    await send(request, session.id, "And mind the step");
    await followSession(request, { sessionId: session.id, until: "message-added" });
    gated.release();
    const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });

    expect(typesOf(events)).toEqual(["owner-message", "message-added", "turn-completed"]);
    expect(answerOf(events)).toContain("noted: And mind the step");
  });

  it("is queued instead on a provider that can't steer, going when the answer ends", async () => {
    const gated = gatedProvider({ steers: false });
    const request = await startWorker([gated.provider]);
    const session = await startSession(request, "Take your time");

    await send(request, session.id, "Then this");
    await followSession(request, { sessionId: session.id, until: "message-queued" });
    gated.release();
    let completed = 0;
    const events = await followSession(request, {
      sessionId: session.id,
      until: (event) => event.type === "turn-completed" && ++completed === 2,
    });

    expect(typesOf(events)).not.toContain("message-added");
    expect(events.filter((event) => event.type === "owner-message")).toHaveLength(2);
  });

  it("is queued when it asks for another model, which this answer can't change to", async () => {
    const gated = gatedProvider({ steers: true });
    const request = await startWorker([
      gated.provider,
      createFakeProvider({ delayMs: 0, second: true }),
    ]);
    const session = await startSession(request, "Take your time");
    await gated.held;

    await send(request, session.id, "Over to you", FAKE_TWO_MODEL);
    const events = await followSession(request, {
      sessionId: session.id,
      until: "message-queued",
    });
    gated.release();

    expect(typesOf(events)).not.toContain("message-added");
  });

  it("after Stop, one the model hadn't read is marked so, and nothing starts on its own", async () => {
    const gated = gatedProvider({ steers: true });
    const request = await startWorker([gated.provider]);
    const session = await startSession(request, "Take your time");
    await gated.held;
    await send(request, session.id, "Actually, the other one");
    const added = (
      await followSession(request, { sessionId: session.id, until: "message-added" })
    ).at(-1);

    await postJson(request, `/api/sessions/${session.id}/stop`, { turn: 1 });
    const events = await followSession(request, {
      sessionId: session.id,
      until: "added-not-read",
    });
    gated.release();

    expect(typesOf(events)).toEqual(["owner-message", "message-added", "added-not-read"]);
    expect(events.at(-1)).toMatchObject({ type: "added-not-read", added: added?.seq });
    expect(
      typesOf(await followSession(request, { sessionId: session.id, until: "turn-stopped" })),
    ).toContain("turn-stopped");
    // It never went as a turn of its own: the next turn is the owner's next message.
    await send(request, session.id, "Start again");
    const after = await followSession(request, { sessionId: session.id, until: "turn-completed" });
    expect(after.flatMap((event) => (event.type === "owner-message" ? [event.text] : []))).toEqual([
      "Take your time",
      "Start again",
    ]);
  });

  it("one the answer finished without reading still gets answered, next", async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let holding: () => void = () => {};
    const isHeld = new Promise<void>((resolve) => {
      holding = resolve;
    });
    const fake = createFakeProvider({
      delayMs: 0,
      beforeReply: async () => {
        holding();
        await held;
      },
    });
    // It takes added messages, but this turn ends without reading one.
    const deaf: Provider = {
      ...fake,
      capabilities: { ...fake.capabilities, steers: true },
      runTurn: (input) => fake.runTurn({ ...input, added: null }),
    };
    const request = await startWorker([deaf]);
    const session = await startSession(request, "Take your time");
    await isHeld;
    await send(request, session.id, "Did you get this?");
    await followSession(request, { sessionId: session.id, until: "message-added" });

    release();
    let completed = 0;
    const events = await followSession(request, {
      sessionId: session.id,
      until: (event) => event.type === "turn-completed" && ++completed === 2,
    });

    expect(typesOf(events).filter((type) => type !== "session-titled")).toEqual([
      "owner-message",
      "message-added",
      "added-not-read",
      "turn-completed",
      "message-queued",
      "owner-message",
      "turn-completed",
    ]);
    expect(answerOf(events)).toContain("You said: Did you get this?");
  });

  it("one the model never read is told to the next turn's model as not read", async () => {
    const told: string[] = [];
    const request = await startWorker([
      createFakeProvider({
        delayMs: 0,
        framed: (framing) => told.push(framing.message),
        // The first turn is held until it's stopped; the next answers at once.
        beforeReply: (signal) =>
          told.length > 1
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                signal.addEventListener("abort", () => resolve(), { once: true });
              }),
      }),
    ]);
    const session = await startSession(request, "Take your time");
    await followSession(request, { sessionId: session.id, until: "owner-message" });
    await send(request, session.id, "Actually, the other one");
    await followSession(request, { sessionId: session.id, until: "message-added" });
    await postJson(request, `/api/sessions/${session.id}/stop`, { turn: 1 });
    await followSession(request, { sessionId: session.id, until: "turn-stopped" });

    await send(request, session.id, "Start again");
    let completed = 0;
    await followSession(request, {
      sessionId: session.id,
      until: (event) => event.type === "turn-completed" && ++completed === 1,
    });

    expect(told.at(-1)).toContain(
      "Owner (while you answered, though the turn ended before you read it): Actually, the other one",
    );
  });

  it("is in the conversation the next turn's model is told, where it was sent", async () => {
    const told: string[] = [];
    const request = await startWorker([
      createFakeProvider({ delayMs: 0, framed: (framing) => told.push(framing.message) }),
    ]);
    const session = await startSession(request, "wait for more");
    await followSession(request, { sessionId: session.id, until: "owner-message" });
    await send(request, session.id, "Use the blue one");
    await followSession(request, { sessionId: session.id, until: "turn-completed" });

    await send(request, session.id, "What did I say?");
    let completed = 0;
    await followSession(request, {
      sessionId: session.id,
      until: (event) => event.type === "turn-completed" && ++completed === 2,
    });

    const conversation = told.at(-1) ?? "";
    expect(conversation).toContain("Owner: wait for more");
    expect(conversation).toContain("Owner (while you answered): Use the blue one");
    expect(conversation.indexOf("while you answered")).toBeLessThan(
      conversation.indexOf("noted: Use the blue one"),
    );
  });
});

describe("a message sent while an approval waits", () => {
  it("goes in after the owner's OK, marked so, and never answers the approval", async () => {
    const { repo } = await codeRepo(root);
    await codeWorkspace(root, "side-project", repo);
    const request = await startWorker([createFakeProvider({ delayMs: 0 })]);
    const started = await postJson(request, "/api/workspaces/side-project/sessions", {
      text: "run command: make tea\nwait for more",
      model: FAKE_MODEL,
    });
    const { id } = (await started.json()) as { id: string };
    const asked = (await followSession(request, { sessionId: id, until: "approval-requested" })).at(
      -1,
    );

    await send(request, id, "Two sugars");
    const added = (await followSession(request, { sessionId: id, until: "message-added" })).at(-1);
    expect(added).toMatchObject({ type: "message-added", text: "Two sugars", afterApproval: true });

    await postJson(request, `/api/sessions/${id}/approvals/${asked?.seq}`, { answer: "deny" });
    const events = await followSession(request, { sessionId: id, until: "turn-completed" });
    expect(answerOf(events)).toContain("noted: Two sugars");
  });
});
