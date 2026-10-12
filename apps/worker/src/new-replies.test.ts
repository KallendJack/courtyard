import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeSessionList, type SessionEvent } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./providers/fake.ts";
import {
  CODING_MODEL,
  codeRepo,
  codeWorkspace,
  codingProvider,
  errorOf,
  FAKE_MODEL,
  followSession,
  loginCookie,
  postJson,
  type Requester,
  removeTestFolder,
  requesterFor,
  setUpOwner,
  startSession,
  testWorker,
} from "./testing.ts";

// What waits on the owner (#334): the worker decides, once, which sessions have a new reply (an
// answer the owner hasn't seen since it came) or an approval, and every list says the same. The
// session page tells the worker what it has shown, from whichever device.

let root: string;
let now: number;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  now = Date.parse("2026-10-12T09:00:00Z");
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** A worker on the fake (and one that codes), with the owner on one device and `another` to log in more. */
const start = async (coding = codingProvider([]).provider) => {
  const app = testWorker({
    root,
    now: () => now,
    providers: [createFakeProvider({ delayMs: 0 }), coding],
  });
  const request = requesterFor(app, await setUpOwner(app));
  const another = async () =>
    requesterFor(
      app,
      loginCookie(await postJson(app.request, "/api/login", { password: "test password" })),
    );
  return { request, another };
};

/** What a session waits on the owner for, as its workspace's list says. */
const waitingOf = async (request: Requester, id: string, workspace = "garage-gym") => {
  const response = await request(`/api/workspaces/${workspace}/sessions`);
  const { sessions } = CodeSessionList.parse(await response.json());
  return sessions.find((session) => session.id === id)?.waiting;
};

/** The session's page showed everything up to `upTo`. */
const seen = (request: Requester, id: string, upTo: number) =>
  postJson(request, `/api/sessions/${id}/seen`, { upTo });

const lastSeq = (events: readonly SessionEvent[]) => events.at(-1)?.seq ?? 0;

/** Starts a session on the fake and follows its first turn to its end. */
const answered = async (request: Requester, text = "Where does the rack go?") => {
  const session = await startSession(request, text);
  const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });
  return { id: session.id, seq: lastSeq(events) };
};

/** Sends the session another message and follows its turn to its end. */
const answeredAgain = async (request: Requester, id: string, after: number) => {
  await postJson(request, `/api/sessions/${id}/messages`, { text: "And then?", model: FAKE_MODEL });
  const events = await followSession(request, { sessionId: id, after, until: "turn-completed" });
  return lastSeq(events);
};

describe("a new reply", () => {
  it("waits on the owner until they've seen it, and a newer answer waits again", async () => {
    const { request } = await start();
    const { id, seq } = await answered(request);
    expect(await waitingOf(request, id)).toBe("reply");

    const told = await seen(request, id, seq);

    expect(told.status).toBe(204);
    expect(await waitingOf(request, id)).toBe("nothing");
    const again = await answeredAgain(request, id, seq);
    expect(await waitingOf(request, id)).toBe("reply");
    await seen(request, id, again);
    expect(await waitingOf(request, id)).toBe("nothing");
  });

  it("is seen on one device, and so on every device", async () => {
    const { request, another } = await start();
    const { id, seq } = await answered(request);
    const fold = await another();
    expect(await waitingOf(fold, id)).toBe("reply");

    await seen(fold, id, seq);

    expect(await waitingOf(request, id)).toBe("nothing");
    expect(await waitingOf(fold, id)).toBe("nothing");
  });

  it("still waits when the page showed only what came before it, and seen never goes back", async () => {
    const { request } = await start();
    const { id, seq } = await answered(request);

    // A page opened mid-turn showed the message, not the answer.
    await seen(request, id, 1);
    expect(await waitingOf(request, id)).toBe("reply");
    await seen(request, id, seq);
    await seen(request, id, 1);
    expect(await waitingOf(request, id)).toBe("nothing");
  });

  it("isn't one once the answer is over a day old", async () => {
    const { request } = await start();
    const { id } = await answered(request);

    now += 25 * 60 * 60 * 1000;

    expect(await waitingOf(request, id)).toBe("nothing");
  });

  it("is told of only for a session there is, and an event number", async () => {
    const { request } = await start();
    const { id } = await answered(request);

    expect((await seen(request, "no-such-session", 1)).status).toBe(404);
    const refused = await postJson(request, `/api/sessions/${id}/seen`, { upTo: "all" });
    expect(refused.status).toBe(400);
    expect(await errorOf(refused)).toBe("Say which event the page showed up to");
  });
});

describe("Mark all read", () => {
  /** Mark all read on a workspace's sessions (#345). */
  const allRead = (request: Requester, workspace = "garage-gym") =>
    postJson(request, `/api/workspaces/${workspace}/seen`, {});

  it("sees every new reply in the workspace, on every device, and a newer answer waits again", async () => {
    const { request, another } = await start();
    const first = await answered(request);
    const second = await answered(request, "And the plates?");
    const fold = await another();

    const marked = await allRead(fold);

    expect(marked.status).toBe(204);
    expect(await waitingOf(request, first.id)).toBe("nothing");
    expect(await waitingOf(request, second.id)).toBe("nothing");
    await answeredAgain(request, first.id, first.seq);
    expect(await waitingOf(request, first.id)).toBe("reply");
  });

  it("leaves another workspace's new replies, and is only for a workspace there is", async () => {
    await mkdir(join(root, "context", "porch"), { recursive: true });
    const { request } = await start();
    const { id } = await answered(request);

    await allRead(request, "porch");

    expect(await waitingOf(request, id)).toBe("reply");
    expect((await allRead(request, "no-such-workspace")).status).toBe(404);
  });
});

describe("an approval", () => {
  it("waits on the owner whatever they've seen", async () => {
    const { repo } = await codeRepo(root);
    await codeWorkspace(root, "side-project", repo);
    const { request } = await start(codingProvider([{ run: "curl https://example.com" }]).provider);
    const response = await postJson(request, "/api/workspaces/side-project/sessions", {
      text: "Check the site",
      model: CODING_MODEL,
    });
    const { id } = (await response.json()) as { id: string };
    const events = await followSession(request, { sessionId: id, until: "approval-requested" });

    await seen(request, id, lastSeq(events));
    await postJson(request, "/api/workspaces/side-project/seen", {});

    expect(await waitingOf(request, id, "side-project")).toBe("approval");
    await postJson(request, `/api/sessions/${id}/stop`, { turn: 1 });
    await followSession(request, { sessionId: id, until: "turn-stopped" });
  });
});
