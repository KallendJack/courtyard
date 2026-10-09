import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DocumentChanged,
  DocumentDetail,
  DocumentList,
  DocumentRenamed,
  RecentChanges,
  type SessionEvent,
  SessionSummary,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./providers/index.ts";
import {
  asOwner,
  changesIn,
  errorOf,
  FAKE_MODEL,
  followSession,
  postJson,
  type Requester,
  SAVING_MODEL,
  type ScriptedStep,
  savingProvider,
  sendJson,
  testWorker,
} from "./testing.ts";

// A workspace's documents (ADR 0020): saved from an answer or by a model's document tool, listed,
// renamed and deleted, each as one change with Undo.

const PLAN =
  "## Padel plan to Christmas\n\nTwelve weeks from 13 October.\n\n- Weeks 1-3: footwork\n";

let root: string;
let contextDir: string;
const docsDir = () => join(contextDir, "padel", "docs");
const documentFile = (slug: string) => readFile(join(docsDir(), `${slug}.md`), "utf8");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(join(contextDir, "padel"), { recursive: true });
  await writeFile(
    join(contextDir, "padel", "CONTEXT.md"),
    "# Padel\n\n## Facts\n\n- Plays on Tuesdays.\n",
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A session in padel whose turns follow the scripted steps; returns once the first turn ends. */
const sessionWith = async (turns: readonly (readonly ScriptedStep[])[]) => {
  const saver = savingProvider(turns);
  const request = await asOwner(testWorker({ root, providers: [saver.provider] }));
  const started = await postJson(request, "/api/workspaces/padel/sessions", {
    text: "Can you put my padel sessions into a plan up to Christmas?",
    model: SAVING_MODEL,
  });
  const session = SessionSummary.parse(await started.json());
  const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });
  return { request, session, events, saver };
};

const listed = async (request: Requester) =>
  DocumentList.parse(await (await request("/api/workspaces/padel/documents")).json()).documents;

const saveAsDocument = (request: Requester, sessionId: string, body: unknown) =>
  postJson(request, `/api/sessions/${sessionId}/documents`, body);

const undoDocument = (request: Requester, sessionId: string, save: number) =>
  postJson(request, `/api/sessions/${sessionId}/documents/${save}/undo`, {});

const savedEvents = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "document-saved" ? [event] : []));

describe("Save as document", () => {
  it("saves the whole answer under the owner's name, as one change, with a note in the session", async () => {
    const { request, session } = await sessionWith([[{ write: PLAN }]]);

    const saved = await saveAsDocument(request, session.id, {
      answer: 1,
      name: "Padel plan to Christmas",
    });

    expect(saved.status).toBe(201);
    expect(await documentFile("padel-plan-to-christmas")).toBe(
      "# Padel plan to Christmas\n\nTwelve weeks from 13 October.\n\n- Weeks 1-3: footwork\nDone.\n",
    );
    expect(await listed(request)).toMatchObject([
      {
        slug: "padel-plan-to-christmas",
        name: "Padel plan to Christmas",
        path: "docs/padel-plan-to-christmas.md",
      },
    ]);
    expect((await changesIn(contextDir))[0]).toEqual({
      title: "Save document: Padel plan to Christmas",
      trailers: [
        "Courtyard-Change: document",
        "Courtyard-Place: workspace/padel",
        `Courtyard-Session: ${session.id}`,
        "Courtyard-File: padel/docs/padel-plan-to-christmas.md",
      ],
    });
    const events = await followSession(request, {
      sessionId: session.id,
      until: "document-saved",
    });
    expect(savedEvents(events)).toMatchObject([
      {
        save: {
          action: "save",
          document: { slug: "padel-plan-to-christmas", name: "Padel plan to Christmas" },
        },
        answer: 1,
        change: expect.any(String),
      },
    ]);
  });

  it("is undone from its note, as a change of its own, unless the document has changed since", async () => {
    const { request, session } = await sessionWith([[{ write: PLAN }], [{ write: PLAN }]]);
    await saveAsDocument(request, session.id, { answer: 1, name: "Padel plan" });
    const [note] = savedEvents(
      await followSession(request, { sessionId: session.id, until: "document-saved" }),
    );

    expect((await undoDocument(request, session.id, note?.seq ?? 0)).status).toBe(204);
    expect(await listed(request)).toEqual([]);
    const [undoChange] = await changesIn(contextDir);
    expect(undoChange?.title).toBe("Undo: Save document: Padel plan");
    expect(undoChange?.trailers).toContain(`Courtyard-Undoes: ${note?.change}`);
    const undone = await followSession(request, {
      sessionId: session.id,
      until: "document-undone",
    });
    expect(undone.at(-1)).toMatchObject({ type: "document-undone", save: note?.seq });
    expect((await undoDocument(request, session.id, note?.seq ?? 0)).status).toBe(409);

    // Saved again, then edited by hand: Undo would lose the edit, so it's refused.
    await saveAsDocument(request, session.id, { answer: 1, name: "Padel plan" });
    const again = savedEvents(
      await followSession(request, {
        sessionId: session.id,
        until: "document-saved",
        after: undone.at(-1)?.seq ?? 0,
      }),
    );
    await writeFile(join(docsDir(), "padel-plan.md"), "# Padel plan\n\nMy own words.\n");
    const refused = await undoDocument(request, session.id, again[0]?.seq ?? 0);
    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toMatch(/changed since/);
    expect(await documentFile("padel-plan")).toBe("# Padel plan\n\nMy own words.\n");
  });

  it("is refused for an answer that isn't there or isn't finished, a clashing name, or a code workspace", async () => {
    const { request, session } = await sessionWith([[{ write: PLAN }]]);
    await saveAsDocument(request, session.id, { answer: 1, name: "Padel plan" });

    const missing = await saveAsDocument(request, session.id, { answer: 7, name: "Another" });
    expect(missing.status).toBe(404);
    const clash = await saveAsDocument(request, session.id, { answer: 1, name: "PADEL plan!" });
    expect(clash.status).toBe(409);
    expect(await errorOf(clash)).toBe(
      "There's already a document called Padel plan. Choose another name.",
    );
    const nameless = await saveAsDocument(request, session.id, { answer: 1, name: "  " });
    expect(nameless.status).toBe(400);
    expect(await listed(request)).toHaveLength(1);
  });
});

const PACKING = "# Packing list for Bilbao\n\n- Two rackets\n- Trainers\n";

/** A packing list already in padel's documents, as if saved earlier. */
const withPackingList = async () => {
  await mkdir(docsDir(), { recursive: true });
  await writeFile(join(docsDir(), "packing-list-for-bilbao.md"), PACKING);
};

const documentTool = (input: unknown) => ({ call: "save_document", input });

describe("the document tool", () => {
  it("saves a new document from the model, named by its heading, with a note in the chat", async () => {
    const { session, events, saver } = await sessionWith([
      [documentTool({ text: "# Bike fit notes\n\nSaddle up 5 mm." })],
    ]);

    expect(saver.replies[0]).toEqual([{ ok: true, reply: "Saved docs/bike-fit-notes.md." }]);
    expect(await documentFile("bike-fit-notes")).toBe("# Bike fit notes\n\nSaddle up 5 mm.\n");
    expect(savedEvents(events)).toMatchObject([
      { save: { action: "save", document: { slug: "bike-fit-notes", name: "Bike fit notes" } } },
    ]);
    expect(savedEvents(events)[0]?.answer).toBeUndefined();
    expect((await changesIn(contextDir))[0]?.trailers).toContain(
      `Courtyard-Session: ${session.id}`,
    );
  });

  it("updates a document it has read with its whole new text, saying what changed", async () => {
    await withPackingList();
    const updated = `${PACKING}- Grips\n`;
    const { events, saver } = await sessionWith([
      [
        { read: "docs/packing-list-for-bilbao.md" },
        documentTool({
          path: "docs/packing-list-for-bilbao.md",
          text: updated,
          change: "added grips",
        }),
      ],
    ]);

    expect(saver.replies[0]).toEqual([
      { ok: true, reply: "Updated docs/packing-list-for-bilbao.md." },
    ]);
    expect(await documentFile("packing-list-for-bilbao")).toBe(updated);
    expect(savedEvents(events)).toMatchObject([
      {
        save: {
          action: "update",
          document: { slug: "packing-list-for-bilbao", name: "Packing list for Bilbao" },
          summary: "added grips",
        },
      },
    ]);
    const [change] = await changesIn(contextDir);
    expect(change?.title).toBe("Update document: Packing list for Bilbao");
  });

  it("refuses an update to a document it hasn't read, or that changed since it read it, then takes the retry", async () => {
    await withPackingList();
    const byHand = `${PACKING}- Sun cream\n`;
    const update = documentTool({
      path: "docs/packing-list-for-bilbao.md",
      text: `${PACKING}- Grips\n`,
    });
    const { saver } = await sessionWith([
      [
        update,
        { read: "docs/packing-list-for-bilbao.md" },
        () => writeFile(join(docsDir(), "packing-list-for-bilbao.md"), byHand),
        update,
        { read: "docs/packing-list-for-bilbao.md" },
        documentTool({
          path: "docs/packing-list-for-bilbao.md",
          text: `${byHand}- Grips\n`,
        }),
      ],
    ]);

    const [unread, stale, retried] = saver.replies[0] ?? [];
    expect(unread).toEqual({
      ok: false,
      reply:
        "You haven't read docs/packing-list-for-bilbao.md in this answer, so it may have changed since you last saw it. Read it, then send its whole new text.\n\nYou can put it right and try once more.",
    });
    expect(stale).toEqual({
      ok: false,
      reply:
        "docs/packing-list-for-bilbao.md has changed since you read it. Read it again, then send its whole new text with your change.\n\nCarry on without saving it.",
    });
    expect(retried?.ok).toBe(true);
    expect(await documentFile("packing-list-for-bilbao")).toBe(`${byHand}- Grips\n`);
  });

  it("is scripted on the fake: a new document, and an update to one it reads, refused unread", async () => {
    await withPackingList();
    const request = await asOwner(
      testWorker({ root, providers: [createFakeProvider({ delayMs: 0 })] }),
    );
    const started = await postJson(request, "/api/workspaces/padel/sessions", {
      text: "save document:\n# Bike fit notes\n\nSaddle up 5 mm.",
      model: FAKE_MODEL,
    });
    const session = SessionSummary.parse(await started.json());
    const first = await followSession(request, { sessionId: session.id, until: "turn-completed" });
    const update =
      "update document docs/packing-list-for-bilbao.md: added grips\n# Packing list for Bilbao\n\n- Grips";
    await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: update,
      model: FAKE_MODEL,
    });
    const unread = await followSession(request, {
      sessionId: session.id,
      until: "turn-completed",
      after: first.at(-1)?.seq ?? 0,
    });
    await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: `read file: docs/packing-list-for-bilbao.md\n${update}`,
      model: FAKE_MODEL,
    });
    const read = await followSession(request, {
      sessionId: session.id,
      until: "turn-completed",
      after: unread.at(-1)?.seq ?? 0,
    });

    expect(savedEvents(first)).toMatchObject([{ save: { action: "save" } }]);
    expect(await documentFile("bike-fit-notes")).toBe("# Bike fit notes\n\nSaddle up 5 mm.\n");
    expect(savedEvents(unread)).toEqual([]);
    expect(savedEvents(read)).toMatchObject([
      { save: { action: "update", summary: "added grips" } },
    ]);
    expect(await documentFile("packing-list-for-bilbao")).toBe(
      "# Packing list for Bilbao\n\n- Grips\n",
    );
  });

  it("refuses a document with no heading, one too long, a clashing name and an unknown path", async () => {
    await withPackingList();
    const { saver, events } = await sessionWith([
      [
        documentTool({ text: "Just some notes." }),
        documentTool({ text: "# Notes" }),
        documentTool({ text: `# Long\n\n${"x".repeat(40_001)}` }),
        documentTool({ text: "# Notes" }),
        documentTool({ text: "# Packing list for Bilbao\n\n- Socks" }),
        documentTool({ text: "# Notes" }),
        documentTool({ path: "docs/nothing-here.md", text: "# Nothing" }),
        documentTool({ text: 42 }),
      ],
    ]);

    expect(saver.replies[0]?.map((reply) => reply.reply.split("\n\n")[0])).toEqual([
      "A document starts with its name as a # heading, such as # Packing list.",
      "Saved docs/notes.md.",
      "That document is over 40,000 characters. Make it shorter, or split it into two documents.",
      "There's already a document called Notes at docs/notes.md. To change it, read it and send its path with the whole new text; otherwise give this one another name.",
      "There's already a document called Packing list for Bilbao at docs/packing-list-for-bilbao.md. To change it, read it and send its path with the whole new text; otherwise give this one another name.",
      "There's already a document called Notes at docs/notes.md. To change it, read it and send its path with the whole new text; otherwise give this one another name.",
      "There's no document at docs/nothing-here.md: the documents are listed in your instructions.",
      "That input doesn't fit this tool: it takes a document's whole text, and its path to update one.",
    ]);
    expect(savedEvents(events)).toHaveLength(1);
  });
});

/** Recent changes as the page lists them: an undo shows as its change marked undone. */
const changesListed = async (request: Requester) =>
  RecentChanges.parse(await (await request("/api/workspaces/padel/changes")).json()).changes.filter(
    (change) => change.kind !== "undo",
  );

const undoChange = (request: Requester, change: string) =>
  postJson(request, `/api/changes/${change}/undo`, {});

describe("a document's page", () => {
  it("gives the document's name, path and text below its heading", async () => {
    await withPackingList();
    const request = await asOwner(testWorker({ root }));

    const response = await request("/api/workspaces/padel/documents/packing-list-for-bilbao");

    expect(DocumentDetail.parse(await response.json())).toMatchObject({
      document: { name: "Packing list for Bilbao", path: "docs/packing-list-for-bilbao.md" },
      body: "- Two rackets\n- Trainers",
    });
    expect((await request("/api/workspaces/padel/documents/nothing-here")).status).toBe(404);
  });

  it("renames a document, its heading and file together, as one change Recent changes can undo", async () => {
    await withPackingList();
    await writeFile(join(docsDir(), "notes.md"), "# Notes\n");
    const request = await asOwner(testWorker({ root }));
    const path = "/api/workspaces/padel/documents/packing-list-for-bilbao";

    const clash = await sendJson(request, path, "PATCH", { name: "Notes" });
    expect(clash.status).toBe(409);
    const renamed = await sendJson(request, path, "PATCH", { name: "Bilbao kit" });

    expect(renamed.status).toBe(200);
    const { change, document } = DocumentRenamed.parse(await renamed.json());
    expect(document).toMatchObject({ slug: "bilbao-kit", name: "Bilbao kit" });
    expect(await documentFile("bilbao-kit")).toBe("# Bilbao kit\n\n- Two rackets\n- Trainers\n");
    expect((await listed(request)).map((each) => each.slug).sort()).toEqual([
      "bilbao-kit",
      "notes",
    ]);
    expect((await changesListed(request))[0]).toMatchObject({
      kind: "document",
      document: {
        did: "renamed",
        name: "Bilbao kit",
        was: "Packing list for Bilbao",
        slug: "bilbao-kit",
      },
      undo: "available",
    });

    expect((await undoChange(request, change ?? "")).status).toBe(204);
    expect(await documentFile("packing-list-for-bilbao")).toBe(PACKING);
    expect((await listed(request)).map((each) => each.slug).sort()).toEqual([
      "notes",
      "packing-list-for-bilbao",
    ]);
  });

  it("deletes a document as one change, which Undo brings back", async () => {
    await withPackingList();
    const request = await asOwner(testWorker({ root }));

    const deleted = await sendJson(
      request,
      "/api/workspaces/padel/documents/packing-list-for-bilbao",
      "DELETE",
      {},
    );

    expect(deleted.status).toBe(200);
    const { change } = DocumentChanged.parse(await deleted.json());
    expect(await listed(request)).toEqual([]);
    expect((await changesIn(contextDir))[0]?.title).toBe(
      "Delete document: Packing list for Bilbao",
    );
    expect((await changesListed(request))[0]).toMatchObject({
      kind: "document",
      document: { did: "deleted", name: "Packing list for Bilbao", slug: null },
      undo: "available",
    });
    expect((await undoChange(request, change ?? "")).status).toBe(204);
    expect(await documentFile("packing-list-for-bilbao")).toBe(PACKING);
    expect((await changesListed(request))[0]).toMatchObject({ undo: "undone" });
  });

  it("is only in a planning workspace", async () => {
    await mkdir(join(contextDir, "site"), { recursive: true });
    await writeFile(
      join(contextDir, "site", "workspace.json"),
      JSON.stringify({ mode: "code", repoPath: "/path/to/repo" }),
    );
    const request = await asOwner(testWorker({ root }));

    expect((await request("/api/workspaces/site/documents")).status).toBe(409);
  });
});

describe("documents in Recent changes", () => {
  it("lists each change to a document, and undoes a model's save through its session", async () => {
    await withPackingList();
    const { request, session } = await sessionWith([
      [
        documentTool({ text: "# Bike fit notes\n\nSaddle up 5 mm." }),
        { read: "docs/packing-list-for-bilbao.md" },
        documentTool({
          path: "docs/packing-list-for-bilbao.md",
          text: `${PACKING}- Grips\n`,
          change: "added grips",
        }),
      ],
    ]);

    const [updated, saved] = await changesListed(request);
    expect(updated).toMatchObject({
      kind: "document",
      document: {
        did: "updated",
        name: "Packing list for Bilbao",
        slug: "packing-list-for-bilbao",
      },
      session: { id: session.id },
      undo: "available",
    });
    expect(saved).toMatchObject({
      document: { did: "saved", name: "Bike fit notes", slug: "bike-fit-notes" },
    });

    expect((await undoChange(request, saved?.id ?? "")).status).toBe(204);
    const events = await followSession(request, {
      sessionId: session.id,
      until: "document-undone",
    });
    expect(events.at(-1)).toMatchObject({ type: "document-undone" });
    expect(await listed(request)).toHaveLength(1);
    const [, nowSaved] = await changesListed(request);
    expect(nowSaved?.undo).toBe("undone");

    // Edited by hand since: Undo would lose that, so it isn't offered.
    await writeFile(join(docsDir(), "packing-list-for-bilbao.md"), "# Packing list for Bilbao\n");
    expect((await changesListed(request))[0]).toMatchObject({ kind: "document", undo: "none" });
  });

  it("go with everything else at a fresh start", async () => {
    await withPackingList();
    const request = await asOwner(testWorker({ root }));

    expect((await postJson(request, "/api/fresh-start", { confirm: "start fresh" })).status).toBe(
      204,
    );

    expect(
      await readFile(join(docsDir(), "packing-list-for-bilbao.md"), "utf8").catch(() => null),
    ).toBe(null);
  });
});
