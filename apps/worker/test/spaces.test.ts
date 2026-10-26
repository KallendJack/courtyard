import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BuildSizes, SpaceChanged, SpaceSizes } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { oldSizesIn } from "../src/features/fabrication/sizes/old-sizes.ts";
import {
  asOwner,
  changesIn,
  errorOf,
  postJson,
  type Requester,
  removeTestFolder,
  testWorker,
} from "./testing.ts";

// A space's sizes in Fabrication (#709): the room's Things panel, a size corrected with Undo, two
// answers settled, the old sizes in sentences confirmed once with a tick, and the sizes a space
// and its Builds need, each with where to measure it.

let root: string;
let contextDir: string;
const garage = () => join(contextDir, "garage");
const SPACE = "/api/fabrication/workspaces/garage/spaces/garage";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(join(garage(), "things"), { recursive: true });
  await mkdir(join(garage(), "projects"), { recursive: true });
  await writeFile(
    join(garage(), "CONTEXT.md"),
    "# Garage\n\n## Facts\n\n- The garage is about 2735 mm wide and 5137 mm long.\n- Ceiling height 2.45 m.\n",
  );
  await writeFile(
    join(garage(), "things", "garage.md"),
    "---\nname: Garage\nstatus: have\nkind: space\n---\n- 2026-10-01: Boiler on the back wall\n",
  );
  await writeFile(
    join(garage(), "things", "bench.md"),
    "---\nname: Bench\nstatus: have\n---\n",
  );
  await writeFile(
    join(garage(), "projects", "split-the-garage.md"),
    [
      "---",
      "name: Split the garage",
      "status: active",
      "---",
      "",
      "## Steps",
      "",
      "- [ ] Build the workbench [id: s1] [build: workbench] [needs: the back wall's width]",
      "",
      "## History",
      "",
      "- 2026-10-20: Measured the door roughly at 2.1 m",
      "",
    ].join("\n"),
  );
});

afterEach(async () => {
  await removeTestFolder(root);
});

const owner = () => asOwner(testWorker({ root }));

const spaceOf = async (request: Requester) =>
  SpaceSizes.parse(await (await request(SPACE)).json());

const changed = async (response: Response) => {
  expect(response.status).toBe(200);
  return SpaceChanged.parse(await response.json());
};

const quantity = (value: number, unit = "mm") => ({ kind: "quantity", value, unit });

describe("old sizes in sentences", () => {
  it("finds each length, a pair of sides as width and length, and says which were rough", () => {
    expect(
      oldSizesIn([
        { sentence: "About 2735 × 5137 mm inside.", from: "Facts", day: null },
        { sentence: "Ceiling height 2.45 m, door 2.1 m high.", from: "Facts", day: null },
      ]).map(({ property, value, rough }) => ({ property, value, rough })),
    ).toEqual([
      { property: "Inside width", value: quantity(2735), rough: true },
      { property: "Inside length", value: quantity(5137), rough: true },
      { property: "Floor to ceiling", value: quantity(2.45, "m"), rough: false },
      { property: "Floor to ceiling", value: quantity(2.1, "m"), rough: false },
    ]);
  });
});

describe("a space's sizes", () => {
  it("lists the sizes a space and its Builds need, with where to measure each", async () => {
    const request = await owner();
    const space = await spaceOf(request);

    expect(space.workspace.name).toBe("Garage");
    expect(space.space.thing).toEqual({ slug: "garage", name: "Garage", kind: "space" });
    expect(
      space.space.lines.map(({ property, where, builds, toMeasure }) => ({
        property,
        where,
        builds,
        toMeasure,
      })),
    ).toEqual([
      {
        property: "Inside width",
        where: "wall to wall, at the back, on the floor",
        builds: [],
        toMeasure: true,
      },
      { property: "Inside length", where: "back wall to the door", builds: [], toMeasure: true },
      {
        property: "Floor to ceiling",
        where: "floor to the lowest point overhead",
        builds: [],
        toMeasure: true,
      },
      {
        property: "Back wall's width",
        where: "for Build the workbench",
        builds: ["workbench"],
        toMeasure: true,
      },
    ]);
    expect(space.parts).toEqual([]);

    // A Build shows the same line, where its step needs it.
    const build = BuildSizes.parse(
      await (await request("/api/fabrication/workspaces/garage/builds/workbench/sizes")).json(),
    );
    expect(build.spaces.map(({ lines }) => lines.map(({ property }) => property))).toEqual([
      ["Back wall's width"],
    ]);
  });

  it("answers a Thing that isn't a space as not found", async () => {
    const request = await owner();
    const response = await request("/api/fabrication/workspaces/garage/spaces/bench");
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe("No such space.");
  });

  it("records a size measured in Fabrication, corrects it with the old value kept, and Undo takes it back", async () => {
    const request = await owner();
    const added = await changed(
      await postJson(request, `${SPACE}/sizes`, {
        thing: "garage",
        property: "Inside width",
        value: quantity(2735),
        source: "reported",
      }),
    );
    const [width] = added.sizes.space.lines;
    const record = width?.records[0];
    expect(record?.source).toEqual({ kind: "reported" });
    expect(width?.toMeasure).toBe(true);

    const corrected = await changed(
      await postJson(request, `${SPACE}/sizes/${record?.id}`, {
        revision: 1,
        value: quantity(2741),
        source: "measured",
      }),
    );
    const [now] = corrected.sizes.space.lines;
    expect(now?.records.map(({ value, source }) => ({ value, source: source.kind }))).toEqual([
      { value: quantity(2741), source: "measured" },
    ]);
    expect(now?.records[0]?.source).toEqual({
      kind: "measured",
      said: { fabrication: expect.any(String) },
    });
    expect(now?.was).toEqual({ value: quantity(2735), source: "reported" });
    expect(now?.toMeasure).toBe(false);
    expect((await changesIn(contextDir))[0]?.title).toBe("Correct size: Garage, Inside width");

    const undone = await postJson(request, `${SPACE}/changes/${corrected.change}/undo`, {});
    expect(undone.status).toBe(200);
    const back = SpaceSizes.parse(await undone.json());
    expect(back.space.lines[0]?.records.map(({ value }) => value)).toEqual([quantity(2735)]);
  });

  it("refuses a correction of a revision that's been corrected since", async () => {
    const request = await owner();
    const added = await changed(
      await postJson(request, `${SPACE}/sizes`, {
        thing: "garage",
        property: "Inside width",
        value: quantity(2735),
        source: "reported",
      }),
    );
    const id = added.sizes.space.lines[0]?.records[0]?.id;
    await postJson(request, `${SPACE}/sizes/${id}`, {
      revision: 1,
      value: quantity(2741),
      source: "measured",
    });
    const again = await postJson(request, `${SPACE}/sizes/${id}`, {
      revision: 1,
      value: quantity(2740),
      source: "measured",
    });
    expect(again.status).toBe(409);
  });

  it("shows two answers side by side, and settling them keeps one as one change", async () => {
    const request = await owner();
    for (const value of [2735, 2741]) {
      await postJson(request, `${SPACE}/sizes`, {
        thing: "bench",
        property: "Length",
        value: quantity(value),
        source: "measured",
      });
    }
    const space = await spaceOf(request);
    const [bench] = space.parts;
    expect(bench?.thing.name).toBe("Bench");
    const [length] = bench?.lines ?? [];
    expect(length?.records.map(({ value }) => value)).toEqual([quantity(2735), quantity(2741)]);
    expect(length?.toMeasure).toBe(true);

    const [other, kept] = length?.records ?? [];
    const settled = await changed(
      await postJson(request, `${SPACE}/sizes/${kept?.id}/keep`, {
        others: [{ id: other?.id, revision: other?.revision }],
      }),
    );
    const [after] = settled.sizes.parts[0]?.lines ?? [];
    expect(after?.records.map(({ value }) => value)).toEqual([quantity(2741)]);
    expect(after?.toMeasure).toBe(false);
  });

  it("offers the old sizes once, and records only what's ticked as measured", async () => {
    const request = await owner();
    const { oldSizes } = await spaceOf(request);
    expect(oldSizes.map(({ from, property, value, rough, day }) => ({ from, property, value, rough, day }))).toEqual([
      { from: "Facts", property: "Inside width", value: quantity(2735), rough: true, day: null },
      { from: "Facts", property: "Inside length", value: quantity(5137), rough: false, day: null },
      { from: "Facts", property: "Floor to ceiling", value: quantity(2.45, "m"), rough: false, day: null },
      {
        from: "Split the garage",
        property: "Door width",
        value: quantity(2.1, "m"),
        rough: true,
        day: "2026-10-20",
      },
    ]);

    const [width, length, , door] = oldSizes;
    const confirmed = await changed(
      await postJson(request, `${SPACE}/old-sizes`, {
        picks: [
          { key: width?.key, property: "Inside width", measured: false },
          { key: length?.key, property: "Inside length", measured: true },
          { key: door?.key, property: "Door height", measured: false },
        ],
      }),
    );
    expect(confirmed.sizes.oldSizes).toEqual([]);
    const lines = confirmed.sizes.space.lines;
    const sourceOf = (property: string) =>
      lines.find((line) => line.property === property)?.records.map(({ source }) => source.kind);
    expect(sourceOf("Inside width")).toEqual(["reported"]);
    expect(sourceOf("Inside length")).toEqual(["measured"]);
    expect(sourceOf("Floor to ceiling")).toEqual([]);
    expect(lines.find((line) => line.property === "Door height")?.records[0]?.observed).toBe(
      "2026-10-20",
    );
    expect((await changesIn(contextDir))[0]?.title).toBe("Confirm old sizes: Garage");
    expect((await spaceOf(request)).oldSizes).toEqual([]);

    // Undo offers them again.
    const undone = await postJson(request, `${SPACE}/changes/${confirmed.change}/undo`, {});
    expect(undone.status).toBe(200);
    expect(SpaceSizes.parse(await undone.json()).oldSizes).toHaveLength(4);
    expect(await readFile(join(garage(), "things", "garage.md"), "utf8")).not.toContain("subject:");
  });

  it("refuses a confirm of an old size that isn't listed any more", async () => {
    const request = await owner();
    const response = await postJson(request, `${SPACE}/old-sizes`, {
      picks: [{ key: "gone", property: "Inside width", measured: true }],
    });
    expect(response.status).toBe(409);
  });
});
