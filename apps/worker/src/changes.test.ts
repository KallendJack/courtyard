import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecentChanges, type SessionEvent, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  errorOf,
  followSession,
  gitIn,
  postJson,
  type Requester,
  SAVING_MODEL,
  type ScriptedStep,
  savingProvider,
  testWorker,
} from "./testing.ts";

// Recent changes: a place's changes from the context folder's history, and Undo from them (ADR 0013).

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

let root: string;
let contextDir: string;
const contextPath = () => join(contextDir, "garage-gym", "CONTEXT.md");
const contextFile = () => readFile(contextPath(), "utf8");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(join(contextDir, "garage-gym"), { recursive: true });
  await writeFile(contextPath(), CONTEXT);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A worker whose first turn in garage-gym makes the scripted saves; returns once it ends. */
const workerSaving = async (steps: readonly ScriptedStep[]) => {
  const saver = savingProvider([steps]);
  const request = await asOwner(testWorker({ root, providers: [saver.provider] }));
  const started = await postJson(request, "/api/workspaces/garage-gym/sessions", {
    text: "Some news.",
    model: SAVING_MODEL,
  });
  const session = SessionSummary.parse(await started.json());
  const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });
  const saves = events.flatMap((event) => (event.type === "context-saved" ? [event.seq] : []));
  return { request, session, saves };
};

const changesOf = async (request: Requester, path: string) => {
  const response = await request(path);
  expect(response.status).toBe(200);
  return RecentChanges.parse(await response.json());
};

const workspaceChanges = (request: Requester, after?: string) =>
  changesOf(
    request,
    `/api/workspaces/garage-gym/changes${after === undefined ? "" : `?after=${after}`}`,
  );

const undoChange = (request: Requester, id: string) =>
  postJson(request, `/api/changes/${id}/undo`, {});

const fact = (line: string) => ({ place: "workspace", section: "facts", line });
const plan = (line: string) => ({ place: "workspace", section: "plans", line });

describe("Recent changes", () => {
  // Many real git changes in a row: slow on Windows while every test file runs at once.
  it("lists saves, undos, edits and hand edits, newest first, with the lines each changed", async () => {
    const { request, session, saves } = await workerSaving([
      { action: "add", section: "facts", text: "Padel lessons on Tuesdays." },
      { action: "add", section: "ideas", text: "A rowing machine." },
    ]);
    const [padel, rowing] = saves;
    await postJson(request, `/api/sessions/${session.id}/saves/${padel}/edit`, {
      place: "workspace",
      section: "plans",
      line: "Padel lessons, Tuesdays at 7pm.",
    });
    await postJson(request, `/api/sessions/${session.id}/saves/${rowing}/undo`, {});
    await writeFile(contextPath(), (await contextFile()).replace("Single", "Double"));

    const { changes, more } = await workspaceChanges(request);

    expect(more).toBeNull();
    expect(
      changes.map(({ kind, removed, added, undo }) => ({ kind, removed, added, undo })),
    ).toEqual([
      {
        kind: "hand-edit",
        removed: [fact("Single garage.")],
        added: [fact("Double garage.")],
        undo: "available",
      },
      {
        kind: "undo",
        removed: [{ place: "workspace", section: "ideas", line: "A rowing machine." }],
        added: [],
        undo: "none",
      },
      {
        kind: "edit",
        removed: [fact("Padel lessons on Tuesdays.")],
        added: [plan("Padel lessons, Tuesdays at 7pm.")],
        undo: "none",
      },
      {
        kind: "save",
        removed: [],
        added: [{ place: "workspace", section: "ideas", line: "A rowing machine." }],
        undo: "undone",
      },
      { kind: "save", removed: [], added: [fact("Padel lessons on Tuesdays.")], undo: "available" },
    ]);
    expect(changes[1]?.session).toEqual({
      id: session.id,
      title: "Some news.",
      workspaceId: "garage-gym",
    });
    expect(changes[0]?.session).toBeUndefined();
    expect(Date.parse(changes[0]?.at ?? "")).toBeGreaterThan(Date.now() - 60_000);
  }, 20_000);

  it("comes 30 at a time, the next page after the last change shown", async () => {
    const { request } = await workerSaving([]);
    await workspaceChanges(request);
    // 31 hand edits, committed as the worker commits them, without a worker's queue for each.
    let markdown = CONTEXT;
    for (let n = 1; n <= 31; n += 1) {
      markdown = markdown.replace("- Single garage.", `- Single garage.\n- Fact number ${n}.`);
      await writeFile(contextPath(), markdown);
      await gitIn(contextDir, "add", "--all");
      await gitIn(
        contextDir,
        "commit",
        "--quiet",
        "-m",
        "Edited by hand",
        "-m",
        "Courtyard-Change: hand-edit\nCourtyard-Place: workspace/garage-gym",
      );
    }

    const first = await workspaceChanges(request);
    expect(first.changes).toHaveLength(30);
    expect(first.changes[0]?.added).toEqual([fact("Fact number 31.")]);
    expect(first.more).toBe(first.changes.at(-1)?.id);

    const second = await workspaceChanges(request, first.more ?? "");
    expect(second.changes.map((change) => change.added)).toEqual([[fact("Fact number 1.")]]);
    expect(second.more).toBeNull();

    const unknown = await request(`/api/workspaces/garage-gym/changes?after=${"0".repeat(40)}`);
    expect(unknown.status).toBe(404);
  }, 30_000);

  it("lists the owner context's changes on their own", async () => {
    const { request } = await workerSaving([
      { action: "add", place: "owner", section: "answers", text: "Distances in km." },
    ]);

    const owner = await changesOf(request, "/api/owner-context/changes");

    expect(owner.changes.map((change) => change.added)).toEqual([
      [{ place: "owner", section: "answers", line: "Distances in km." }],
    ]);
    expect((await workspaceChanges(request)).changes).toEqual([]);
  });
});

describe("Undo from Recent changes", () => {
  it("undoes a save through its session, so its note shows it undone", async () => {
    const { request, session, saves } = await workerSaving([
      { action: "add", section: "facts", text: "Padel lessons on Tuesdays." },
    ]);
    const [save] = (await workspaceChanges(request)).changes;

    expect((await undoChange(request, save?.id ?? "")).status).toBe(204);

    expect(await contextFile()).toBe(CONTEXT);
    const undone = await followSession(request, {
      sessionId: session.id,
      until: (event: SessionEvent) => event.type === "context-undone",
    });
    expect(undone.at(-1)).toMatchObject({ type: "context-undone", save: saves[0] });
    expect((await workspaceChanges(request)).changes.map((change) => change.undo)).toEqual([
      "none",
      "undone",
    ]);
    expect((await undoChange(request, save?.id ?? "")).status).toBe(409);
  });

  it("reverses a hand edit, as a change of its own", async () => {
    const { request } = await workerSaving([]);
    // Listing sets the context folder up as a repository, as the worker does when it starts.
    await workspaceChanges(request);
    await writeFile(
      contextPath(),
      CONTEXT.replace("- Single garage.", "- Double garage.\n- A bike in the corner."),
    );
    const [edit] = (await workspaceChanges(request)).changes;

    expect((await undoChange(request, edit?.id ?? "")).status).toBe(204);

    expect(await contextFile()).toBe(CONTEXT);
    expect((await workspaceChanges(request)).changes[0]?.kind).toBe("undo");
  });

  it("refuses to reverse a hand edit whose lines have changed since", async () => {
    const { request } = await workerSaving([]);
    await workspaceChanges(request);
    await writeFile(contextPath(), CONTEXT.replace("Single", "Double"));
    const [edit] = (await workspaceChanges(request)).changes;
    const later = CONTEXT.replace("Single", "Triple");
    await writeFile(contextPath(), later);

    const refused = await undoChange(request, edit?.id ?? "");

    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toMatch(/changed since/);
    expect(await contextFile()).toBe(later);
  });

  it("refuses an edit, and a change that doesn't exist", async () => {
    const { request, session, saves } = await workerSaving([
      { action: "add", section: "facts", text: "Padel lessons on Tuesdays." },
    ]);
    await postJson(request, `/api/sessions/${session.id}/saves/${saves[0]}/edit`, {
      place: "workspace",
      section: "facts",
      line: "Padel on Tuesdays.",
    });
    const [edit] = (await workspaceChanges(request)).changes;

    expect((await undoChange(request, edit?.id ?? "")).status).toBe(409);
    expect((await undoChange(request, "0".repeat(40))).status).toBe(404);
    expect((await undoChange(request, "nope")).status).toBe(404);
  });
});

describe("Recent changes, from the reviews", () => {
  it("finds the right save when the same line was saved, undone and saved again", async () => {
    const padel = { action: "add", section: "facts", text: "Padel lessons on Tuesdays." };
    const saver = savingProvider([[padel], [padel]]);
    const request = await asOwner(testWorker({ root, providers: [saver.provider] }));
    const started = await postJson(request, "/api/workspaces/garage-gym/sessions", {
      text: "Some news.",
      model: SAVING_MODEL,
    });
    const session = SessionSummary.parse(await started.json());
    const first = await followSession(request, { sessionId: session.id, until: "turn-completed" });
    const firstSave = first.find((event) => event.type === "context-saved")?.seq;
    await postJson(request, `/api/sessions/${session.id}/saves/${firstSave}/undo`, {});
    await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "Actually, yes.",
      model: SAVING_MODEL,
    });
    const second = await followSession(request, {
      sessionId: session.id,
      after: first.at(-1)?.seq ?? 0,
      until: "turn-completed",
    });
    const secondSave = second.find((event) => event.type === "context-saved")?.seq;

    const saves = (await workspaceChanges(request)).changes.filter((c) => c.kind === "save");
    // Newest first: the second save, then the first, which is undone.
    expect(saves.map((change) => change.undo)).toEqual(["available", "undone"]);

    expect((await undoChange(request, saves[0]?.id ?? "")).status).toBe(204);
    const undone = await followSession(request, {
      sessionId: session.id,
      after: second.at(-1)?.seq ?? 0,
      until: "context-undone",
    });
    expect(undone.at(-1)).toMatchObject({ save: secondSave });
  });

  it("offers a hand edit's Undo only while its lines are as it left them", async () => {
    const { request } = await workerSaving([]);
    await workspaceChanges(request);
    await writeFile(contextPath(), CONTEXT.replace("Single", "Double"));
    const [edit] = (await workspaceChanges(request)).changes;
    expect(edit?.undo).toBe("available");

    await undoChange(request, edit?.id ?? "");

    const after = (await workspaceChanges(request)).changes;
    expect(after.map(({ kind, undo }) => ({ kind, undo }))).toEqual([
      { kind: "undo", undo: "none" },
      { kind: "hand-edit", undo: "none" },
    ]);
  });

  it("leaves out hand edits to the workspace's other files, without short pages", async () => {
    const { request } = await workerSaving([
      { action: "add", section: "facts", text: "Padel lessons on Tuesdays." },
    ]);
    await writeFile(join(contextDir, "garage-gym", "notes.md"), "Shopping list.\n");

    const { changes, more } = await workspaceChanges(request);

    expect(changes.map((change) => change.kind)).toEqual(["save"]);
    expect(more).toBeNull();
  });
});
