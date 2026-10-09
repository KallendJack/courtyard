import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RecentChanges,
  type SessionEvent,
  SessionSummary,
  THING_FORM_FIELD,
  THING_PHOTO_FIELD,
  ThingChanged,
  ThingDeleted,
  ThingDetail,
  ThingList,
} from "@courtyard/contract";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "./providers/index.ts";
import { pdfOf, pngOf, type TestFile } from "./test-files.ts";
import {
  asOwner,
  changesIn,
  errorOf,
  FAKE_MODEL,
  followSession,
  postJson,
  postWithFiles,
  type Requester,
  SAVING_MODEL,
  type ScriptedStep,
  savingProvider,
  sendJson,
  testWorker,
} from "./testing.ts";

// A workspace's Things (ADR 0020): the owner's kit, a file each, added, changed and removed by the
// owner and by a model's Things tool, each as one change with Undo.

let root: string;
let contextDir: string;
const thingsDir = () => join(contextDir, "mountain-biking", "things");
const thingFile = (slug: string) => readFile(join(thingsDir(), `${slug}.md`), "utf8");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(join(contextDir, "mountain-biking"), { recursive: true });
  await writeFile(
    join(contextDir, "mountain-biking", "CONTEXT.md"),
    "# Mountain biking\n\n## Facts\n\n- Rides on Sundays.\n",
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const owner = () => asOwner(testWorker({ root }));

const listed = async (request: Requester) =>
  ThingList.parse(await (await request("/api/workspaces/mountain-biking/things")).json());

const addThing = (request: Requester, body: unknown) =>
  postJson(request, "/api/workspaces/mountain-biking/things", body);

describe("the owner's Things", () => {
  it("adds a Thing as one change, its fields in front matter, and lists it", async () => {
    const request = await owner();

    const added = await addThing(request, {
      name: "Whyte T-140",
      status: "have",
      brand: "Whyte",
      bought: "2026-10",
      price: "£1,400",
      condition: "",
      partOf: null,
    });

    expect(added.status).toBe(201);
    expect(ThingChanged.parse(await added.json()).thing).toMatchObject({
      slug: "whyte-t-140",
      name: "Whyte T-140",
      path: "things/whyte-t-140.md",
      photo: false,
    });
    expect(await thingFile("whyte-t-140")).toBe(
      "---\nname: Whyte T-140\nstatus: have\nbrand: Whyte\nbought: 2026-10\nprice: £1,400\n---\n",
    );
    expect((await listed(request)).things).toMatchObject([
      { slug: "whyte-t-140", name: "Whyte T-140", status: "have", price: "£1,400" },
    ]);
    expect((await changesIn(contextDir))[0]).toEqual({
      title: "Add Thing: Whyte T-140",
      trailers: [
        "Courtyard-Change: thing",
        "Courtyard-Place: workspace/mountain-biking",
        "Courtyard-File: mountain-biking/things/whyte-t-140.md",
      ],
    });
  });
});

const BIKE = "---\nname: Whyte T-140\nstatus: have\nbought: 2026-10\nprice: £1,400\n---\n";
const CHAIN =
  "---\nname: Chain\nstatus: have\nbrand: KMC X11\nbought: 2026-03\npart of: whyte-t-140\n---\n\n- 2026-03-14: fitted with the new cassette\n";

/** Mountain biking's kit: the bike, and its chain as a part of it. */
const withKit = async () => {
  await mkdir(thingsDir(), { recursive: true });
  await writeFile(join(thingsDir(), "whyte-t-140.md"), BIKE);
  await writeFile(join(thingsDir(), "chain.md"), CHAIN);
};

const changeThing = (request: Requester, slug: string, body: unknown) =>
  sendJson(request, `/api/workspaces/mountain-biking/things/${slug}`, "PUT", body);

const deleteThing = (request: Requester, slug: string) =>
  sendJson(request, `/api/workspaces/mountain-biking/things/${slug}`, "DELETE", {});

const changesListed = async (request: Requester) =>
  RecentChanges.parse(await (await request("/api/workspaces/mountain-biking/changes")).json())
    .changes;

const undoChange = (request: Requester, id: string) =>
  postJson(request, `/api/changes/${id}/undo`, {});

const errorFrom = async (response: Response) => [response.status, await errorOf(response)];

describe("the owner's Things, changed", () => {
  it("lists each part straight after the Thing it's part of, and gives a Thing's history newest first", async () => {
    await withKit();
    await writeFile(join(thingsDir(), "helmet.md"), "---\nname: Helmet\nstatus: want\n---\n");
    const request = await owner();

    expect((await listed(request)).things.map(({ name, partOf }) => [name, partOf])).toEqual([
      ["Helmet", undefined],
      ["Whyte T-140", undefined],
      ["Chain", "whyte-t-140"],
    ]);
    await writeFile(join(thingsDir(), "chain.md"), `${CHAIN}- 2026-10-09: swapped\n`);
    const detail = ThingDetail.parse(
      await (await request("/api/workspaces/mountain-biking/things/chain")).json(),
    );
    expect(detail.history).toEqual([
      { date: "2026-10-09", text: "swapped" },
      { date: "2026-03-14", text: "fitted with the new cassette" },
    ]);
  });

  it("changes a Thing's fields from the form, keeping its history, as one change", async () => {
    await withKit();
    const request = await owner();

    const changed = await changeThing(request, "chain", {
      name: "Chain",
      status: "replace",
      brand: "KMC X11",
      bought: "2026-03",
      condition: "Stretched",
      partOf: "whyte-t-140",
    });

    expect(changed.status).toBe(200);
    expect(await thingFile("chain")).toBe(
      "---\nname: Chain\nstatus: replace\nbrand: KMC X11\nbought: 2026-03\ncondition: Stretched\npart of: whyte-t-140\n---\n\n- 2026-03-14: fitted with the new cassette\n",
    );
    expect((await changesIn(contextDir))[0]?.title).toBe("Change Thing: Chain");
  });

  it("refuses a part of a part, a missing parent, a clashing name, a bad date and a Thing with parts deleted", async () => {
    await withKit();
    const request = await owner();

    expect(
      await errorFrom(
        await addThing(request, { name: "Chain link", status: "have", partOf: "chain" }),
      ),
    ).toEqual([400, expect.stringContaining("isn't a part itself")]);
    expect(
      await errorFrom(await addThing(request, { name: "Pedals", status: "want", partOf: "trek" })),
    ).toEqual([400, "The Thing it's part of isn't there."]);
    expect(await errorFrom(await addThing(request, { name: "chain", status: "want" }))).toEqual([
      409,
      "There's already a Thing called Chain. Choose another name.",
    ]);
    expect(
      await errorFrom(await addThing(request, { name: "Tyres", status: "have", bought: "May" })),
    ).toEqual([400, expect.stringContaining("as a year, a month or a day")]);
    expect(await errorFrom(await deleteThing(request, "whyte-t-140"))).toEqual([
      409,
      "Its parts come first: delete Chain, or make them part of something else.",
    ]);
  });

  it("deletes a Thing as one change, which Undo from Recent changes brings back", async () => {
    await withKit();
    const request = await owner();

    const deleted = ThingDeleted.parse(await (await deleteThing(request, "chain")).json());

    expect((await listed(request)).things.map(({ name }) => name)).toEqual(["Whyte T-140"]);
    const [listedChange] = await changesListed(request);
    expect(listedChange).toMatchObject({
      id: deleted.change,
      kind: "thing",
      thing: { did: "removed", name: "Chain", slug: null },
      removed: [],
      added: [],
      undo: "available",
    });
    expect((await undoChange(request, deleted.change ?? "")).status).toBe(204);
    expect(await thingFile("chain")).toBe(CHAIN);
    expect(await changesListed(request)).toMatchObject([
      { kind: "undo", thing: { did: "added", name: "Chain", slug: "chain" } },
      { kind: "thing", undo: "undone" },
    ]);
  });

  it("lists a hand-edited file that isn't a Thing with its problem, and the rest as usual", async () => {
    await withKit();
    await writeFile(join(thingsDir(), "fork.md"), "---\nname: Fork\nstatus: broken\n---\n");
    await writeFile(join(thingsDir(), "notes.md"), "Just some notes.\n");
    const request = await owner();

    const { things, problems } = await listed(request);

    expect(things.map(({ name }) => name)).toEqual(["Whyte T-140", "Chain"]);
    expect(problems).toEqual([
      { path: "things/fork.md", problem: "Its status isn't have, want or replace." },
      { path: "things/notes.md", problem: "It doesn't start with its fields between --- lines." },
    ]);
  });

  it("is only in a planning workspace", async () => {
    await writeFile(
      join(contextDir, "mountain-biking", "workspace.json"),
      JSON.stringify({ mode: "code", repoPath: "/path/to/repo" }),
    );
    const request = await owner();

    expect((await request("/api/workspaces/mountain-biking/things")).status).toBe(409);
  });
});

/** A photo bigger than a Thing keeps: 2400 by 1800, shaded corner to corner. */
const BIG_PHOTO = pngOf(2400, 1800, (x, y) => [
  Math.floor((x / 2400) * 255),
  Math.floor((y / 1800) * 255),
  (x + y) % 64,
]);

const uploadPhoto = (request: Requester, slug: string, file: File) => {
  const form = new FormData();
  form.set(THING_PHOTO_FIELD, file);
  return request(`/api/workspaces/mountain-biking/things/${slug}/photo`, {
    method: "POST",
    body: form,
  });
};

const photoFile = () => readFile(join(thingsDir(), "photos", "chain.jpg"));

/** Adds or changes a Thing from the form with a photo, the way the web app does: one multipart form. */
const sendThingWithPhoto = (
  request: Requester,
  method: "POST" | "PUT",
  path: string,
  thing: unknown,
  photo: File,
) => {
  const form = new FormData();
  form.set(THING_FORM_FIELD, JSON.stringify(thing));
  form.set(THING_PHOTO_FIELD, photo);
  return request(`/api/workspaces/mountain-biking/${path}`, { method, body: form });
};

describe("a Thing's photo", () => {
  it("is uploaded, kept resized as a JPEG beside the Thing, which points at it, and served", async () => {
    await withKit();
    const request = await owner();

    const uploaded = await uploadPhoto(
      request,
      "chain",
      new File([BIG_PHOTO], "chain.png", { type: "image/png" }),
    );

    expect(uploaded.status).toBe(200);
    expect(ThingChanged.parse(await uploaded.json()).thing.photo).toBe(true);
    const kept = await photoFile();
    const { width, height, format } = await sharp(kept).metadata();
    expect([format, width, height]).toEqual(["jpeg", 1600, 1200]);
    expect(kept.length).toBeLessThanOrEqual(300 * 1024);
    expect(await thingFile("chain")).toContain("part of: whyte-t-140\nphoto: photos/chain.jpg\n");
    expect((await changesIn(contextDir))[0]).toEqual({
      title: "Change Thing: Chain",
      trailers: [
        "Courtyard-Change: thing",
        "Courtyard-Place: workspace/mountain-biking",
        "Courtyard-File: mountain-biking/things/chain.md",
        "Courtyard-File: mountain-biking/things/photos/chain.jpg",
      ],
    });
    const served = await request("/api/workspaces/mountain-biking/things/chain/photo");
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await served.arrayBuffer()).equals(kept)).toBe(true);
  });

  it("is put back as it was by Undo, bytes and all", async () => {
    await withKit();
    const request = await owner();
    const photo = (colour: number) =>
      new File([pngOf(40, 30, () => [colour, 90, 30])], "chain.png", { type: "image/png" });
    await uploadPhoto(request, "chain", photo(200));
    const first = await photoFile();
    const second = ThingChanged.parse(
      await (await uploadPhoto(request, "chain", photo(20))).json(),
    );

    expect((await undoChange(request, second.change ?? "")).status).toBe(204);

    expect((await photoFile()).equals(first)).toBe(true);
  });

  it("comes with a Thing added from the form, as one change", async () => {
    await withKit();
    const request = await owner();
    const photo = new File([BIG_PHOTO], "pump.png", { type: "image/png" });

    const added = await sendThingWithPhoto(
      request,
      "POST",
      "things",
      { name: "Pump", status: "want" },
      photo,
    );

    expect(added.status).toBe(201);
    expect(ThingChanged.parse(await added.json()).thing).toMatchObject({
      slug: "pump",
      photo: true,
    });
    expect(await thingFile("pump")).toBe(
      "---\nname: Pump\nstatus: want\nphoto: photos/pump.jpg\n---\n",
    );
    const changes = await changesIn(contextDir);
    expect(changes[0]).toEqual({
      title: "Add Thing: Pump",
      trailers: [
        "Courtyard-Change: thing",
        "Courtyard-Place: workspace/mountain-biking",
        "Courtyard-File: mountain-biking/things/pump.md",
        "Courtyard-File: mountain-biking/things/photos/pump.jpg",
      ],
    });
    expect(changes[1]?.title).not.toBe("Add Thing: Pump");
  });

  it("comes with a Thing changed from the form, fields and photo as one change, which one Undo takes back", async () => {
    await withKit();
    const request = await owner();
    const photo = new File([BIG_PHOTO], "chain.png", { type: "image/png" });

    const changed = await sendThingWithPhoto(
      request,
      "PUT",
      "things/chain",
      {
        name: "Chain",
        status: "replace",
        brand: "KMC X11",
        bought: "2026-03",
        partOf: "whyte-t-140",
      },
      photo,
    );

    expect(changed.status).toBe(200);
    const saved = ThingChanged.parse(await changed.json());
    expect(saved.thing).toMatchObject({ status: "replace", photo: true });
    expect((await changesIn(contextDir))[0]?.title).toBe("Change Thing: Chain");
    expect((await undoChange(request, saved.change ?? "")).status).toBe(204);
    expect(await thingFile("chain")).toBe(CHAIN);
    await expect(photoFile()).rejects.toThrow();
  });

  it("comes with an edit that changes no field, as a change of the photo alone", async () => {
    await withKit();
    const request = await owner();
    const photo = new File([BIG_PHOTO], "chain.png", { type: "image/png" });

    const changed = await sendThingWithPhoto(
      request,
      "PUT",
      "things/chain",
      { name: "Chain", status: "have", brand: "KMC X11", bought: "2026-03", partOf: "whyte-t-140" },
      photo,
    );

    expect(changed.status).toBe(200);
    expect(ThingChanged.parse(await changed.json()).thing.photo).toBe(true);
  });

  it("refuses a file that isn't a photo, or isn't the kind it says", async () => {
    await withKit();
    const request = await owner();

    const pdf = await uploadPhoto(
      request,
      "chain",
      new File([pdfOf(["Manual"])], "manual.pdf", { type: "application/pdf" }),
    );
    const fake = await uploadPhoto(
      request,
      "chain",
      new File(["not a photo"], "chain.jpg", { type: "image/jpeg" }),
    );

    expect(await errorFrom(pdf)).toEqual([400, "A Thing's photo is a photo, not a PDF."]);
    expect(await errorFrom(fake)).toEqual([400, "chain.jpg isn't the kind of file its name says."]);
  });
});

/** 9 October 2026, midday: the day the tool dates history lines. */
const TODAY = Date.UTC(2026, 9, 9, 12);

const thingTool = (input: unknown): ScriptedStep => ({ call: "save_thing", input });

/** A session in mountain biking whose turns follow the scripted steps, the first sent with `files`. */
const sessionWith = async (
  turns: readonly (readonly ScriptedStep[])[],
  files: readonly TestFile[] = [],
) => {
  const saver = savingProvider(turns);
  const request = await asOwner(
    testWorker({ root, providers: [saver.provider], now: () => TODAY }),
  );
  const started = await postWithFiles(
    request,
    "/api/workspaces/mountain-biking/sessions",
    { text: "Swapped the chain today.", model: SAVING_MODEL },
    files,
  );
  const session = SessionSummary.parse(await started.json());
  const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });
  for (const _ of turns.slice(1)) {
    await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "And then?",
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

const thingSaves = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "thing-saved" ? [event] : []));

const reasons = (replies: readonly { reply: string }[] | undefined) =>
  (replies ?? []).map(({ reply }) => reply);

describe("the Things tool", () => {
  it("changes the Thing a label names, adding a history line dated today, as one change with a note", async () => {
    await withKit();
    // Whyte T-140 is T1 and its chain T2, straight after it.
    const { saver, events, session } = await sessionWith([
      [
        thingTool({
          thing: "T2",
          bought: "2026-10-09",
          price: "£32",
          history: "Swapped, the old one was past 0.75%",
        }),
      ],
    ]);

    expect(saver.replies[0]).toEqual([{ ok: true, reply: "Changed [T2] Chain." }]);
    expect(await thingFile("chain")).toBe(
      "---\nname: Chain\nstatus: have\nbrand: KMC X11\nbought: 2026-10-09\nprice: £32\npart of: whyte-t-140\n---\n\n- 2026-03-14: fitted with the new cassette\n- 2026-10-09: Swapped, the old one was past 0.75%\n",
    );
    expect(thingSaves(events)).toMatchObject([
      {
        save: {
          action: "change",
          thing: { slug: "chain", name: "Chain" },
          fields: { bought: "2026-10-09", price: "£32" },
          history: "Swapped, the old one was past 0.75%",
        },
        change: expect.any(String),
      },
    ]);
    expect((await changesIn(contextDir))[0]).toEqual({
      title: "Change Thing: Chain",
      trailers: [
        "Courtyard-Change: thing",
        "Courtyard-Place: workspace/mountain-biking",
        `Courtyard-Session: ${session.id}`,
        "Courtyard-File: mountain-biking/things/chain.md",
      ],
    });
  });

  it("adds a Thing, then a part of it by the label it was given, and removes one", async () => {
    await withKit();
    const { saver } = await sessionWith([
      [
        thingTool({ name: "Trek Fuel EX", status: "want", price: "about £3,000" }),
        thingTool({ name: "Dropper post", status: "want", part_of: "T3" }),
        thingTool({ thing: "T2", remove: true }),
      ],
    ]);

    expect(reasons(saver.replies[0])).toEqual([
      "Added [T3] Trek Fuel EX.",
      "Added [T4] Dropper post.",
      "Removed Chain.",
    ]);
    expect(await thingFile("dropper-post")).toBe(
      "---\nname: Dropper post\nstatus: want\npart of: trek-fuel-ex\n---\n",
    );
    expect(await thingFile("chain").catch(() => null)).toBe(null);
  });

  it("refuses a bad label, a part of a part and a new Thing with no status, then takes one retry", async () => {
    await withKit();
    const { saver, events } = await sessionWith([
      [
        thingTool({ thing: "T9", history: "Cleaned" }),
        thingTool({ thing: "T1", history: "Cleaned" }),
        thingTool({ name: "Chain link", status: "have", part_of: "T2" }),
        thingTool({ name: "Chain link", part_of: "T2" }),
        thingTool({ name: "Pump", status: "have" }),
      ],
    ]);

    expect(reasons(saver.replies[0])).toEqual([
      "There's no Thing labelled T9: the Things are listed in your instructions.\n\nYou can put it right and try once more.",
      "Changed [T1] Whyte T-140.",
      "A Thing can be part of only one that isn't a part itself, and a Thing with parts can't be part of another.\n\nYou can put it right and try once more.",
      "A new Thing needs a name and a status: have, want or replace.\n\nCarry on without saving it.",
      "Added [T3] Pump.",
    ]);
    expect(thingSaves(events)).toHaveLength(2);
  });

  it("refuses a label whose Thing changed since the model was shown it, giving the Things as they are now", async () => {
    await withKit();
    const { saver } = await sessionWith([
      [
        () =>
          writeFile(
            join(thingsDir(), "chain.md"),
            CHAIN.replace("status: have", "status: replace"),
          ),
        thingTool({ thing: "T2", history: "Waxed" }),
        thingTool({ thing: "T2", history: "Waxed" }),
      ],
    ]);

    const [stale, retried] = reasons(saver.replies[0]);
    expect(stale).toBe(
      "T2 has changed since you were shown it. The Things now, whose labels count from here on:\n[T1] Whyte T-140, have, bought 2026-10, price £1,400 (things/whyte-t-140.md)\n[T2] Chain, replace, KMC X11, bought 2026-03, part of [T1] (things/chain.md)\n\nYou can put it right and try once more.",
    );
    expect(retried).toBe("Changed [T2] Chain.");
    expect(await thingFile("chain")).toContain("status: replace");
  });

  it("sets a Thing's photo from one the owner attached in the session, by its number", async () => {
    await withKit();
    const photo = {
      name: "chain.png",
      type: "image/png",
      bytes: pngOf(64, 48, () => [40, 90, 200]),
    };
    const { saver } = await sessionWith(
      [[thingTool({ thing: "T2", photo: 2 }), thingTool({ thing: "T2", photo: 1 })]],
      [photo],
    );

    expect(reasons(saver.replies[0])).toEqual([
      "There's no photo 2 with this message: give the number of one of the images that come with it, as Image 1 is 1.\n\nYou can put it right and try once more.",
      "Changed [T2] Chain.",
    ]);
    const { width, format } = await sharp(await photoFile()).metadata();
    expect([format, width]).toEqual(["jpeg", 64]);
    expect(await thingFile("chain")).toContain("photo: photos/chain.jpg\n");
  });

  it("is undone from its note, photo and all, unless the Thing has changed since", async () => {
    await withKit();
    const { request, session, events } = await sessionWith([
      [
        thingTool({ thing: "T2", history: "Waxed" }),
        thingTool({ thing: "T1", condition: "Muddy" }),
      ],
    ]);
    const [waxed, muddy] = thingSaves(events);

    const undone = await postJson(
      request,
      `/api/sessions/${session.id}/things/${waxed?.seq ?? 0}/undo`,
      {},
    );
    await writeFile(join(thingsDir(), "whyte-t-140.md"), BIKE);
    const refused = await postJson(
      request,
      `/api/sessions/${session.id}/things/${muddy?.seq ?? 0}/undo`,
      {},
    );

    expect(undone.status).toBe(204);
    expect(await thingFile("chain")).toBe(CHAIN);
    const after = await followSession(request, { sessionId: session.id, until: "thing-undone" });
    expect(after.at(-1)).toMatchObject({ type: "thing-undone", save: waxed?.seq });
    expect(await errorFrom(refused)).toEqual([
      409,
      "That Thing has changed since, so undoing this would lose the newer change.",
    ]);
  });

  it("is scripted on the fake, one line a save", async () => {
    await withKit();
    const request = await asOwner(
      testWorker({ root, providers: [createFakeProvider({ delayMs: 0 })], now: () => TODAY }),
    );
    const started = await postJson(request, "/api/workspaces/mountain-biking/sessions", {
      text: [
        "thing add: name Tyres | status have | brand Maxxis Minion DHF | part of T1",
        "thing T2: history Swapped | price £32",
        "thing T9: remove",
      ].join("\n"),
      model: FAKE_MODEL,
    });
    const session = SessionSummary.parse(await started.json());
    const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });

    expect(thingSaves(events).map(({ save }) => [save.action, save.thing.name])).toEqual([
      ["add", "Tyres"],
      ["change", "Chain"],
    ]);
    expect(await thingFile("tyres")).toBe(
      "---\nname: Tyres\nstatus: have\nbrand: Maxxis Minion DHF\npart of: whyte-t-140\n---\n",
    );
  });
});
