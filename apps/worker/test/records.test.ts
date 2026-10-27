import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BuildChanged, BuildView, PlanningHome, type SizeRecord } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { goldenBench } from "../../../packages/fabrication/bench/fixtures/golden.ts";
import {
  asOwner,
  errorOf,
  type Requester,
  removeTestFolder,
  sendJson,
  testWorker,
  writeSizeRecords,
} from "./testing.ts";

// Records take over (ADR 0037, #711): a Build's sizes point at the space's size records, and its
// tools are the owner's; Home reads a space's size and a floor plan's check from the records.

let root: string;
let contextDir: string;
const garage = () => join(contextDir, "garage");

const SUBJECT = "6f1c2a52-8a0e-4c4f-9a43-2d7f3c1b9e01";
const HEIGHT = "0b8f7a3e-5c1d-4e2a-9f60-7a1b2c3d4e51";
const CORRECTED = "0b8f7a3e-5c1d-4e2a-9f60-7a1b2c3d4e52";

/** A size record of the garage, as the test writes it. */
const record = (fields: Partial<SizeRecord> & Pick<SizeRecord, "id" | "property" | "value">) =>
  fields;

const writeRecords = (...records: Parameters<typeof record>[0][]) =>
  writeSizeRecords(garage(), SUBJECT, ...records);

const OWNER_SAID = { session: "9d2e4f60-1a2b-4c3d-8e9f-0a1b2c3d4e5f", seq: 3 };
const MEASURED = { kind: "measured", said: OWNER_SAID } as SizeRecord["source"];

/** A record of the garage's, by the last digit of its ID. */
const id = (last: number) => `5a1d2c3b-4e5f-4a6b-8c7d-00000000000${last}` as SizeRecord["id"];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(join(garage(), "things"), { recursive: true });
  await mkdir(join(garage(), "builds"), { recursive: true });
  await writeFile(join(garage(), "CONTEXT.md"), "# Garage\n");
  await writeFile(
    join(garage(), "things", "garage.md"),
    `---\nname: Garage\nstatus: have\nkind: space\nsubject: ${SUBJECT}\n---\n`,
  );
  await writeFile(
    join(garage(), "builds", "workbench.json"),
    JSON.stringify({ name: "Workbench", template: "framed-bench", parameters: goldenBench }),
  );
});

afterEach(async () => {
  await removeTestFolder(root);
});

const buildFile = async (): Promise<unknown> =>
  JSON.parse(await readFile(join(garage(), "builds", "workbench.json"), "utf8"));

const patch = (request: Awaited<ReturnType<typeof asOwner>>, parameters: unknown) =>
  sendJson(request, "/api/fabrication/workspaces/garage/builds/workbench/parameters", "PATCH", {
    parameters,
  });

describe("a Build's tools", () => {
  it("are the owner's once they've saved any: a save leaves the Build none of its own", async () => {
    await mkdir(join(contextDir, "things"), { recursive: true });
    await writeFile(
      join(contextDir, "things", "hand-saw.md"),
      "---\nname: Hand saw\nstatus: have\nkind: tool\n---\n",
    );
    const request = await asOwner(testWorker({ root }));

    const response = await patch(request, {
      height: { value: 850 },
      tools: ["tape-measure", "circular-saw"],
    });

    expect(response.status).toBe(200);
    expect(await buildFile()).toMatchObject({
      parameters: expect.not.objectContaining({ tools: expect.anything() }),
    });
  });

  it("are the Build's own until the owner saves any", async () => {
    const request = await asOwner(testWorker({ root }));

    await patch(request, { height: { value: 850 } });

    expect(await buildFile()).toMatchObject({ parameters: { tools: goldenBench.tools } });
  });
});

describe("a Build's sizes", () => {
  it("point at a size record, which the Build is worked out from, in mm and with its source", async () => {
    await writeRecords(
      record({
        id: HEIGHT as SizeRecord["id"],
        property: "bench height",
        value: { kind: "quantity", value: 85, unit: "cm" },
        source: MEASURED,
      }),
    );
    const request = await asOwner(testWorker({ root }));

    // Given as the record's file, as the model's list of sizes shows it, over the size there.
    const response = await patch(request, { height: { record: `sizes/${HEIGHT}.json` } });

    expect(response.status).toBe(200);
    const changed = BuildChanged.parse(await response.json());
    // To the whole mm, as the owner is told it: the castors' plates sit a little under.
    expect(Math.round(changed.build.derived.size.height)).toBe(850);
    // The file holds only the pointer, never a copy of the value.
    expect(await buildFile()).toMatchObject({ parameters: { height: { record: HEIGHT } } });
    expect((await buildFile()) as { parameters: { height: object } }).toMatchObject({
      parameters: { height: expect.not.objectContaining({ value: expect.anything() }) },
    });
  });

  it("follow a record's correction, and an estimate counts as assumed", async () => {
    await writeRecords(
      record({
        id: HEIGHT as SizeRecord["id"],
        property: "bench height",
        value: { kind: "quantity", value: 85, unit: "cm" },
        supersededBy: CORRECTED as SizeRecord["id"],
      }),
      record({
        id: CORRECTED as SizeRecord["id"],
        property: "bench height",
        value: { kind: "quantity", value: 0.87, unit: "m" },
        source: { kind: "estimated" },
        revision: 2,
        recorded: "2026-10-25T10:00:00.000Z",
      }),
    );
    const request = await asOwner(testWorker({ root }));

    await patch(request, { height: { record: HEIGHT } });

    const view = BuildView.parse(
      await (await request("/api/fabrication/workspaces/garage/builds/workbench")).json(),
    );
    expect(Math.round(view.derived.size.height)).toBe(870);
    expect(view.derived.findings).toContainEqual(
      expect.objectContaining({
        kind: "assumed",
        sizes: expect.arrayContaining([expect.stringMatching(/^height/)]),
      }),
    );
  });

  it("refuses a record that isn't there, or isn't a length, saving nothing", async () => {
    await writeRecords(
      record({
        id: HEIGHT as SizeRecord["id"],
        property: "wall",
        value: { kind: "text", text: "stud partition" },
      }),
    );
    const request = await asOwner(testWorker({ root }));

    const missing = await patch(request, { height: { record: CORRECTED } });
    const words = await patch(request, { height: { record: HEIGHT } });

    expect(missing.status).toBe(400);
    expect(await errorOf(missing)).toMatch(/height: there's no size record/);
    expect(words.status).toBe(400);
    expect(await errorOf(words)).toMatch(/height: wall isn't a length/);
    expect(await buildFile()).toMatchObject({ parameters: { height: goldenBench.height } });
  });
});

const garageHome = async (request: Requester) =>
  PlanningHome.parse(await (await request("/api/workspaces/garage/home")).json());

/** The garage's floor recorded: its length and width, each with this source. */
const floorRecorded = (source: SizeRecord["source"], length = 5140, width = 2740) =>
  writeRecords(
    record({
      id: id(1),
      property: "floor length",
      value: { kind: "quantity", value: length, unit: "mm" },
      source,
    }),
    record({
      id: id(2),
      property: "floor width",
      value: { kind: "quantity", value: width, unit: "mm" },
      source,
    }),
  );

describe("a space on Home (#604)", () => {
  it("is the space Thing whose floor is recorded, with its size and every standing record of it", async () => {
    await floorRecorded(MEASURED);
    await writeRecords(
      record({
        id: id(3),
        property: "height",
        value: { kind: "quantity", value: 2.3, unit: "m" },
        supersededBy: id(4),
      }),
      record({
        id: id(4),
        property: "height",
        value: { kind: "quantity", value: 2.45, unit: "m" },
        revision: 2,
        recorded: "2026-10-25T10:00:00.000Z",
      }),
      record({ id: id(5), property: "back wall", value: { kind: "text", text: "brick" } }),
    );
    // A size written as a sentence is never read as one.
    await writeFile(join(garage(), "CONTEXT.md"), "# Garage\n\n## Facts\n\n- It's 9 × 9 m.\n");
    const request = await asOwner(testWorker({ root }));

    expect((await garageHome(request)).subject).toEqual({
      kind: "space",
      name: "garage",
      size: "5140 mm × 2740 mm",
      measurements: [
        "Floor length 5140 mm, measured",
        "Floor width 2740 mm, measured",
        "Back wall brick, reported",
        "Height 2.45 m, reported",
      ],
    });
  });

  it("isn't there without both sides of its floor recorded, nor while two lengths differ", async () => {
    await writeRecords(
      record({
        id: id(1),
        property: "floor length",
        value: { kind: "quantity", value: 5140, unit: "mm" },
      }),
    );
    const request = await asOwner(testWorker({ root }));
    expect((await garageHome(request)).subject).toBeNull();

    await writeRecords(
      record({
        id: id(2),
        property: "floor width",
        value: { kind: "quantity", value: 2740, unit: "mm" },
      }),
      record({
        id: id(3),
        property: "floor length",
        value: { kind: "quantity", value: 5200, unit: "mm" },
      }),
    );
    expect((await garageHome(request)).subject).toBeNull();
  });
});

/** The garage's floor plan, saved as its document, `width` × `depth` cm. */
const planSaved = async (width: number, depth: number, measured?: boolean) => {
  await mkdir(join(garage(), "docs"), { recursive: true });
  const plan = { room: "Garage", width, depth, ...(measured === undefined ? {} : { measured }) };
  await writeFile(
    join(garage(), "docs", "garage-floor-plan.md"),
    `# Garage floor plan\n\n\`\`\`plan\n${JSON.stringify(plan)}\n\`\`\`\n`,
  );
};

describe("a floor plan's size, against the space's records", () => {
  it("is shown as measured when it's the size measured, either way round", async () => {
    await floorRecorded(MEASURED);
    await planSaved(274, 514);
    const request = await asOwner(testWorker({ root }));

    expect((await garageHome(request)).subject).toMatchObject({
      kind: "plan",
      plan: { width: 274, depth: 514, measured: true },
      check: { kind: "measured" },
    });
  });

  it("is flagged, and drawn as unmeasured, when it isn't the size recorded", async () => {
    await floorRecorded(MEASURED);
    // As the model last drew it, sure of its sizes.
    await planSaved(300, 540, true);
    const request = await asOwner(testWorker({ root }));

    expect((await garageHome(request)).subject).toMatchObject({
      kind: "plan",
      plan: { width: 300, depth: 540, measured: false },
      check: { kind: "differs", recorded: "5140 mm × 2740 mm" },
    });
  });

  it("is drawn as unmeasured when the size recorded is only an estimate", async () => {
    await floorRecorded({ kind: "estimated" });
    await planSaved(274, 514, true);
    const request = await asOwner(testWorker({ root }));

    expect((await garageHome(request)).subject).toMatchObject({
      kind: "plan",
      plan: { measured: false },
      check: { kind: "unmeasured" },
    });
  });

  it("is left as drawn when the space has no floor recorded", async () => {
    await planSaved(274, 514, true);
    const request = await asOwner(testWorker({ root }));

    const subject = (await garageHome(request)).subject;
    expect(subject).toMatchObject({ kind: "plan", plan: { measured: true } });
    expect(subject).not.toHaveProperty("check");
  });
});
