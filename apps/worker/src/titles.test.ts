import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FailureReason, SessionEvent, SessionList, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider, type OneOffInput, type Provider } from "./providers/index.ts";
import { ok, type Result } from "./result.ts";
import {
  asOwner,
  FAKE_MODEL,
  FAKE_TWO_MODEL,
  followSession,
  gatedProvider,
  postJson,
  type Requester,
  renameSession,
  startSession,
  testWorker,
} from "./testing.ts";

// A session's title after its first answer (spec story 104, docs/ai-conduct.md Titling a session).

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

/**
 * A provider whose one-off questions are kept, and answered by `answer` (the provider's own when
 * left out). `answered(n)` resolves once n have been answered and the worker has queued what it
 * does with the answer.
 */
const watching = (
  provider: Provider,
  answer: (input: OneOffInput) => Promise<Result<unknown, FailureReason>> = provider.answerOnce,
) => {
  const asked: OneOffInput[] = [];
  const waiting = new Set<() => void>();
  let count = 0;
  const watched: Provider = {
    ...provider,
    answerOnce: async (input) => {
      asked.push(input);
      const answered = await answer(input);
      // A moment later, so the worker has had the answer and queued its write.
      setImmediate(() => {
        count += 1;
        for (const check of waiting) check();
      });
      return answered;
    },
  };
  const answered = (times: number) =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (count < times) return;
        waiting.delete(check);
        resolve();
      };
      waiting.add(check);
      check();
    });
  return { provider: watched, asked, answered };
};

const fake = () => createFakeProvider({ delayMs: 0 });

/** The session's title as its page loads it. */
const titleOf = async (request: Requester, id: string) =>
  SessionSummary.parse(await (await request(`/api/sessions/${id}`)).json()).title;

/** The title a model gave the session, once it's recorded. */
const titledAs = async (request: Requester, id: string) => {
  const events = await followSession(request, { sessionId: id, until: "session-titled" });
  const titled = events.at(-1);
  return titled?.type === "session-titled" ? titled.title : undefined;
};

const listedTitles = async (request: Requester) =>
  SessionList.parse(
    await (await request("/api/workspaces/garage-gym/sessions")).json(),
  ).sessions.map((session) => session.title);

/** Sends a later message and waits for its turn to end: events after `after` are its own. */
const sendAndFinish = async (
  request: Requester,
  send: { sessionId: string; text: string; after: SessionEvent[] },
) => {
  const { sessionId, text, after } = send;
  await postJson(request, `/api/sessions/${sessionId}/messages`, { text, model: FAKE_MODEL });
  return followSession(request, {
    sessionId,
    until: "turn-completed",
    after: after.at(-1)?.seq ?? 0,
  });
};

const titledEvents = (events: readonly SessionEvent[]) =>
  events.filter((event) => event.type === "session-titled");

/** Every event the session has recorded, once anything queued for it has been written. */
const allEvents = async (request: Requester, id: string) => {
  // Loading the session waits for its queue.
  await request(`/api/sessions/${id}`);
  const log = await readFile(join(root, "data", "sessions", id, "events.jsonl"), "utf8");
  return log
    .trim()
    .split("\n")
    .map((line) => SessionEvent.parse(JSON.parse(line)));
};

describe("a new session's title", () => {
  it("becomes the model's short title once the first answer is in, recorded as an event", async () => {
    const request = await asOwner(testWorker({ root, providers: [fake()] }));

    const session = await startSession(request, "Where should the rack go?");
    const events = await followSession(request, {
      sessionId: session.id,
      until: "session-titled",
    });

    expect(session.title).toBe("Where should the rack go?");
    expect(events.at(-2)?.type).toBe("turn-completed");
    expect(events.at(-1)).toMatchObject({
      type: "session-titled",
      title: "Where Should The Rack Go",
    });
    expect(await titleOf(request, session.id)).toBe("Where Should The Rack Go");
    expect(await listedTitles(request)).toEqual(["Where Should The Rack Go"]);
  });

  it("tells the model the owner's first message and the start of the answer", async () => {
    const watched = watching(fake());
    const request = await asOwner(testWorker({ root, providers: [watched.provider] }));

    await startSession(request, "Where should the rack go?");
    await watched.answered(1);

    expect(watched.asked[0]?.purpose).toBe("title");
    expect(watched.asked[0]?.message).toContain("Where should the rack go?");
    expect(watched.asked[0]?.message).toContain("You said: Where should the rack go?");
  });

  it("asks the first model not at its usage limit, at its lowest effort", async () => {
    const first = watching(fake());
    const second = watching(createFakeProvider({ delayMs: 0, second: true }));
    const request = await asOwner(
      testWorker({ root, providers: [first.provider, second.provider] }),
    );
    const limited = await startSession(request, "please hit Fake's limit");
    await followSession(request, { sessionId: limited.id, until: "turn-failed" });

    const session = await startSession(request, "Where should the rack go?", FAKE_TWO_MODEL);
    await second.answered(1);

    expect(first.asked).toEqual([]);
    expect(second.asked[0]).toMatchObject({ purpose: "title", model: "echo", effort: "low" });
    expect(await titledAs(request, session.id)).toBe("Where Should The Rack Go");
  });

  it("asks the first model on offer, whichever answered the session", async () => {
    const first = watching(fake());
    const second = watching(createFakeProvider({ delayMs: 0, second: true }));
    const request = await asOwner(
      testWorker({ root, providers: [first.provider, second.provider] }),
    );

    await startSession(request, "Where should the rack go?", FAKE_TWO_MODEL);
    await first.answered(1);

    expect(first.asked[0]).toMatchObject({ purpose: "title", effort: "low" });
    expect(second.asked).toEqual([]);
  });

  it("comes after the first answer when the first message carried on to another provider", async () => {
    const request = await asOwner(
      testWorker({ root, providers: [fake(), createFakeProvider({ delayMs: 0, second: true })] }),
    );
    const session = await startSession(
      request,
      "Where should the rack go? please hit Fake's limit",
    );
    const failed = await followSession(request, { sessionId: session.id, until: "turn-failed" });

    await postJson(request, `/api/sessions/${session.id}/carry-on`, { turn: 1 });
    const events = await followSession(request, {
      sessionId: session.id,
      until: "session-titled",
      after: failed.at(-1)?.seq ?? 0,
    });

    expect(events.map((event) => event.type)).toContain("turn-completed");
    expect(events.at(-1)).toMatchObject({ title: "Where Should The Rack Go" });
  });

  it("is never changed by a later turn", async () => {
    const watched = watching(fake());
    const request = await asOwner(testWorker({ root, providers: [watched.provider] }));
    const session = await startSession(request, "Where should the rack go?");
    const first = await followSession(request, { sessionId: session.id, until: "session-titled" });

    await sendAndFinish(request, { sessionId: session.id, text: "And the bench?", after: first });

    expect(watched.asked).toHaveLength(1);
    expect(titledEvents(await allEvents(request, session.id))).toHaveLength(1);
    expect(await titleOf(request, session.id)).toBe("Where Should The Rack Go");
  });
});

describe("a title the owner set", () => {
  it("is kept when they renamed the session before the first answer was in", async () => {
    const { provider, release } = gatedProvider();
    const watched = watching(provider);
    const request = await asOwner(testWorker({ root, providers: [watched.provider] }));
    const session = await startSession(request, "Where should the rack go?");

    expect((await renameSession(request, session.id, "Rack position")).status).toBe(200);
    release();
    const first = await followSession(request, { sessionId: session.id, until: "turn-completed" });
    await sendAndFinish(request, { sessionId: session.id, text: "And the bench?", after: first });

    expect(titledEvents(await allEvents(request, session.id))).toEqual([]);
    expect(await titleOf(request, session.id)).toBe("Rack position");
  });

  it("wins over the model's, when they rename while the model is still answering", async () => {
    let answerNow: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      answerNow = resolve;
    });
    let asking: () => void = () => {};
    const asked = new Promise<void>((resolve) => {
      asking = resolve;
    });
    const base = fake();
    const watched = watching(base, async (input) => {
      asking();
      await held;
      return base.answerOnce(input);
    });
    const request = await asOwner(testWorker({ root, providers: [watched.provider] }));
    const session = await startSession(request, "Where should the rack go?");

    await asked;
    expect((await renameSession(request, session.id, "Rack position")).status).toBe(200);
    answerNow();
    await watched.answered(1);

    expect(titledEvents(await allEvents(request, session.id))).toEqual([]);
    expect(await titleOf(request, session.id)).toBe("Rack position");
  });
});

describe("a session that keeps its first line as its title", () => {
  it("is a Get to know session, whose starter's first line is its title", async () => {
    const watched = watching(fake());
    const request = await asOwner(testWorker({ root, providers: [watched.provider] }));
    const response = await postJson(request, "/api/workspaces/garage-gym/get-to-know", {
      model: FAKE_MODEL,
    });
    const session = SessionSummary.parse(await response.json());
    const first = await followSession(request, { sessionId: session.id, until: "turn-completed" });

    await sendAndFinish(request, {
      sessionId: session.id,
      text: "It's for lifting.",
      after: first,
    });

    expect(watched.asked).toEqual([]);
    expect(await titleOf(request, session.id)).toBe("Get to know this workspace.");
  });

  it("is one whose first turn failed or was stopped", async () => {
    const watched = watching(fake());
    const request = await asOwner(testWorker({ root, providers: [watched.provider] }));
    const failed = await startSession(request, "Where should the rack go? please fail");
    const ended = await followSession(request, { sessionId: failed.id, until: "turn-failed" });

    await sendAndFinish(request, { sessionId: failed.id, text: "And the bench?", after: ended });

    expect(watched.asked).toEqual([]);
    expect(await titleOf(request, failed.id)).toBe("Where should the rack go? please fail");
  });

  it("is one whose first turn the owner stopped", async () => {
    const { provider } = gatedProvider();
    const watched = watching(provider);
    const request = await asOwner(testWorker({ root, providers: [watched.provider] }));
    const session = await startSession(request, "Where should the rack go?");

    await postJson(request, `/api/sessions/${session.id}/stop`, { turn: 1 });
    const ended = await followSession(request, { sessionId: session.id, until: "turn-stopped" });
    await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "And the bench?",
      model: FAKE_MODEL,
    });
    await postJson(request, `/api/sessions/${session.id}/stop`, {
      turn: (ended.at(-1)?.seq ?? 0) + 1,
    });
    await followSession(request, {
      sessionId: session.id,
      until: "turn-stopped",
      after: ended.at(-1)?.seq ?? 0,
    });

    expect(watched.asked).toEqual([]);
    expect(await titleOf(request, session.id)).toBe("Where should the rack go?");
  });

  it("is one whose titling failed, came back empty or in the wrong shape, with no error shown", async () => {
    const answers: Result<unknown, FailureReason>[] = [
      { ok: false, error: { kind: "unknown", message: "Failed on purpose." } },
      ok({ title: "  " }),
      ok({ name: "Rack" }),
    ];
    const watched = watching(fake(), async () => answers.shift() ?? ok({ title: "Spare" }));
    const request = await asOwner(testWorker({ root, providers: [watched.provider] }));

    const sessions = [];
    for (const text of ["Failed", "Empty", "Wrong shape"]) {
      const session = await startSession(request, text);
      await watched.answered(sessions.length + 1);
      sessions.push(session);
    }

    for (const session of sessions) {
      expect(titledEvents(await allEvents(request, session.id))).toEqual([]);
      expect(await titleOf(request, session.id)).toBe(session.title);
    }
  });

  it("is one whose titling the fake fails on purpose", async () => {
    const watched = watching(fake());
    const request = await asOwner(testWorker({ root, providers: [watched.provider] }));

    const session = await startSession(request, "Where should the rack go? no title please");
    await watched.answered(1);

    expect(titledEvents(await allEvents(request, session.id))).toEqual([]);
    expect(await titleOf(request, session.id)).toBe("Where should the rack go? no title please");
  });
});

describe("the model's title", () => {
  it("is tidied: one line, no quotes or full stop, and no longer than a title can be", async () => {
    const titles = [`"Rack position."`, "Rack\nposition", "x".repeat(80)];
    const watched = watching(fake(), async () => ok({ title: titles.shift() ?? "" }));
    const request = await asOwner(testWorker({ root, providers: [watched.provider] }));

    const got: (string | undefined)[] = [];
    for (const text of ["One", "Two", "Three"]) {
      const session = await startSession(request, text);
      got.push(await titledAs(request, session.id));
    }

    expect(got).toEqual(["Rack position", "Rack position", `${"x".repeat(59)}…`]);
  });
});
