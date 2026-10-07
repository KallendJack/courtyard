import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnerContextDetail, type SessionEvent, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  changesIn,
  errorOf,
  followSession,
  postJson,
  type Requester,
  SAVING_MODEL,
  type ScriptedStep,
  savingProvider,
  testWorker,
} from "./testing.ts";

// Saves to the workspace's context file and the owner context as a model chats, and the owner's Undo
// and Edit (ADR 0013).

const CONTEXT = [
  "# Garage gym",
  "",
  "## Facts",
  "",
  "- Single garage.",
  "- The ceiling is 2.3 m.",
  "",
  "## Plans",
  "",
  "- Buy a second-hand rack.",
  "",
  "## Ideas",
  "",
  "- A cable machine in the corner.",
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

/** A session whose first turn makes the scripted saves; returns its events once the turn ends. */
const sessionSaving = async (
  steps: readonly ScriptedStep[],
  options: { until?: SessionEvent["type"]; holdAfterSaves?: boolean } = {},
) => {
  const saver = savingProvider([steps], { holdAfterSaves: options.holdAfterSaves ?? false });
  const request = await asOwner(testWorker({ root, providers: [saver.provider] }));
  const started = await postJson(request, "/api/workspaces/garage-gym/sessions", {
    text: "I've booked padel lessons for Tuesdays.",
    model: SAVING_MODEL,
  });
  const session = SessionSummary.parse(await started.json());
  const events = await followSession(request, {
    sessionId: session.id,
    until: options.until ?? "turn-completed",
  });
  return { request, session, events, replies: () => saver.replies[0] ?? [] };
};

const savesIn = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "context-saved" ? [event] : []));

/** The one save a turn made, by its event number. */
const onlySave = (events: readonly SessionEvent[]) => {
  const [save, ...more] = savesIn(events);
  if (save === undefined || more.length > 0) throw new Error("expected exactly one save");
  return save;
};

const latestChange = async () => (await changesIn(contextDir))[0];

const undo = (request: Requester, sessionId: string, save: number) =>
  postJson(request, `/api/sessions/${sessionId}/saves/${save}/undo`, {});

const edit = (request: Requester, sessionId: string, save: number, body: unknown) =>
  postJson(request, `/api/sessions/${sessionId}/saves/${save}/edit`, body);

/** Follows the session from `after` until an event of type `until`, and returns that event. */
const next = async (
  request: Requester,
  read: { sessionId: string; after: number; until: SessionEvent["type"] },
) => (await followSession(request, read)).at(-1);

describe("a save during a turn", () => {
  it("adds a line to the end of its section, as a change of its own naming the session", async () => {
    const { session, events, replies } = await sessionSaving([
      { section: "facts", action: "add", text: "Padel lessons on Tuesdays." },
    ]);

    expect(await contextFile()).toContain(
      "- The ceiling is 2.3 m.\n- Padel lessons on Tuesdays.\n\n## Plans",
    );
    expect(replies()[0]?.saved).toBe(true);
    expect(onlySave(events).save).toEqual({
      action: "add",
      saved: { place: "workspace", section: "facts", line: "Padel lessons on Tuesdays." },
    });
    expect((await latestChange())?.trailers).toEqual([
      "Courtyard-Change: save",
      "Courtyard-Place: workspace/garage-gym",
      `Courtyard-Session: ${session.id}`,
    ]);
  });

  it("changes a line named by its label: in place, or moved when its section changes", async () => {
    const { events } = await sessionSaving([
      { section: "facts", action: "change", label: "F1", text: "Single garage, 5.2 m deep." },
      { section: "facts", action: "change", label: "P1", text: "Bought a second-hand rack." },
    ]);

    const file = await contextFile();
    expect(file).toContain(
      "- Single garage, 5.2 m deep.\n- The ceiling is 2.3 m.\n- Bought a second-hand rack.\n",
    );
    expect(file).not.toContain("Buy a second-hand rack.");
    expect(savesIn(events).map((event) => event.save)).toEqual([
      {
        action: "change",
        saved: { place: "workspace", section: "facts", line: "Single garage, 5.2 m deep." },
        replaced: { place: "workspace", section: "facts", line: "Single garage." },
      },
      {
        action: "change",
        saved: { place: "workspace", section: "facts", line: "Bought a second-hand rack." },
        replaced: { place: "workspace", section: "plans", line: "Buy a second-hand rack." },
      },
    ]);
  });

  it("removes a line named by its label", async () => {
    const { events } = await sessionSaving([{ section: "ideas", action: "remove", label: "I1" }]);

    expect(await contextFile()).not.toContain("cable machine");
    expect(onlySave(events).save).toEqual({
      action: "remove",
      replaced: { place: "workspace", section: "ideas", line: "A cable machine in the corner." },
    });
  });

  it("starts a workspace's missing context file from the starter, then saves into it", async () => {
    await rm(contextPath());

    await sessionSaving([{ section: "plans", action: "add", text: "Paint the floor." }]);

    const file = await contextFile();
    expect(file.startsWith("# garage-gym\n")).toBe(true);
    expect(file).toContain("## Plans\n\n- Paint the floor.\n");
    expect(file).toContain("## Ideas");
  });

  it("stays when the turn is stopped afterwards", async () => {
    const { request, session } = await sessionSaving(
      [{ section: "facts", action: "add", text: "Padel lessons on Tuesdays." }],
      { until: "context-saved", holdAfterSaves: true },
    );

    expect((await postJson(request, `/api/sessions/${session.id}/stop`, { turn: 1 })).status).toBe(
      202,
    );
    await followSession(request, { sessionId: session.id, until: "turn-stopped" });

    expect(await contextFile()).toContain("- Padel lessons on Tuesdays.");
  });
});

describe("a save the worker refuses", () => {
  it("is refused when its label is out of date, with the lines as they are now", async () => {
    const byHand = CONTEXT.replace("Buy a second-hand rack.", "Buy a rack from the gym sale.");
    const { events, replies } = await sessionSaving([
      () => writeFile(contextPath(), byHand),
      { section: "facts", action: "change", label: "P1", text: "Bought a rack." },
    ]);

    const reply = replies()[0];
    expect(reply?.saved).toBe(false);
    expect(reply?.reply).toMatch(/changed since/i);
    expect(reply?.reply).toContain("[P1] Buy a rack from the gym sale.");
    expect(savesIn(events)).toEqual([]);
    expect(await contextFile()).toBe(byHand);
  });

  it("is refused when it repeats a line already there, however it's written", async () => {
    const { events, replies } = await sessionSaving([
      { section: "facts", action: "add", text: "the ceiling is 2.3 m" },
    ]);

    expect(replies()[0]?.reply).toMatch(/already/i);
    expect(savesIn(events)).toEqual([]);
    expect(await contextFile()).toBe(CONTEXT);
  });

  it("is refused when its line is too long to be one fact", async () => {
    const { replies } = await sessionSaving([
      { section: "facts", action: "add", text: "A".repeat(251) },
    ]);

    expect(replies()[0]?.reply).toMatch(/250 characters/);
    expect(await contextFile()).toBe(CONTEXT);
  });

  it("is refused when it names no line, or one that doesn't exist", async () => {
    const { replies } = await sessionSaving([
      { section: "facts", action: "remove" },
      { section: "facts", action: "remove", label: "F9" },
    ]);

    expect(replies().map((reply) => reply.saved)).toEqual([false, false]);
    expect(await contextFile()).toBe(CONTEXT);
  });

  it("allows one retry, then tells the model to carry on without it", async () => {
    const { replies } = await sessionSaving([
      { section: "facts", action: "add", text: "Single garage." },
      { section: "facts", action: "add", text: "Single garage" },
    ]);

    expect(replies()[0]?.reply).toMatch(/try once more/i);
    expect(replies()[1]?.reply).toMatch(/carry on without/i);
  });
});

describe("Undo", () => {
  it("takes a saved line out again, as a change of its own, and records it in the session", async () => {
    const { request, session, events } = await sessionSaving([
      { section: "facts", action: "add", text: "Padel lessons on Tuesdays." },
    ]);
    const save = onlySave(events).seq;

    expect((await undo(request, session.id, save)).status).toBe(204);

    expect(await contextFile()).toBe(CONTEXT);
    expect((await latestChange())?.trailers).toEqual([
      "Courtyard-Change: undo",
      "Courtyard-Place: workspace/garage-gym",
      `Courtyard-Session: ${session.id}`,
    ]);
    const undone = await next(request, {
      sessionId: session.id,
      after: 0,
      until: "context-undone",
    });
    expect(undone).toMatchObject({ type: "context-undone", save });
  });

  it("puts a changed line back as it was, where it was", async () => {
    const { request, session, events } = await sessionSaving([
      { section: "facts", action: "change", label: "P1", text: "Bought a second-hand rack." },
    ]);

    await undo(request, session.id, onlySave(events).seq);

    expect(await contextFile()).toContain("## Plans\n\n- Buy a second-hand rack.\n");
    expect(await contextFile()).not.toContain("Bought");
  });

  it("puts a removed line back", async () => {
    const { request, session, events } = await sessionSaving([
      { section: "ideas", action: "remove", label: "I1" },
    ]);

    await undo(request, session.id, onlySave(events).seq);

    expect(await contextFile()).toContain("## Ideas\n\n- A cable machine in the corner.\n");
  });

  it("refuses when the line has changed since, leaving the newer wording", async () => {
    const { request, session, events } = await sessionSaving([
      { section: "facts", action: "add", text: "Padel lessons on Tuesdays." },
    ]);
    const byHand = (await contextFile()).replace("on Tuesdays.", "on Tuesdays at 7pm.");
    await writeFile(contextPath(), byHand);

    const refused = await undo(request, session.id, onlySave(events).seq);

    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toMatch(/changed since/i);
    expect(await contextFile()).toBe(byHand);
  });

  it("refuses a save that's already undone, and anything that isn't a save", async () => {
    const { request, session, events } = await sessionSaving([
      { section: "facts", action: "add", text: "Padel lessons on Tuesdays." },
    ]);
    const save = onlySave(events).seq;
    await undo(request, session.id, save);

    expect((await undo(request, session.id, save)).status).toBe(409);
    expect((await undo(request, session.id, 1)).status).toBe(404);
  });
});

describe("Edit", () => {
  it("changes a saved line's wording and section, as a change of its own", async () => {
    const { request, session, events } = await sessionSaving([
      { section: "facts", action: "add", text: "Padel lessons on Tuesdays." },
    ]);
    const save = onlySave(events).seq;

    const edited = await edit(request, session.id, save, {
      place: "workspace",
      section: "plans",
      line: "Padel lessons, Tuesdays 7pm until Christmas.",
    });

    expect(edited.status).toBe(204);
    const file = await contextFile();
    expect(file).not.toContain("Padel lessons on Tuesdays.");
    expect(file).toContain(
      "- Buy a second-hand rack.\n- Padel lessons, Tuesdays 7pm until Christmas.\n",
    );
    expect((await latestChange())?.trailers[0]).toBe("Courtyard-Change: edit");
    const recorded = await next(request, {
      sessionId: session.id,
      after: 0,
      until: "context-edited",
    });
    expect(recorded).toMatchObject({
      save,
      now: {
        place: "workspace",
        section: "plans",
        line: "Padel lessons, Tuesdays 7pm until Christmas.",
      },
    });
  });

  it("keeps the line in its place when only the wording changes, and Undo then takes it out", async () => {
    const { request, session, events } = await sessionSaving([
      { section: "facts", action: "change", label: "F1", text: "Single garage, 5.2 m deep." },
    ]);
    const save = onlySave(events).seq;

    await edit(request, session.id, save, {
      place: "workspace",
      section: "facts",
      line: "Single garage, 5 m deep.",
    });
    expect(await contextFile()).toContain("## Facts\n\n- Single garage, 5 m deep.\n- The ceiling");

    await undo(request, session.id, save);
    expect(await contextFile()).toBe(CONTEXT);
  });

  it("refuses a line that's too long, and a save that's been undone", async () => {
    const { request, session, events } = await sessionSaving([
      { section: "facts", action: "add", text: "Padel lessons on Tuesdays." },
    ]);
    const save = onlySave(events).seq;

    const tooLong = await edit(request, session.id, save, {
      place: "workspace",
      section: "facts",
      line: "A".repeat(251),
    });
    expect(tooLong.status).toBe(400);
    await undo(request, session.id, save);
    const afterUndo = await edit(request, session.id, save, {
      place: "workspace",
      section: "facts",
      line: "Padel.",
    });
    expect(afterUndo.status).toBe(409);
  });
});

const OWNER = [
  "# Owner context",
  "",
  "## About me",
  "",
  "### Facts",
  "",
  "- Lives in Leeds.",
  "",
  "### Plans",
  "",
  "### Ideas",
  "",
  "## How to answer me",
  "",
  "- Metric units.",
  "",
].join("\n");

const ownerPath = () => join(contextDir, "OWNER.md");
const ownerFile = () => readFile(ownerPath(), "utf8");

describe("a save to the owner context", () => {
  beforeEach(() => writeFile(ownerPath(), OWNER));

  it("adds to About me, as a change to the owner context alone, which the home page shows", async () => {
    const { request, session, events } = await sessionSaving([
      { action: "add", place: "owner", section: "facts", text: "Has a bad left knee." },
    ]);

    expect(await ownerFile()).toContain("- Lives in Leeds.\n- Has a bad left knee.\n\n### Plans");
    expect(await contextFile()).toBe(CONTEXT);
    expect(onlySave(events).save).toEqual({
      action: "add",
      saved: { place: "owner", section: "facts", line: "Has a bad left knee." },
    });
    expect((await latestChange())?.trailers).toEqual([
      "Courtyard-Change: save",
      "Courtyard-Place: owner-context",
      `Courtyard-Session: ${session.id}`,
    ]);
    const home = OwnerContextDetail.parse(await (await request("/api/owner-context")).json());
    expect(home.ownerContext?.facts).toEqual(["Lives in Leeds.", "Has a bad left knee."]);
  });

  it("adds a lasting preference to How to answer me", async () => {
    await sessionSaving([{ action: "add", section: "answers", text: "Weights in kg." }]);

    expect(await ownerFile()).toContain(
      "## How to answer me\n\n- Metric units.\n- Weights in kg.\n",
    );
  });

  it("changes and removes the owner context's lines by their labels", async () => {
    await sessionSaving([
      { action: "change", section: "facts", label: "MF1", text: "Lives in Leeds, near the park." },
      { action: "remove", label: "A1" },
    ]);

    const file = await ownerFile();
    expect(file).toContain("### Facts\n\n- Lives in Leeds, near the park.\n");
    expect(file).not.toContain("Metric units");
  });

  it("starts a missing OWNER.md from its starter, then saves into it", async () => {
    await rm(ownerPath());

    await sessionSaving([
      { action: "add", place: "owner", section: "plans", text: "Moving house in spring." },
    ]);

    const file = await ownerFile();
    expect(file.startsWith("# Owner context\n")).toBe(true);
    expect(file).toContain("### Plans\n\n- Moving house in spring.\n");
    expect(file).toContain("## How to answer me");
  });

  it("is refused when the other file already says it, or for answers in the workspace", async () => {
    const { replies } = await sessionSaving([
      { action: "add", section: "facts", text: "lives in leeds" },
      { action: "add", place: "workspace", section: "answers", text: "Short answers." },
    ]);

    expect(replies().map((reply) => reply.saved)).toEqual([false, false]);
    expect(replies()[0]?.reply).toMatch(/already saved: "Lives in Leeds."/);
    expect(await ownerFile()).toBe(OWNER);
    expect(await contextFile()).toBe(CONTEXT);
  });

  it("from a code workspace, saves only to How to answer me", async () => {
    await writeFile(
      join(contextDir, "garage-gym", "workspace.json"),
      '{ "mode": "code", "repoPath": "/path/to/repo" }',
    );

    const { replies } = await sessionSaving([
      { action: "add", place: "owner", section: "facts", text: "Has a bad left knee." },
      { action: "add", section: "facts", text: "Padel lessons on Tuesdays." },
      { action: "remove", label: "MF1" },
      { action: "remove", label: "F1" },
      { action: "add", section: "answers", text: "Examples in TypeScript." },
    ]);

    expect(replies().map((reply) => reply.saved)).toEqual([false, false, false, false, true]);
    expect(replies()[0]?.reply).toMatch(/only to How to answer me/);
    // It isn't shown About me, so it has no labels for it; it is shown the context file.
    expect(replies()[2]?.reply).toMatch(/no line labelled MF1/);
    expect(replies()[3]?.reply).toMatch(/only to How to answer me/);
    const file = await ownerFile();
    expect(file).toContain("- Metric units.\n- Examples in TypeScript.\n");
    expect(file).not.toContain("knee");
    expect(await contextFile()).toBe(CONTEXT);
  });

  it("is undone like any other save", async () => {
    const { request, session, events } = await sessionSaving([
      { action: "add", section: "answers", text: "Weights in kg." },
    ]);

    expect((await undo(request, session.id, onlySave(events).seq)).status).toBe(204);

    expect(await ownerFile()).toBe(OWNER);
    expect((await latestChange())?.trailers[1]).toBe("Courtyard-Place: owner-context");
  });

  it("can be moved by Edit between the workspace and the owner context, and undone", async () => {
    const { request, session, events } = await sessionSaving([
      { action: "add", section: "facts", text: "Has a bad left knee." },
    ]);
    const save = onlySave(events).seq;

    const moved = await edit(request, session.id, save, {
      place: "owner",
      section: "facts",
      line: "Has a bad left knee.",
    });

    expect(moved.status).toBe(204);
    expect(await contextFile()).toBe(CONTEXT);
    expect(await ownerFile()).toContain("- Lives in Leeds.\n- Has a bad left knee.\n");
    expect((await latestChange())?.trailers).toEqual([
      "Courtyard-Change: edit",
      "Courtyard-Place: owner-context",
      "Courtyard-Place: workspace/garage-gym",
      `Courtyard-Session: ${session.id}`,
    ]);

    await undo(request, session.id, save);
    expect(await ownerFile()).toBe(OWNER);
    expect(await contextFile()).toBe(CONTEXT);
  });
});
