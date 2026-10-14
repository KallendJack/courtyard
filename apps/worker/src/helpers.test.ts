import { mkdtemp } from "node:fs/promises";
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

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  const { repo } = await codeRepo(root);
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
