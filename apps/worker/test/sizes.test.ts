import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RecentChanges,
  type SessionEvent,
  SessionSummary,
  SizeRecord,
  Sizes,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  changesIn,
  codeRepo,
  codeWorkspace,
  errorOf,
  followSession,
  postJson,
  type Requester,
  removeTestFolder,
  SAVING_MODEL,
  type ScriptedStep,
  savingProvider,
  testWorker,
} from "./testing.ts";

// Size records (ADR 0037, #708): a JSON file each in a planning workspace's `sizes` folder, kept
// with their source. A model records and corrects them with the size tool; the worker alone ties
// "measured" to the owner's message; Fabrication's API serves them. Every save is one change with
// Undo.

let root: string;
let contextDir: string;
const garage = () => join(contextDir, "garage");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(join(garage(), "things"), { recursive: true });
  await writeFile(join(garage(), "CONTEXT.md"), "# Garage\n");
  await writeFile(
    join(garage(), "things", "garage.md"),
    "---\nname: Garage\nstatus: have\nkind: space\n---\n",
  );
});

afterEach(async () => {
  await removeTestFolder(root);
});

const sizeTool = (input: unknown): ScriptedStep => ({ call: "save_size", input });

/** A session in the garage, its turns' owner messages and the steps each turn's model takes. */
const sessionWith = async (turns: readonly { say: string; steps: readonly ScriptedStep[] }[]) => {
  const saver = savingProvider(turns.map(({ steps }) => steps));
  const request = await asOwner(testWorker({ root, providers: [saver.provider] }));
  const [first, ...rest] = turns;
  const started = await postJson(request, "/api/workspaces/garage/sessions", {
    text: first?.say ?? "",
    model: SAVING_MODEL,
  });
  const session = SessionSummary.parse(await started.json());
  const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });
  for (const turn of rest) {
    await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: turn.say,
      model: SAVING_MODEL,
    });
    events.push(
      ...(await followSession(request, {
        sessionId: session.id,
        until: "turn-completed",
        after: events.at(-1)?.seq ?? 0,
      })),
    );
  }
  return { request, session, events, saver };
};

const sizeSaves = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "size-saved" ? [event] : []));

const sizesOf = async (request: Requester) =>
  Sizes.parse(await (await request("/api/fabrication/workspaces/garage/sizes")).json());

/** The records in the garage's `sizes` folder, as files. */
const recordFiles = async () => {
  const names = await readdir(join(garage(), "sizes"));
  return Promise.all(
    names.map(async (name) =>
      SizeRecord.parse(JSON.parse(await readFile(join(garage(), "sizes", name), "utf8"))),
    ),
  );
};

const LENGTH = { thing: "T1", property: "floor length", amount: 5137, unit: "mm" };

describe("the size tool", () => {
  it("records a measured size tied to the owner's message, one change with a note", async () => {
    const { events, session, request, saver } = await sessionWith([
      {
        say: "I measured the floor: 5137 mm.",
        steps: [sizeTool({ ...LENGTH, source: "measured" })],
      },
    ]);

    const [record] = await recordFiles();
    const asked = events.find((event) => event.type === "owner-message");
    expect(record).toMatchObject({
      property: "floor length",
      value: { kind: "quantity", value: 5137, unit: "mm" },
      source: { kind: "measured", said: { session: session.id, seq: asked?.seq } },
      revision: 1,
    });
    expect(record?.supersededBy).toBeUndefined();
    expect(sizeSaves(events)).toMatchObject([
      {
        save: {
          action: "add",
          size: { thing: "Garage", property: "floor length" },
          value: "5137 mm",
          source: "measured",
        },
        change: expect.any(String),
      },
    ]);
    expect((await changesIn(contextDir))[0]?.title).toBe("Record size: Garage, floor length");
    expect(saver.replies[0]?.[0]?.reply).toMatch(/^Recorded \[Z1\] floor length 5137 mm, measured/);
    // The Thing gets its subject ID with its first size, and the record is of it.
    expect(await readFile(join(garage(), "things", "garage.md"), "utf8")).toContain(
      `subject: ${record?.subject}`,
    );
    const { sizes } = await sizesOf(request);
    expect(sizes.map(({ thing, conflicts }) => ({ thing, conflicts }))).toEqual([
      { thing: { slug: "garage", name: "Garage" }, conflicts: [] },
    ]);
  });

  it("refuses measured for a value the owner never gave, or gave only roughly", async () => {
    const { saver, events } = await sessionWith([
      {
        say: "It's about 5137 mm long, I think.",
        steps: [
          sizeTool({ ...LENGTH, source: "measured" }),
          sizeTool({ ...LENGTH, amount: 2600, property: "width", source: "measured" }),
        ],
      },
    ]);

    const [rough, unsaid] = saver.replies[0] ?? [];
    expect(rough).toMatchObject({ ok: false });
    expect(rough?.reply).toContain("only roughly, so it's reported");
    expect(unsaid?.reply).toContain("hasn't given that value in this conversation");
    expect(sizeSaves(events)).toEqual([]);
  });

  it("keeps a rough value as reported", async () => {
    await sessionWith([
      { say: "It's about 5137 mm long.", steps: [sizeTool({ ...LENGTH, source: "reported" })] },
    ]);

    expect((await recordFiles())[0]?.source).toEqual({ kind: "reported" });
  });

  it("keeps two different values for the same size, each with the other as a conflict", async () => {
    const { request, saver } = await sessionWith([
      {
        say: "I measured the floor: 5137 mm.",
        steps: [sizeTool({ ...LENGTH, source: "measured" })],
      },
      {
        say: "The estate agent said 5200 mm.",
        steps: [sizeTool({ ...LENGTH, amount: 5200, source: "reported" })],
      },
    ]);

    const { sizes } = await sizesOf(request);
    const [measured, reported] = sizes;
    expect(sizes).toHaveLength(2);
    expect(measured?.conflicts).toEqual([reported?.record.id]);
    expect(reported?.conflicts).toEqual([measured?.record.id]);
    expect(saver.replies[1]?.[0]?.reply).toContain(
      "It differs from [Z1] 5137 mm, measured: both are kept",
    );
    expect(saver.framings[1]?.instructions).toContain(
      "[Z1] [T1] Garage: floor length 5137 mm, measured",
    );
  });

  it("corrects a size with the revision read, keeping the old record as superseded, and refuses a stale revision", async () => {
    const { request, saver } = await sessionWith([
      {
        say: "I measured the floor: 5137 mm.",
        steps: [sizeTool({ ...LENGTH, source: "measured" })],
      },
      {
        say: "Sorry, I measured again: 5173 mm.",
        steps: [
          sizeTool({ size: "Z1", revision: 1, amount: 5173, unit: "mm", source: "measured" }),
          sizeTool({ size: "Z1", revision: 1, amount: 5200, unit: "mm", source: "reported" }),
        ],
      },
    ]);

    const { sizes } = await sizesOf(request);
    const [old, now] = sizes;
    expect(old?.record.supersededBy).toBe(now?.record.id);
    expect(now?.record).toMatchObject({ revision: 2, value: { value: 5173 } });
    const [corrected, stale] = saver.replies[1] ?? [];
    expect(corrected?.reply).toMatch(
      /^Corrected \[Z1\] floor length 5173 mm, measured, revision 2/,
    );
    expect(stale).toMatchObject({ ok: false });
    expect(stale?.reply).toContain("Z1 has been corrected or changed since you were shown it.");
    expect(sizes).toHaveLength(2);
  });
});

describe("Undo", () => {
  it("from a size's note takes the record away, and Recent changes lists it", async () => {
    const { request, session, events } = await sessionWith([
      {
        say: "I measured the floor: 5137 mm.",
        steps: [sizeTool({ ...LENGTH, source: "measured" })],
      },
    ]);
    const [saved] = sizeSaves(events);

    const undone = await postJson(
      request,
      `/api/sessions/${session.id}/sizes/${saved?.seq}/undo`,
      {},
    );

    expect(undone.status).toBe(204);
    expect((await sizesOf(request)).sizes).toEqual([]);
    const { changes } = RecentChanges.parse(
      await (await request("/api/workspaces/garage/changes")).json(),
    );
    expect(changes.map(({ kind, size, undo }) => ({ kind, size, undo }))).toEqual([
      { kind: "undo", size: { did: "removed", name: "floor length: 5137 mm" }, undo: "none" },
      { kind: "size", size: { did: "added", name: "floor length: 5137 mm" }, undo: "undone" },
    ]);
  });

  it("of a size corrected since is refused, keeping the newer one", async () => {
    const { request, session, events } = await sessionWith([
      {
        say: "I measured the floor: 5137 mm.",
        steps: [sizeTool({ ...LENGTH, source: "measured" })],
      },
      {
        say: "Again: 5173 mm.",
        steps: [
          sizeTool({ size: "Z1", revision: 1, amount: 5173, unit: "mm", source: "measured" }),
        ],
      },
    ]);
    const [first] = sizeSaves(events);

    const undone = await postJson(
      request,
      `/api/sessions/${session.id}/sizes/${first?.seq}/undo`,
      {},
    );

    expect(undone.status).toBe(409);
    expect(await errorOf(undone)).toContain("That size has been corrected or changed since");
    expect((await sizesOf(request)).sizes).toHaveLength(2);
  });
});

describe("Fabrication's sizes", () => {
  it("reports a file that isn't a size record, and lists the rest", async () => {
    await mkdir(join(garage(), "sizes"), { recursive: true });
    await writeFile(join(garage(), "sizes", "notes.json"), "{ not json");
    const request = await asOwner(testWorker({ root, providers: [] }));

    expect(await sizesOf(request)).toEqual({
      sizes: [],
      problems: [{ path: "sizes/notes.json", problem: "It isn't JSON." }],
    });
  });

  it("is refused for a code workspace", async () => {
    const { repo } = await codeRepo(root);
    await codeWorkspace(root, "side-project", repo);
    const request = await asOwner(testWorker({ root, providers: [] }));

    const response = await request("/api/fabrication/workspaces/side-project/sizes");

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("Only planning workspaces keep sizes.");
  });
});
