import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Capabilities,
  ProviderId,
  ProviderList,
  type SessionEvent,
  SessionSummary,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./providers/fake.ts";
import type { Provider } from "./providers/index.ts";
import { err } from "./result.ts";
import {
  asOwner,
  errorOf,
  FAKE_MODEL,
  followSession,
  postJson,
  type Requester,
  startSession,
  testWorker,
} from "./testing.ts";

// Overflow (spec, Overflow): a usage limit is remembered, and Carry on moves a session to another
// provider, only when the owner asks.

let root: string;
let clock: number;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  clock = Date.parse("2026-10-08T12:00:00.000Z");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const now = () => clock;
const HOUR = 60 * 60 * 1000;

/** The second fake, which "please hit Fake two's limit" sends to its usage limit. */
const SECOND_MODEL = { provider: "fake-two", model: "echo" };

const twoFakes = () => [
  createFakeProvider({ delayMs: 0, now }),
  createFakeProvider({ delayMs: 0, now, second: true }),
];

/** A provider that's there but not signed in, as Codex is before the owner signs in. */
const signedOut = (): Provider => {
  const id = ProviderId.parse("away");
  const capabilities: Capabilities = {
    readsFiles: false,
    codes: false,
    usesTools: false,
    savesContext: false,
  };
  return {
    id,
    capabilities,
    status: async () => ({
      id,
      label: "Away",
      available: false,
      reason: "Away isn't signed in.",
      signedOut: true,
    }),
    runTurn: async () => err({ kind: "provider-unavailable", message: "Not signed in." }),
    answerOnce: async () => err({ kind: "provider-unavailable", message: "Not signed in." }),
  };
};

const start = async (providers: readonly Provider[] = twoFakes()) =>
  asOwner(testWorker({ root, providers, now }));

const limitsIn = async (request: Requester) => {
  const { providers } = ProviderList.parse(await (await request("/api/providers")).json());
  return Object.fromEntries(
    providers.map((provider) => [
      provider.id,
      provider.available ? provider.models[0]?.limit : "unavailable",
    ]),
  );
};

/** Starts a session whose first turn hits the second fake's usage limit, and waits for it. */
const hitLimit = async (request: Requester, model = SECOND_MODEL) => {
  const words = model.provider === "fake" ? "Fake's" : "Fake two's";
  const session = await startSession(request, `please hit ${words} limit`, model);
  const events = await followSession(request, { sessionId: session.id, until: "turn-failed" });
  const turn = events.find((event) => event.type === "owner-message")?.seq ?? 0;
  return { session, events, turn };
};

const carryOn = (request: Requester, sessionId: string, turn: number) =>
  postJson(request, `/api/sessions/${sessionId}/carry-on`, { turn });

describe("a usage limit", () => {
  it("fails the turn with its reset time, and is reported on the provider's models until then", async () => {
    const request = await start();

    const { events } = await hitLimit(request);

    const resetAt = new Date(clock + 2 * HOUR).toISOString();
    expect(events.at(-1)).toMatchObject({
      type: "turn-failed",
      reason: { kind: "rate-limited", resetAt },
    });
    expect(await limitsIn(request)).toEqual({ fake: undefined, "fake-two": { resetAt } });

    clock += 2 * HOUR;
    expect(await limitsIn(request)).toEqual({ fake: undefined, "fake-two": undefined });
  });

  it("is forgotten once a turn on that provider completes, since a reset time can be an estimate", async () => {
    const request = await start();
    const { session, events } = await hitLimit(request);

    await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "Try again",
      model: SECOND_MODEL,
    });
    await followSession(request, {
      sessionId: session.id,
      after: events.length,
      until: "turn-completed",
    });

    expect(await limitsIn(request)).toEqual({ fake: undefined, "fake-two": undefined });
  });
});

describe("Carry on", () => {
  it("records the model change and sends the message again to the other provider's default model, at its default effort", async () => {
    const request = await start();
    const session = await startSession(request, "Where should the rack go?", SECOND_MODEL);
    const first = await followSession(request, { sessionId: session.id, until: "turn-completed" });
    await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "please hit Fake two's limit",
      model: SECOND_MODEL,
      effort: "high",
    });
    const failed = await followSession(request, {
      sessionId: session.id,
      after: first.length,
      until: "turn-failed",
    });
    const turn = failed.find((event) => event.type === "owner-message")?.seq ?? 0;

    const response = await carryOn(request, session.id, turn);

    expect(response.status).toBe(202);
    const carried = await followSession(request, {
      sessionId: session.id,
      after: first.length + failed.length,
      until: "turn-completed",
    });
    expect(carried[0]).toMatchObject({ type: "model-changed", model: FAKE_MODEL });
    // Sent at the model's default effort: no effort recorded.
    expect(carried[1]).toEqual({
      seq: expect.any(Number),
      at: expect.any(String),
      type: "owner-message",
      text: "please hit Fake two's limit",
      model: FAKE_MODEL,
    });
    const answer = carried.flatMap((event) => (event.type === "text-delta" ? [event.text] : []));
    expect(answer.join("")).toBe("You said: please hit Fake two's limit");
  });

  it("is refused when the other provider is at its limit too", async () => {
    const request = await start();
    await hitLimit(request, FAKE_MODEL);
    const { session, turn } = await hitLimit(request);

    const response = await carryOn(request, session.id, turn);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/Fake is at its usage limit too/);
  });

  it("is refused when the other provider isn't signed in, and says where to sign in", async () => {
    const request = await start([
      createFakeProvider({ delayMs: 0, now, second: true }),
      signedOut(),
    ]);
    const { session, turn } = await hitLimit(request);

    const response = await carryOn(request, session.id, turn);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/Away isn't signed in.*home page/);
  });

  it("is refused for a turn that didn't hit a usage limit", async () => {
    const request = await start();
    const session = await startSession(request, "Where should the rack go?", SECOND_MODEL);
    const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });
    const turn = events.find((event) => event.type === "owner-message")?.seq ?? 0;

    const response = await carryOn(request, session.id, turn);

    expect(response.status).toBe(409);
  });

  it("is refused once the session has moved on from the turn", async () => {
    const request = await start();
    const { session, turn, events } = await hitLimit(request);
    await carryOn(request, session.id, turn);
    await followSession(request, {
      sessionId: session.id,
      after: events.length,
      until: "turn-completed",
    });

    const again = await carryOn(request, session.id, turn);

    expect(again.status).toBe(409);
  });
});

describe("a new session with no model named", () => {
  const ownerModel = async (request: Requester) => {
    const response = await postJson(request, "/api/workspaces/garage-gym/sessions", {
      text: "Where should the rack go?",
    });
    expect(response.status).toBe(201);
    const { id } = SessionSummary.parse(await response.json());
    const events: SessionEvent[] = await followSession(request, {
      sessionId: id,
      until: "turn-completed",
    });
    const message = events.find((event) => event.type === "owner-message");
    return message?.type === "owner-message" ? message.model : undefined;
  };

  it("starts on the first model", async () => {
    const request = await start();

    expect(await ownerModel(request)).toEqual(FAKE_MODEL);
  });

  it("starts on the first model that isn't at its limit", async () => {
    const request = await start();
    await hitLimit(request, FAKE_MODEL);

    expect(await ownerModel(request)).toEqual(SECOND_MODEL);
  });
});
