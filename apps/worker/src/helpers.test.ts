import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Activity, SessionEvent } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./providers/fake.ts";
import {
  asOwner,
  codeRepo,
  codeWorkspace,
  FAKE_MODEL,
  followSession,
  gitIn,
  postJson,
  type Requester,
  removeTestFolder,
  testWorker,
} from "./testing.ts";
import type { Environment } from "./worker.ts";

// Helpers (#117, ADR 0027): a code session's model hands parts of a job to its provider's own
// sub-agents, which work in the session's worktree under its rules. Seen through the fake, which
// starts helpers as a message scripts them, with real git in temporary repositories.

let root: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  ({ repo } = await codeRepo(root));
  await codeWorkspace(root, "side-project", repo);
});

afterEach(async () => {
  await removeTestFolder(root);
});

const start = async (env: Environment = {}) =>
  asOwner(testWorker({ root, providers: [createFakeProvider({ delayMs: 0 })], env }));

/** Starts a session in the code workspace with `text`, without waiting for its turn. */
const startCoding = async (request: Requester, text: string) => {
  const response = await postJson(request, "/api/workspaces/side-project/sessions", {
    text,
    model: FAKE_MODEL,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
};

/** The events a helper's line is made of, in order: its start, its work and its finish. */
const helperEvents = (events: readonly SessionEvent[], helper: string) =>
  events.flatMap(
    (event): (Activity | { started: string } | { waits: string } | { finished: string })[] => {
      if (event.type === "helper-started" && event.helper === helper) {
        return [event.waiting ? { waits: event.name } : { started: event.name }];
      }
      if (event.type === "activity" && event.helper === helper) return [event.activity];
      if (event.type === "helper-finished" && event.helper === helper) {
        return [{ finished: event.report }];
      }
      return [];
    },
  );

/** Stops a session's turn, as the owner's Stop does. */
const stop = (request: Requester, sessionId: string) =>
  postJson(request, `/api/sessions/${sessionId}/stop`, { turn: 1 });

describe("helpers in a code session (#117)", () => {
  it("records each helper by its name, everything it does tagged with it, and its report", async () => {
    const request = await start();
    const id = await startCoding(
      request,
      [
        "helper Review against standards: read file: src/slots.ts | report: Follows the standards.",
        "edit file notes.md: Reviewed",
      ].join("\n"),
    );

    const events = await followSession(request, { sessionId: id, until: "turn-completed" });

    expect(helperEvents(events, "helper-1")).toEqual([
      { started: "Review against standards" },
      { kind: "read-file", path: "src/slots.ts" },
      { finished: "Follows the standards." },
    ]);
    // The model's own work stays its own, after its helper reported back.
    const edited = events.findIndex((event) => event.type === "activity" && !event.helper);
    expect(events[edited]).toMatchObject({ activity: { kind: "edited-file", path: "notes.md" } });
    expect(edited).toBeGreaterThan(events.findIndex((event) => event.type === "helper-finished"));
  });

  it("runs at most three helpers at once: a fourth waits, saying so, and starts once one finishes", async () => {
    const request = await start();
    const id = await startCoding(
      request,
      [1, 2, 3, 4]
        .map((helper) => `helper Look ${helper}: read file: ${helper}.ts | report: Seen ${helper}.`)
        .join("\n"),
    );

    const events = await followSession(request, { sessionId: id, until: "turn-completed" });

    expect(helperEvents(events, "helper-4")).toEqual([
      { waits: "Look 4" },
      { started: "Look 4" },
      { kind: "read-file", path: "4.ts" },
      { finished: "Seen 4." },
    ]);
    for (const helper of ["helper-1", "helper-2", "helper-3"]) {
      expect(helperEvents(events, helper)[0]).toEqual({ started: expect.any(String) });
    }
    const firstFinished = events.findIndex((event) => event.type === "helper-finished");
    const fourthStarts = events.findIndex(
      (event) => event.type === "helper-started" && event.helper === "helper-4" && !event.waiting,
    );
    expect(fourthStarts).toBeGreaterThan(firstFinished);
  });

  it("asks the owner's OK for a helper's command off the allowlist, naming it, and tells it why when they deny it", async () => {
    const request = await start();
    const id = await startCoding(
      request,
      "helper Check the e2e tests: run command: pnpm exec playwright install chromium (for: Installs the browser)",
    );

    const events = await followSession(request, {
      sessionId: id,
      until: "turn-completed",
      onEvent: (event) => {
        if (event.type !== "approval-requested") return;
        void postJson(request, `/api/sessions/${id}/approvals/${event.seq}`, { answer: "deny" });
      },
    });

    expect(events.find((event) => event.type === "approval-requested")).toMatchObject({
      ask: { kind: "command", command: "pnpm exec playwright install chromium" },
      why: "Installs the browser",
      helper: "helper-1",
    });
    expect(helperEvents(events, "helper-1").at(-1)).toEqual({
      finished:
        "Couldn't run pnpm exec playwright install chromium: The owner denied that command, so it didn't run. Find another way, or tell the owner why it's needed.",
    });
  });

  it("runs one of a session's heavy checks at a time, whatever the builds at once: its helpers share its folder", async () => {
    const request = await start({ COURTYARD_BUILDS_AT_ONCE: "2" });
    const id = await startCoding(
      request,
      [
        "helper Run the unit tests: hold command: pnpm test",
        "helper Check the e2e tests: run command: pnpm verify",
      ].join("\n"),
    );

    await followSession(request, {
      sessionId: id,
      until: (event) =>
        event.type === "activity" &&
        event.helper === "helper-2" &&
        event.activity.kind === "waiting-for-build",
    });
    expect((await stop(request, id)).status).toBe(202);
    const events = await followSession(request, { sessionId: id, until: "turn-stopped" });

    expect(helperEvents(events, "helper-1")).toEqual([
      { started: "Run the unit tests" },
      { kind: "ran-command", command: "pnpm test" },
    ]);
    expect(helperEvents(events, "helper-2")).toEqual([
      { started: "Check the e2e tests" },
      { kind: "waiting-for-build", ahead: 1 },
    ]);
  });

  it("stops every helper with the turn, one waiting for a place too", async () => {
    const request = await start();
    const id = await startCoding(
      request,
      [1, 2, 3, 4].map((helper) => `helper Hold ${helper}: hold`).join("\n"),
    );

    await followSession(request, {
      sessionId: id,
      until: (event) => event.type === "helper-started" && event.waiting === true,
    });
    expect((await stop(request, id)).status).toBe(202);
    const events = await followSession(request, { sessionId: id, until: "turn-stopped" });

    expect(helperEvents(events, "helper-4")).toEqual([{ waits: "Hold 4" }]);
    expect(events.filter((event) => event.type === "helper-started")).toHaveLength(4);
    expect(events.some((event) => event.type === "helper-finished")).toBe(false);
  });
});

/** Whether there's anything at `path`. */
const isThere = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

/** The session's worktree, in the worker's data folder. */
const worktreeOf = (id: string) => join(root, "data", "worktrees", id);

/** The branches the repository has, by name. */
const branchesOf = async (folder: string) =>
  (await gitIn(folder, "branch", "--list", "--format=%(refname:short)")).split(/\r?\n/);

/** The branch a helper was given of its own (#395). */
const branchOf = (events: readonly SessionEvent[], helper: string) => {
  const branched = events.find(
    (event) => event.type === "helper-branched" && event.helper === helper,
  );
  if (branched?.type !== "helper-branched") throw new Error(`${helper} got no branch`);
  return branched.branch;
};

describe("helpers that write code on branches of their own (#395)", () => {
  it("works in a worktree of its own beside the session's, from its branch, and is merged back as it finishes, its worktree and branch then cleared away", async () => {
    const request = await start();
    const id = await startCoding(
      request,
      [
        "helper Write the notes (own branch): edit file notes.md: From the helper | report: Wrote the notes.",
        "helper Review the readme: read file: README.md | report: Reads well.",
      ].join("\n"),
    );

    const events = await followSession(request, { sessionId: id, until: "turn-completed" });

    const branch = branchOf(events, "helper-1");
    const session = worktreeOf(id);
    expect(branch).toMatch(/^courtyard\/[\w-]+-helper-1$/);
    // A helper that only reads shares the session's folder, and has no branch of its own.
    expect(
      events.some((event) => event.type === "helper-branched" && event.helper === "helper-2"),
    ).toBe(false);
    expect(
      events.find((event) => event.type === "helper-finished" && event.helper === "helper-1"),
    ).toMatchObject({
      report: "Wrote the notes.",
      merged: true,
    });
    expect(
      events.find((event) => event.type === "helper-finished" && event.helper === "helper-2"),
    ).not.toHaveProperty("merged");
    // Its work, committed on its branch as it left it, is the session branch's now.
    expect(await gitIn(session, "show", "HEAD:notes.md")).toBe("From the helper");
    expect(await gitIn(session, "log", "-1", "--format=%s")).toBe("Write the notes");
    expect(await gitIn(session, "status", "--porcelain")).toBe("");
    expect(await isThere(`${session}-helper-1`)).toBe(false);
    expect(await branchesOf(repo)).not.toContain(branch);
  });

  it("holds it to its own worktree: an edit in the session's needs the owner's OK, as does pushing", async () => {
    const request = await start();
    const id = await startCoding(request, "Start");
    const started = await followSession(request, { sessionId: id, until: "turn-completed" });
    const session = worktreeOf(id);
    const asked: unknown[] = [];

    await postJson(request, `/api/sessions/${id}/messages`, {
      text: `helper Build it (own branch): edit file ../${id}/notes.md: Elsewhere | run command: git push origin HEAD | report: Tried.`,
      model: FAKE_MODEL,
    });
    await followSession(request, {
      sessionId: id,
      until: "turn-completed",
      after: started.at(-1)?.seq ?? 0,
      onEvent: (event) => {
        if (event.type !== "approval-requested") return;
        asked.push(event.ask);
        void postJson(request, `/api/sessions/${id}/approvals/${event.seq}`, { answer: "deny" });
      },
    });

    expect(asked).toEqual([
      { kind: "edit", path: join(session, "notes.md") },
      { kind: "command", command: "git push origin HEAD", reason: "off-allowlist" },
    ]);
    expect(await isThere(join(session, "notes.md"))).toBe(false);
  });

  it("stops a merge that clashes, keeps the helper's branch for the session's model to merge itself, and clears it when the session is deleted", async () => {
    const request = await start();
    const id = await startCoding(
      request,
      [
        "helper Build the API (own branch): edit file README.md: # The API | report: Built it.",
        "helper Build the sheet (own branch): pause 1500 | edit file README.md: # The sheet | report: Built it.",
      ].join("\n"),
    );

    const events = await followSession(request, { sessionId: id, until: "turn-completed" });

    const kept = branchOf(events, "helper-2");
    const session = worktreeOf(id);
    expect(
      events.find((event) => event.type === "helper-finished" && event.helper === "helper-1"),
    ).toMatchObject({ merged: true });
    expect(
      events.find((event) => event.type === "helper-finished" && event.helper === "helper-2"),
    ).toMatchObject({ merged: false });
    // The session's worktree is as the first merge left it, with no merge half done.
    expect(await gitIn(session, "show", "HEAD:README.md")).toBe("# The API");
    expect(await gitIn(session, "status", "--porcelain")).toBe("");
    expect(await isThere(`${session}-helper-2`)).toBe(true);
    expect(await branchesOf(repo)).toContain(kept);

    // Merging a helper's kept branch is the session's to do, without asking.
    await postJson(request, `/api/sessions/${id}/messages`, {
      text: `run command: git merge ${kept}`,
      model: FAKE_MODEL,
    });
    const sorting = await followSession(request, {
      sessionId: id,
      until: "turn-completed",
      after: events.at(-1)?.seq ?? 0,
    });
    expect(sorting.some((event) => event.type === "approval-requested")).toBe(false);
    expect(sorting).toContainEqual(
      expect.objectContaining({ activity: { kind: "ran-command", command: `git merge ${kept}` } }),
    );
    await gitIn(session, "merge", "--abort");

    const deleted = await request(`/api/sessions/${id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(deleted.status).toBe(204);
    expect(await isThere(`${session}-helper-2`)).toBe(false);
    expect(await branchesOf(repo)).not.toContain(kept);
  });
});
