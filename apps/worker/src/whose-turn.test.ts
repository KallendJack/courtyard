import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeSessionList, SessionList } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Provider } from "./providers/index.ts";
import {
  asOwner,
  CODING_MODEL,
  codeRepo,
  codeWorkspace,
  codingProvider,
  followSession,
  gatedProvider,
  postJson,
  type Requester,
  SAVING_MODEL,
  savingProvider,
  startSession,
  testWorker,
} from "./testing.ts";

// Whose turn it is (#179): each session in a workspace's list says whether its model is working
// (and on what, since when), needs the owner, or it's the owner's turn.

let root: string;
let now: number;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(root, "context", "garage-gym"), { recursive: true });
  now = Date.parse("2026-10-11T09:00:00Z");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const start = (providers: Provider[]) => asOwner(testWorker({ root, now: () => now, providers }));

const listOf = async (request: Requester, workspace = "garage-gym") =>
  SessionList.parse(await (await request(`/api/workspaces/${workspace}/sessions`)).json()).sessions;

/** A gate a scripted turn waits at until the test opens it. */
const gate = () => {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
};

describe("a workspace's sessions say whose turn it is", () => {
  it("working, thinking since its message, while a turn runs; the owner's turn once it ends", async () => {
    const gated = gatedProvider();
    const request = await start([gated.provider]);
    const session = await startSession(request, "Take your time");

    expect((await listOf(request))[0]?.now).toEqual({
      kind: "working",
      since: "2026-10-11T09:00:00.000Z",
      doing: { kind: "thinking" },
    });

    gated.release();
    await followSession(request, { sessionId: session.id, until: "turn-completed" });
    expect((await listOf(request))[0]?.now).toEqual({ kind: "your-turn" });
  });

  it("working on the model's latest activity, then on writing its answer", async () => {
    const reading = gate();
    const writing = gate();
    const saver = savingProvider([
      [{ read: "CONTEXT.md" }, () => reading.opened, { write: "So far" }, () => writing.opened],
    ]);
    const request = await start([saver.provider]);
    const session = await startSession(request, "Look first", SAVING_MODEL);
    await followSession(request, { sessionId: session.id, until: "activity" });

    expect((await listOf(request))[0]?.now).toMatchObject({
      kind: "working",
      doing: { kind: "activity", activity: { kind: "read-file", path: "CONTEXT.md" } },
    });

    reading.open();
    await followSession(request, { sessionId: session.id, until: "text-delta" });
    expect((await listOf(request))[0]?.now).toMatchObject({
      kind: "working",
      doing: { kind: "writing" },
    });
    writing.open();
    await followSession(request, { sessionId: session.id, until: "turn-completed" });
  });
});

describe("a code session waiting on an approval", () => {
  it("needs the owner, with what it asks, since it asked", async () => {
    const { repo } = await codeRepo(root);
    await codeWorkspace(root, "side-project", repo);
    const coder = codingProvider([{ run: "curl https://example.com" }]);
    const request = await start([coder.provider]);
    const response = await postJson(request, "/api/workspaces/side-project/sessions", {
      text: "Check the site",
      model: CODING_MODEL,
    });
    const { id } = (await response.json()) as { id: string };
    await followSession(request, { sessionId: id, until: "approval-requested" });

    const listed = CodeSessionList.parse(
      await (await request("/api/workspaces/side-project/sessions")).json(),
    ).sessions;

    expect(listed[0]?.now).toEqual({
      kind: "needs-you",
      since: "2026-10-11T09:00:00.000Z",
      ask: { kind: "command", command: "curl https://example.com", reason: "off-allowlist" },
    });
    await postJson(request, `/api/sessions/${id}/stop`, { turn: 1 });
    await followSession(request, { sessionId: id, until: "turn-stopped" });
  });
});
