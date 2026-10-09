import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RecentChanges,
  THING_PHOTO_FIELD,
  ThingChanged,
  ThingDeleted,
  ThingDetail,
  ThingList,
} from "@courtyard/contract";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pdfOf, pngOf } from "./test-files.ts";
import {
  asOwner,
  changesIn,
  errorOf,
  postJson,
  type Requester,
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
