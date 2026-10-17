import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfflineCopy, SessionSummary } from "@courtyard/contract";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  followSession,
  postJson,
  type Requester,
  removeTestFolder,
  SAVING_MODEL,
  type ScriptedStep,
  savingProvider,
  testWorker,
} from "./testing.ts";

// Read offline (#106): the copy a device keeps to read while the worker can't be reached.

const CONTEXT = [
  "# Garage gym",
  "",
  "## Facts",
  "",
  "- Single garage.",
  "",
  "## Plans",
  "",
  "## Ideas",
  "",
].join("\n");

const OWNER = [
  "# Owner context",
  "",
  "## About me",
  "",
  "### Facts",
  "- Lives in the UK.",
  "",
  "## How to answer me",
  "",
  "- Short answers first.",
  "",
].join("\n");

let root: string;
let contextDir: string;
let app: Hono;
let request: Requester;

/** A worker whose clock moves on a second each time it's read, so every session's last activity differs. */
const startWorker = async (turns: readonly (readonly ScriptedStep[])[]) => {
  let clock = Date.parse("2026-10-17T10:00:00Z");
  const saver = savingProvider(turns);
  app = testWorker({ root, providers: [saver.provider], now: () => (clock += 1000) });
  request = await asOwner(app);
};

/** A new session in the garage gym, once its first turn has ended. */
const sessionTold = async (text: string) => {
  const started = await postJson(request, "/api/workspaces/garage-gym/sessions", {
    text,
    model: SAVING_MODEL,
  });
  const session = SessionSummary.parse(await started.json());
  await followSession(request, { sessionId: session.id, until: "turn-completed" });
  return session;
};

const copy = async () => {
  const response = await request("/api/offline-copy");
  expect(response.status).toBe(200);
  return OfflineCopy.parse(await response.json());
};

const garageGym = (kept: OfflineCopy) => {
  const workspace = kept.kept.find(({ detail }) => detail.workspace.id === "garage-gym");
  if (workspace === undefined) throw new Error("the garage gym isn't in the copy");
  return workspace;
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(join(contextDir, "garage-gym"), { recursive: true });
  await writeFile(join(contextDir, "garage-gym", "CONTEXT.md"), CONTEXT);
  await writeFile(join(contextDir, "OWNER.md"), OWNER);
});

afterEach(async () => {
  await removeTestFolder(root);
});

describe("the offline copy", () => {
  it("is only for a device that's logged in", async () => {
    await startWorker([]);
    const response = await app.request("/api/offline-copy");
    expect(response.status).toBe(401);
  });

  it("holds the workspaces, the owner context and each workspace's context file", async () => {
    await startWorker([]);
    const kept = await copy();
    expect(kept.workspaces.workspaces.map(({ id }) => id)).toEqual(["garage-gym"]);
    expect(kept.ownerContext.ownerContext?.facts).toEqual(["Lives in the UK."]);
    expect(kept.ownerContext.ownerContext?.answers).toEqual(["Short answers first."]);
    expect(garageGym(kept).detail.contextFile?.facts).toEqual(["Single garage."]);
    expect(Number.isNaN(Date.parse(kept.at))).toBe(false);
  });

  it("keeps the conversations of each workspace's 5 latest sessions, and lists the rest", async () => {
    await startWorker([]);
    const sessions: SessionSummary[] = [];
    for (const text of ["One", "Two", "Three", "Four", "Five", "Six"]) {
      sessions.push(await sessionTold(text));
    }
    const workspace = garageGym(await copy());
    expect(workspace.sessions.sessions).toHaveLength(6);
    const latestFive = sessions.slice(1).map(({ id }) => id);
    expect(workspace.conversations.map(({ session }) => session.id).sort()).toEqual(
      latestFive.sort(),
    );
  });

  it("keeps a conversation as the owner's messages, the answers and the saves, nothing the model did", async () => {
    await startWorker([
      [
        { write: "Two kinds fit." },
        { read: "notes.md" },
        { write: "The wall track is better value." },
        { section: "facts", action: "add", text: "The back wall is 2.4 m wide." },
      ],
    ]);
    const session = await sessionTold("What's good value for the back wall?");
    const [conversation] = garageGym(await copy()).conversations;
    expect(conversation?.session.id).toBe(session.id);
    const events = conversation?.events ?? [];
    expect(events.map(({ type }) => type)).toEqual([
      "owner-message",
      "text-delta",
      "context-saved",
      "text-delta",
      "turn-completed",
    ]);
    // What it wrote either side of what it did reads as two paragraphs, as it did in the session.
    const [first, , last] = events.filter((event) => event.type !== "owner-message");
    expect(first?.type === "text-delta" && first.text).toBe(
      "Two kinds fit.\n\nThe wall track is better value.",
    );
    // A save between two pieces of text never broke them, so it doesn't now.
    expect(last?.type === "text-delta" && last.text).toBe("Done.");
    // Event numbers still only go up, as the session page reads them.
    const numbers = events.map(({ seq }) => seq);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it("lists sessions calm: what waits on the owner isn't kept", async () => {
    await startWorker([]);
    await sessionTold("One");
    const [listed] = garageGym(await copy()).sessions.sessions;
    expect(listed?.waiting).toBe("nothing");
    expect(listed?.now).toEqual({ kind: "your-turn" });
  });
});
