import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CodeSessionList,
  GitHubConnection,
  NeedsYou,
  type SessionEvent,
  SessionSummary,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "../src/providers/fake.ts";
import {
  codeRepo,
  codeWorkspace,
  createFakeGitHub,
  errorOf,
  FAKE_MODEL,
  type FakeGitHub,
  followSession,
  postJson,
  type Requester,
  removeTestFolder,
  requesterFor,
  setUpOwner,
  testWorker,
} from "./testing.ts";

// A builder waiting on you (#541): one that asked a question, failed its turn, or stopped with no
// pull request waits on the owner until they answer, whatever they've read and however long it
// takes. A question with set choices is answered with one tap, from Needs you.

let root: string;
let now: number;
/** The repository on GitHub, as `owner/name`: what the code workspace's remote names. */
let onGitHub: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  const { repo, github } = await codeRepo(root);
  onGitHub = github;
  await codeWorkspace(root, "side-project", repo, { name: "Side project" });
  now = Date.parse("2026-10-19T18:00:00Z");
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** A worker on the fake, with the owner signed in. */
const start = async () => {
  const app = testWorker({
    root,
    now: () => now,
    providers: [createFakeProvider({ delayMs: 0 })],
  });
  return requesterFor(app, await setUpOwner(app));
};

/** The session as its workspace's list says. */
const listedOf = async (request: Requester, id: string) => {
  const response = await request("/api/workspaces/side-project/sessions");
  const { sessions } = CodeSessionList.parse(await response.json());
  return sessions.find((session) => session.id === id);
};

const lastSeq = (events: readonly SessionEvent[]) => events.at(-1)?.seq ?? 0;

/** Starts a code session on the fake and follows its first turn to its end. */
const answered = async (
  request: Requester,
  text: string,
  until: "turn-completed" | "turn-failed" = "turn-completed",
) => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text,
    model: FAKE_MODEL,
  });
  const { id } = SessionSummary.parse(await response.json());
  const events = await followSession(request, { sessionId: id, until });
  return { id, seq: lastSeq(events) };
};

const ASKS = [
  "Should I rerun the unit tests?",
  "ask owner: How should I rerun the unit tests? | Report in my folder | Skip, open the PR",
].join("\n");

describe("a session that asks with set choices", () => {
  it("waits on the owner with its question until they answer, whatever they've read", async () => {
    const request = await start();
    const { id, seq } = await answered(request, ASKS);

    await postJson(request, `/api/sessions/${id}/seen`, { upTo: seq });
    await postJson(request, "/api/workspaces/side-project/seen", {});
    now += 3 * 24 * 60 * 60 * 1000;

    const listed = await listedOf(request, id);
    expect(listed?.waiting).toBe("asked");
    expect(listed?.question).toEqual({
      text: "How should I rerun the unit tests?",
      choices: ["Report in my folder", "Skip, open the PR"],
      asked: expect.any(Number),
    });
    expect(listed?.seen).toBe(true);
    const { needs } = NeedsYou.parse(await (await request("/api/needs-you")).json());
    expect(needs).toEqual([
      expect.objectContaining({
        kind: "asked",
        session: { id, title: expect.any(String) },
        question: listed?.question,
        seen: true,
      }),
    ]);
  });

  it("is answered with one tap: the choice goes as the owner's message, and the session carries on", async () => {
    const request = await start();
    const { id, seq } = await answered(request, ASKS);
    const asked = (await listedOf(request, id))?.question?.asked;

    const tapped = await postJson(request, `/api/sessions/${id}/answer`, { asked, choice: 1 });

    expect(tapped.status).toBe(202);
    const events = await followSession(request, {
      sessionId: id,
      after: seq,
      until: "turn-completed",
    });
    expect(events[0]).toMatchObject({
      type: "owner-message",
      text: "Skip, open the PR",
      model: FAKE_MODEL,
    });
    expect((await listedOf(request, id))?.waiting).toBe("reply");
    // A second tap, on another device, finds it answered.
    const late = await postJson(request, `/api/sessions/${id}/answer`, { asked, choice: 0 });
    expect(late.status).toBe(409);
    expect(await errorOf(late)).toBe("That question has been answered already.");
  });

  it("stops waiting once the owner replies in their own words", async () => {
    const request = await start();
    const { id, seq } = await answered(request, ASKS);

    await postJson(request, `/api/sessions/${id}/messages`, {
      text: "Run them in your folder",
      model: FAKE_MODEL,
    });
    await followSession(request, { sessionId: id, after: seq, until: "turn-completed" });

    const listed = await listedOf(request, id);
    expect(listed?.waiting).toBe("reply");
    expect(listed?.question).toBeUndefined();
  });
});

describe("a builder", () => {
  /** A worker whose code workspace is on the fake GitHub with issue #22 ready, signed in. */
  const withIssues = async () => {
    const app = testWorker({
      root,
      now: () => now,
      github: github.api,
      providers: [createFakeProvider({ delayMs: 0 })],
    });
    const request = requesterFor(app, await setUpOwner(app));
    await postJson(request, "/api/github/sign-in", {});
    github.approve();
    await expect
      .poll(async () => GitHubConnection.parse(await (await request("/api/github")).json()).kind)
      .toBe("signed-in");
    return request;
  };
  let github: FakeGitHub;

  beforeEach(async () => {
    github = createFakeGitHub({
      issues: {
        [onGitHub]: [{ number: 22, title: "One Reply box", milestone: "4 · Code workspaces" }],
      },
    });
  });

  it("whose turn failed waits on the owner until Continue, whatever they've read", async () => {
    const request = await withIssues();
    const { id, seq } = await answered(request, "Build #22\nplease fail", "turn-failed");

    await postJson(request, `/api/sessions/${id}/seen`, { upTo: seq });
    now += 3 * 24 * 60 * 60 * 1000;
    expect(await listedOf(request, id)).toMatchObject({ waiting: "turn-failed", seen: true });

    const continued = await postJson(request, `/api/sessions/${id}/continue`, {});

    expect(continued.status).toBe(202);
    const events = await followSession(request, {
      sessionId: id,
      after: seq,
      until: "turn-completed",
    });
    expect(events[0]).toMatchObject({ type: "owner-message", continues: { turn: 1 } });
    expect(String(events[0]?.type === "owner-message" && events[0].text)).toMatch(/^Your last turn failed/);
  });

  it("that stopped with no pull request and no question waits on the owner until they reply", async () => {
    const request = await withIssues();
    const { id, seq } = await answered(request, "Build #22");

    await postJson(request, "/api/workspaces/side-project/seen", {});
    now += 3 * 24 * 60 * 60 * 1000;
    expect(await listedOf(request, id)).toMatchObject({ waiting: "stopped", seen: true });

    await postJson(request, `/api/sessions/${id}/messages`, { text: "Carry on", model: FAKE_MODEL });
    await followSession(request, { sessionId: id, after: seq, until: "turn-completed" });
    // Stopped again, it waits again: a new stop, not yet seen.
    expect(await listedOf(request, id)).toMatchObject({ waiting: "stopped" });
    expect((await listedOf(request, id))?.seen).toBeUndefined();
  });

  it("that hit the usage limit doesn't wait on the owner", async () => {
    const request = await withIssues();
    const { id } = await answered(request, "Build #22\nplease hit Fake's limit", "turn-failed");

    expect((await listedOf(request, id))?.waiting).not.toBe("turn-failed");
  });
});

describe("a session that asks in words", () => {
  it("waits on the owner with its question and no choices, which a tap can't answer", async () => {
    const request = await start();
    const { id } = await answered(request, "ask owner: Which board is the agreed one?");

    const listed = await listedOf(request, id);
    expect(listed?.waiting).toBe("asked");
    expect(listed?.question?.choices).toEqual([]);
    const tapped = await postJson(request, `/api/sessions/${id}/answer`, {
      asked: listed?.question?.asked,
      choice: 0,
    });
    expect(tapped.status).toBe(409);
    expect(await errorOf(tapped)).toBe("That question needs your own words: reply in its session.");
  });
});
