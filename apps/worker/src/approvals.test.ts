import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApprovalAnswering, type SessionEvent } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Provider } from "./providers/index.ts";
import {
  asOwner,
  CODING_MODEL,
  codeRepo,
  codeWorkspace,
  codingProvider,
  errorOf,
  followSession,
  postJson,
  type Requester,
  testWorker,
} from "./testing.ts";

// Approvals (#171, ADR 0007): a command off the command allowlist, or an edit outside the session
// branch's worktree, pauses the turn until the owner allows or denies it.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  const { repo } = await codeRepo(root);
  await codeWorkspace(root, "side-project", repo);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const start = async (providers: Provider[]) => asOwner(testWorker({ root, providers }));

/** Starts a code session on the coder and follows it until it asks for an approval. */
const untilApproval = async (request: Requester) => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text: "Check your work",
    model: CODING_MODEL,
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const events = await followSession(request, { sessionId: id, until: "approval-requested" });
  const asked = events.at(-1);
  if (asked?.type !== "approval-requested") throw new Error("no approval asked for");
  return { id, asked, events };
};

const answer = (request: Requester, id: string, approval: number, given: "allow" | "deny") =>
  postJson(request, `/api/sessions/${id}/approvals/${approval}`, { answer: given });

/** The activities in a turn's events. */
const activitiesIn = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "activity" ? [event.activity] : []));

describe("a command off the command allowlist", () => {
  it("waits for the owner's approval, showing the exact command, and runs once allowed", async () => {
    const { provider, answers } = codingProvider([{ run: "pnpm add left-pad" }]);
    const request = await start([provider]);

    const { id, asked } = await untilApproval(request);

    expect(asked.ask).toEqual({
      kind: "command",
      command: "pnpm add left-pad",
      reason: "off-allowlist",
    });
    // Nothing has run while it waits.
    expect(answers).toEqual([]);

    const allowed = await answer(request, id, asked.seq, "allow");
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ answer: "allow" });
    const rest = await followSession(request, {
      sessionId: id,
      after: asked.seq,
      until: "turn-completed",
    });

    expect(answers).toEqual([{ ok: true, value: null }]);
    expect(rest[0]).toMatchObject({
      type: "approval-answered",
      approval: asked.seq,
      answer: "allow",
    });
    expect(activitiesIn(rest)).toEqual([{ kind: "ran-command", command: "pnpm add left-pad" }]);
  });

  it("is asked for one naming a path outside the worktree too, with what the model said it's for", async () => {
    const { provider } = codingProvider([
      { run: "git diff /path/to/notes.md", why: "To compare with the old notes" },
    ]);
    const request = await start([provider]);

    const { asked } = await untilApproval(request);

    expect(asked.ask).toEqual({
      kind: "command",
      command: "git diff /path/to/notes.md",
      reason: "reaches-out",
    });
    expect(asked.why).toBe("To compare with the old notes");
  });
});

describe("Deny", () => {
  it("doesn't run the command, and tells the model so it can take another route", async () => {
    const { provider, answers } = codingProvider([{ run: "pnpm add left-pad" }]);
    const request = await start([provider]);
    const { id, asked } = await untilApproval(request);

    const denied = await answer(request, id, asked.seq, "deny");
    expect(await denied.json()).toEqual({ answer: "deny" });
    const rest = await followSession(request, {
      sessionId: id,
      after: asked.seq,
      until: "turn-completed",
    });

    expect(answers).toEqual([
      {
        ok: false,
        error:
          "The owner denied that command, so it didn't run. Find another way, or tell the owner why it's needed.",
      },
    ]);
    expect(activitiesIn(rest)).toEqual([]);
  });
});

describe("an edit outside the worktree", () => {
  it("waits for the owner's approval, naming the file, and is decided by their answer", async () => {
    const { provider, answers } = codingProvider([
      { edit: "../outside.txt" },
      { edit: join(root, "elsewhere.txt") },
    ]);
    const request = await start([provider]);

    const { id, asked } = await untilApproval(request);
    expect(asked.ask).toEqual({
      kind: "edit",
      path: join(root, "data", "worktrees", "outside.txt"),
    });
    await answer(request, id, asked.seq, "allow");
    const second = await followSession(request, {
      sessionId: id,
      after: asked.seq,
      until: "approval-requested",
    });
    const next = second.at(-1);
    if (next?.type !== "approval-requested") throw new Error("no second approval");
    expect(next.ask).toEqual({ kind: "edit", path: join(root, "elsewhere.txt") });
    await answer(request, id, next.seq, "deny");
    await followSession(request, { sessionId: id, after: next.seq, until: "turn-completed" });

    expect(answers).toEqual([
      { ok: true, value: null },
      {
        ok: false,
        error:
          "The owner denied that change, so the file wasn't changed. Find another way, or tell the owner why it's needed.",
      },
    ]);
    expect(activitiesIn(second)).toEqual([
      { kind: "edited-file", path: join(root, "data", "worktrees", "outside.txt") },
    ]);
  });
});

describe("answering an approval", () => {
  it("counts only the first answer, from whichever device gave it, and every device sees it go", async () => {
    const { provider, answers } = codingProvider([{ run: "pnpm add left-pad" }]);
    const request = await start([provider]);
    const { id, asked } = await untilApproval(request);
    // Another device, following the session as it waits.
    const elsewhere = followSession(request, {
      sessionId: id,
      after: asked.seq,
      until: "approval-answered",
    });

    // Two devices answer at once, differently: whichever lands first stands, for both.
    const [first, second] = await Promise.all([
      answer(request, id, asked.seq, "allow"),
      answer(request, id, asked.seq, "deny"),
    ]);
    const again = await answer(request, id, asked.seq, "deny");

    expect([first.status, second.status, again.status]).toEqual([200, 200, 200]);
    const { answer: stands } = ApprovalAnswering.parse(await first.json());
    expect(await second.json()).toEqual({ answer: stands });
    expect(await again.json()).toEqual({ answer: stands });
    expect(await elsewhere).toEqual([
      expect.objectContaining({ type: "approval-answered", approval: asked.seq, answer: stands }),
    ]);
    const rest = await followSession(request, {
      sessionId: id,
      after: asked.seq,
      until: "turn-completed",
    });
    expect(rest.filter((event) => event.type === "approval-answered")).toHaveLength(1);
    expect(answers).toEqual([
      stands === "allow"
        ? { ok: true, value: null }
        : { ok: false, error: expect.stringMatching(/^The owner denied/) },
    ]);
  });

  it("is refused for an approval the session hasn't got, or whose turn has ended", async () => {
    const { provider } = codingProvider([{ run: "pnpm add left-pad" }]);
    const request = await start([provider]);
    const { id, asked } = await untilApproval(request);

    const unknown = await answer(request, id, asked.seq - 1, "allow");
    const nonsense = await postJson(request, `/api/sessions/${id}/approvals/${asked.seq}`, {
      answer: "maybe",
    });
    await postJson(request, `/api/sessions/${id}/stop`, { turn: 1 });
    await followSession(request, { sessionId: id, until: "turn-stopped" });
    const late = await answer(request, id, asked.seq, "allow");

    expect(unknown.status).toBe(404);
    expect(await errorOf(unknown)).toBe("No such approval in this session.");
    expect(nonsense.status).toBe(400);
    expect(late.status).toBe(409);
    expect(await errorOf(late)).toBe(
      "This approval's turn has ended, so nothing is waiting on it now.",
    );
  });
});

describe("stopping a turn that waits on an approval", () => {
  it("ends it cleanly: nothing runs, and the model is told the owner stopped", async () => {
    const { provider, answers } = codingProvider([
      { run: "pnpm add left-pad" },
      { run: "git status" },
    ]);
    const request = await start([provider]);
    const { id } = await untilApproval(request);

    const stopped = await postJson(request, `/api/sessions/${id}/stop`, { turn: 1 });
    const events = await followSession(request, { sessionId: id, until: "turn-stopped" });

    expect(stopped.status).toBe(202);
    expect(events.at(-1)?.type).toBe("turn-stopped");
    expect(activitiesIn(events)).toEqual([]);
    // The provider winds down: what it asks after the stop is refused too.
    await expect.poll(() => answers).toHaveLength(2);
    expect(answers).toEqual([
      { ok: false, error: "The owner stopped this turn, so nothing more is done." },
      { ok: false, error: "The owner stopped this turn, so nothing more is done." },
    ]);
    // And the session takes the next message.
    const next = await postJson(request, `/api/sessions/${id}/messages`, {
      text: "Carry on",
      model: CODING_MODEL,
    });
    expect(next.status).toBe(202);
  });
});
