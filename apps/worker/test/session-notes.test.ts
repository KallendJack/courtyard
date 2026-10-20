import { mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SessionEvent, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFakeProvider,
  type Framing,
  type OneOffInput,
  type Provider,
} from "../src/providers/index.ts";
import {
  asOwner,
  FAKE_MODEL,
  followSession,
  postJson,
  type Requester,
  removeTestFolder,
  testWorker,
} from "./testing.ts";

// The note a planning session leaves for the next sessions in its workspace (#601, ADR 0032):
// done · decided · next, written once it's been quiet for half an hour or another session starts,
// and given to every turn in the workspace after it.

let root: string;
let now: number;
/** The worker's repeating jobs, run when a test says, as time passing would. */
let jobs: (() => Promise<void>)[];

const MINUTE = 60 * 1000;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  await mkdir(join(root, "context", "padel"), { recursive: true });
  jobs = [];
  now = Date.parse("2026-10-19T09:00:00Z");
});

afterEach(async () => {
  await removeTestFolder(root);
});

/**
 * A worker on the fake, on the test's clock, with the owner logged in: what each turn was told,
 * and each note the errand model was asked for.
 */
const start = async (
  options: {
    /** Each note is written only once this resolves. */
    notesHeld?: Promise<void>;
    /** The worker's waits, which the test lets pass. */
    wait?: (ms: number) => Promise<void>;
  } = {},
) => {
  const framings: Framing[] = [];
  const asked: OneOffInput[] = [];
  const fake = createFakeProvider({ delayMs: 0, framed: (framing) => framings.push(framing) });
  const watched: Provider = {
    ...fake,
    answerOnce: async (input) => {
      if (input.purpose === "session-note") {
        asked.push(input);
        await options.notesHeld;
      }
      return fake.answerOnce(input);
    },
  };
  const request = await asOwner(
    testWorker({
      root,
      now: () => now,
      ...(options.wait === undefined ? {} : { wait: options.wait }),
      providers: [watched],
      repeat: (_everyMs, job) => {
        jobs.push(job);
      },
    }),
  );
  return { request, framings, asked };
};

/** Runs the worker's repeating jobs once, as time passing would. */
const timePasses = async () => {
  for (const job of jobs) await job();
};

/** Starts a session in the workspace and waits for its first answer and its title. */
const startSession = async (request: Requester, text: string, workspace = "garage-gym") => {
  const response = await postJson(request, `/api/workspaces/${workspace}/sessions`, {
    text,
    model: FAKE_MODEL,
  });
  expect(response.status).toBe(201);
  const { id } = SessionSummary.parse(await response.json());
  const events = await followSession(request, { sessionId: id, until: "session-titled" });
  return { id, events };
};

/** Sends a later message and waits for its turn to end. */
const send = async (
  request: Requester,
  session: { id: string; events: SessionEvent[] },
  text: string,
) => {
  await postJson(request, `/api/sessions/${session.id}/messages`, { text, model: FAKE_MODEL });
  const events = await followSession(request, {
    sessionId: session.id,
    until: "turn-completed",
    after: session.events.at(-1)?.seq ?? 0,
  });
  return { id: session.id, events: [...session.events, ...events] };
};

const noteOf = async (id: string) =>
  JSON.parse(await readFile(join(root, "data", "sessions", id, "note.json"), "utf8"));

/** The notes part of a turn's instructions, between its markers. */
const notesIn = (framing: Framing | undefined) =>
  /<session_notes>\n([\s\S]*?)\n<\/session_notes>/.exec(framing?.instructions ?? "")?.[1];

/** The answer a session's last turn wrote. */
const answerIn = (events: readonly SessionEvent[]) => {
  const from = events.findLastIndex((event) => event.type === "owner-message");
  return events
    .slice(from + 1)
    .map((event) => (event.type === "text-delta" ? event.text : ""))
    .join("");
};

describe("a planning session's note", () => {
  it("is written once the session has been quiet for 30 minutes, kept in the data folder, and the next session is given it", async () => {
    const { request, framings, asked } = await start();
    const first = await startSession(
      request,
      "Measured the wall. done: measured the back wall; decided: rack goes by the window; next: bolt it down",
    );

    now += 29 * MINUTE;
    await timePasses();
    expect(asked).toHaveLength(0);

    now += 2 * MINUTE;
    await timePasses();
    await timePasses();
    expect(asked).toHaveLength(1);
    expect(asked[0]?.message).toContain('The session: "Measured The Wall Done Measured"');
    expect(await noteOf(first.id)).toMatchObject({
      done: "measured the back wall",
      decided: "rack goes by the window",
      next: "bolt it down",
    });
    // Courtyard's own state: nothing new in the context folder.
    expect(await readdir(join(root, "context", "garage-gym"))).toEqual([]);

    await startSession(request, "What's next for the gym?");

    expect(asked).toHaveLength(1);
    const notes = notesIn(framings.at(-1));
    expect(notes).toBe(
      [
        `- "Measured The Wall Done Measured", last used Monday, 19 October 2026 (session ${first.id}):`,
        "  Done: measured the back wall",
        "  Decided: rack goes by the window",
        "  Next: bolt it down",
      ].join("\n"),
    );
    expect(framings.at(-1)?.tools.map((tool) => tool.name)).toContain("read_session");
  });

  it("is written when another session starts before then, and that session's first turn has it", async () => {
    const { request, framings, asked } = await start();
    const first = await startSession(request, "decided: flooring is 18 mm rubber");
    expect(framings.at(-1)?.tools.map((tool) => tool.name)).not.toContain("read_session");
    expect(notesIn(framings.at(-1))).toBeUndefined();

    now += 5 * MINUTE;
    await startSession(request, "How thick is the floor?");

    expect(asked).toHaveLength(1);
    expect(notesIn(framings.at(-1))).toContain(
      `(session ${first.id}):\n  Decided: flooring is 18 mm rubber`,
    );
  });

  it("waits at most 10 seconds for it: past that, the new session answers without it, and its next turn has it", async () => {
    let release = () => {};
    const notesHeld = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waits: number[] = [];
    let passTime = () => {};
    let waited = () => {};
    const waiting = new Promise<void>((resolve) => {
      waited = resolve;
    });
    const { request, framings } = await start({
      notesHeld,
      wait: (ms) =>
        new Promise((resolve) => {
          waits.push(ms);
          passTime = resolve;
          waited();
        }),
    });
    const first = await startSession(request, "decided: rack by the window");

    const response = await postJson(request, "/api/workspaces/garage-gym/sessions", {
      text: "Where were we?",
      model: FAKE_MODEL,
    });
    const second = { id: SessionSummary.parse(await response.json()).id, events: [] };
    await waiting;
    expect(waits).toEqual([10_000]);
    passTime();
    const answered = await followSession(request, {
      sessionId: second.id,
      until: "turn-completed",
    });
    expect(notesIn(framings.at(-1))).toBeUndefined();

    release();
    await send(request, { id: second.id, events: answered }, "And now?");
    expect(notesIn(framings.at(-1))).toContain(
      `(session ${first.id}):\n  Decided: rack by the window`,
    );
  });

  it("is written again when the session carries on later, from its note so far, and never given to the session itself", async () => {
    const { request, framings, asked } = await start();
    const first = await startSession(request, "decided: rack by the window; next: buy bolts");
    now += 31 * MINUTE;
    await timePasses();
    expect(asked).toHaveLength(1);

    now += 60 * MINUTE;
    await send(request, first, "Changed my mind. decided: rack against the back wall");
    expect(notesIn(framings.at(-1))).toBeUndefined();
    await timePasses();
    expect(asked).toHaveLength(1);

    now += 31 * MINUTE;
    await timePasses();
    expect(asked).toHaveLength(2);
    expect(asked[1]?.message).toContain(
      "Its note so far:\n<session_note>\nDecided: rack by the window\nNext: buy bolts\n</session_note>",
    );
    expect(await noteOf(first.id)).toMatchObject({
      decided: "rack against the back wall",
      next: "buy bolts",
    });
  });

  it("gives each turn the workspace's latest five notes, newest first, and never another workspace's", async () => {
    const { request, framings } = await start();
    const ids: string[] = [];
    for (const day of [1, 2, 3, 4, 5, 6]) {
      ids.push((await startSession(request, `decided: day ${day} plan`)).id);
      now += 31 * MINUTE;
    }
    await startSession(request, "decided: padel on Thursdays", "padel");

    await startSession(request, "Where were we?");

    const notes = notesIn(framings.at(-1)) ?? "";
    expect([...notes.matchAll(/\(session ([^)]+)\)/g)].map(([, id]) => id)).toEqual(
      ids.slice(1).reverse(),
    );
    expect(notes).not.toContain("padel");
  });

  it("isn't written for a session whose turns never completed", async () => {
    const { request, asked } = await start();
    const response = await postJson(request, "/api/workspaces/garage-gym/sessions", {
      text: "please fail",
      model: FAKE_MODEL,
    });
    const { id } = SessionSummary.parse(await response.json());
    await followSession(request, { sessionId: id, until: "turn-failed" });

    now += 31 * MINUTE;
    await timePasses();

    expect(asked).toHaveLength(0);
  });
});

describe("the read session tool", () => {
  it("opens an earlier session of the same workspace, what was said with none of what was done, and never another workspace's", async () => {
    const { request } = await start();
    const earlier = await startSession(
      request,
      "please read\nsave fact: Has a rack\ndecided: rack by the window",
    );
    const elsewhere = await startSession(request, "decided: padel on Thursdays", "padel");
    now += 31 * MINUTE;
    await timePasses();

    const reading = await startSession(
      request,
      `read session: ${earlier.id}\nread session: ${elsewhere.id}`,
    );

    const answer = answerIn(reading.events);
    expect(answer).toContain(
      `Session: The session "Please Read", last used Monday, 19 October 2026: what the owner said and your answers, oldest first.`,
    );
    expect(answer).toContain(
      "Owner: please read\nsave fact: Has a rack\ndecided: rack by the window\n\nYou: You said: please read",
    );
    expect(answer).not.toContain("CONTEXT.md");
    expect(answer).not.toContain("padel on Thursdays");
    expect(answer).toContain(
      `Session: There's no earlier session "${elsewhere.id}" in this workspace: the session notes give their ids.`,
    );
  });
});
