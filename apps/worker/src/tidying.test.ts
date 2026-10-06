import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, SessionDetail, SessionList, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider, type Provider } from "./providers/index.ts";
import {
  asOwner,
  FAKE_MODEL,
  followSession,
  gatedProvider,
  postJson,
  type Requester,
  startSession,
} from "./testing.ts";
import { createWorker } from "./worker.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const start = async (providers: Provider[] = [createFakeProvider({ delayMs: 0 })]) => {
  const worker = createWorker({
    env: { COURTYARD_CONTEXT_DIR: join(root, "context"), COURTYARD_DATA_DIR: join(root, "data") },
    providers,
  });
  if (!worker.ok) throw new Error(worker.error);
  return asOwner(worker.value.app);
};

/** Starts a session and waits for its first turn to finish. */
const finishedSession = async (request: Requester, text: string) => {
  const session = await startSession(request, text);
  await followSession(request, { sessionId: session.id, until: "turn-completed" });
  return session;
};

const renameSession = (request: Requester, id: string, title: unknown) =>
  request(`/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });

const deleteSession = (request: Requester, id: string) =>
  request(`/api/sessions/${id}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

const listSessions = async (request: Requester) =>
  SessionList.parse(await (await request("/api/workspaces/garage-gym/sessions")).json()).sessions;

const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

describe("renaming a session", () => {
  it("keeps the new title in its session.json, so every list shows it", async () => {
    const request = await start();
    const session = await finishedSession(request, "Where should the rack go?");

    const response = await renameSession(request, session.id, "  Rack position  ");

    expect(response.status).toBe(200);
    expect(SessionSummary.parse(await response.json()).title).toBe("Rack position");
    const file = JSON.parse(
      await readFile(join(root, "data", "sessions", session.id, "session.json"), "utf8"),
    );
    expect(file.title).toBe("Rack position");
    expect((await listSessions(request)).map((s) => s.title)).toEqual(["Rack position"]);
  });

  it("works while a turn is running, and the turn's end doesn't undo it", async () => {
    const { provider, release } = gatedProvider();
    const request = await start([provider]);
    const session = await startSession(request, "Where should the rack go?");

    expect((await renameSession(request, session.id, "Rack position")).status).toBe(200);
    release();
    await followSession(request, { sessionId: session.id, until: "turn-completed" });

    expect((await listSessions(request)).map((s) => s.title)).toEqual(["Rack position"]);
  });

  it("refuses an empty or overlong title, and a session that doesn't exist", async () => {
    const request = await start();
    const session = await finishedSession(request, "Hello");

    for (const title of ["", "   ", "x".repeat(61), 42]) {
      expect((await renameSession(request, session.id, title)).status, String(title)).toBe(400);
    }
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await renameSession(request, missing, "Hi")).status).toBe(404);
  });
});

describe("deleting a session", () => {
  it("removes its folder from the data folder, and it's gone from every list", async () => {
    const request = await start();
    const kept = await finishedSession(request, "Keep me");
    const session = await finishedSession(request, "Delete me");

    const response = await deleteSession(request, session.id);

    expect(response.status).toBe(204);
    expect(await readdir(join(root, "data", "sessions"))).toEqual([kept.id]);
    expect((await request(`/api/sessions/${session.id}`)).status).toBe(404);
    expect((await listSessions(request)).map((s) => s.title)).toEqual(["Keep me"]);
  });

  it("refuses while a turn is running, saying to stop it first", async () => {
    const { provider, release } = gatedProvider();
    const request = await start([provider]);
    const session = await startSession(request, "Hello");

    const response = await deleteSession(request, session.id);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/stop/i);
    release();
    await followSession(request, { sessionId: session.id, until: "turn-completed" });
    expect((await deleteSession(request, session.id)).status).toBe(204);
  });

  it("answers 404 for a session that doesn't exist", async () => {
    const request = await start();

    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await deleteSession(request, missing)).status).toBe(404);
  });
});

describe("a session whose workspace is archived", () => {
  it("still opens, says its workspace is archived, and refuses new messages", async () => {
    const request = await start();
    const session = await finishedSession(request, "Where should the rack go?");
    expect((await postJson(request, "/api/workspaces/garage-gym/archive", {})).status).toBe(204);

    const opened = await request(`/api/sessions/${session.id}`);
    const sent = await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "And the bench?",
      model: FAKE_MODEL,
    });

    expect(SessionDetail.parse(await opened.json()).workspaceArchived).toBe(true);
    expect(sent.status).toBe(409);
    expect(await errorOf(sent)).toContain("archived");
    expect(await readdir(join(root, "data", "sessions"))).toEqual([session.id]);
  });

  it("isn't archived while its workspace is open", async () => {
    const request = await start();
    const session = await finishedSession(request, "Hello");

    const opened = await request(`/api/sessions/${session.id}`);

    expect(SessionDetail.parse(await opened.json()).workspaceArchived).toBe(false);
  });

  it("can't be made by archiving a workspace mid-turn: that's refused until the turn ends", async () => {
    const { provider, release } = gatedProvider();
    const request = await start([provider]);
    const session = await startSession(request, "Hello");

    const response = await postJson(request, "/api/workspaces/garage-gym/archive", {});

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toMatch(/stop/i);
    release();
    await followSession(request, { sessionId: session.id, until: "turn-completed" });
    expect((await postJson(request, "/api/workspaces/garage-gym/archive", {})).status).toBe(204);
  });
});
