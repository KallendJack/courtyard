import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BuildOpened, BuildProgress } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { goldenBench } from "../../../packages/fabrication/bench/fixtures/golden.ts";
import { createFakeProvider } from "../src/providers/fake.ts";
import {
  asOwner,
  changesIn,
  errorOf,
  type Requester,
  removeTestFolder,
  sendJson,
  testWorker,
} from "./testing.ts";

// How far the owner has got with a Build's steps (#699): kept on the Build, so the Fold, the PC
// and a new session all open where they left off, and never listed as a change to undo.

let root: string;
let contextDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(join(contextDir, "garage", "builds"), { recursive: true });
  await writeFile(join(contextDir, "garage", "CONTEXT.md"), "# Garage\n");
  await writeFile(
    join(contextDir, "garage", "builds", "workbench.json"),
    JSON.stringify({ name: "Workbench", template: "framed-bench", parameters: goldenBench }),
  );
});

afterEach(async () => {
  await removeTestFolder(root);
});

const BUILD = "/api/fabrication/workspaces/garage/builds/workbench";

const owner = () => asOwner(testWorker({ root, providers: [createFakeProvider({ delayMs: 0 })] }));

const opened = async (request: Requester) => BuildOpened.parse(await (await request(BUILD)).json());

const keep = (request: Requester, progress: unknown) =>
  sendJson(request, `${BUILD}/progress`, "PUT", progress);

describe("a Build's progress", () => {
  it("starts with no step reached and nothing ticked", async () => {
    const request = await owner();

    expect((await opened(request)).progress).toEqual({
      step: null,
      ticked: [],
      ways: [],
      buying: [],
      parked: [],
      labelled: [],
    });
  });

  it("is kept, so the Build opens at the step reached with its lines ticked", async () => {
    const request = await owner();
    const progress = {
      step: "end-frames",
      ticked: [
        { step: "fit-castors", lines: [0, 1, 2] },
        { step: "end-frames", lines: [0, 1] },
      ],
    };

    const kept = await keep(request, progress);

    expect(kept.status).toBe(200);
    // The castor step started keeps the lines it was started on (#783).
    const ways = [{ step: "fit-castors", tool: "through-plate" }];
    const all = { ...progress, ways, buying: [], parked: [], labelled: [] };
    expect(BuildProgress.parse(await kept.json())).toEqual(all);
    // Read from the Build again, as another device opening it would.
    expect((await opened(request)).progress).toEqual(all);
  });

  it("isn't a change to undo: it's kept in git without a Recent changes entry", async () => {
    const request = await owner();

    await keep(request, { step: "mark-lengths", ticked: [{ step: "check-delivery", lines: [0] }] });

    const [latest] = await changesIn(contextDir);
    expect(latest?.title).toBe("Progress on Build: Workbench");
    expect(latest?.trailers).toContain("Courtyard-Change: build-progress");
    const recent = await request("/api/workspaces/garage/changes");
    expect(JSON.stringify(await recent.json())).not.toContain("Progress on Build");
  });

  it("keeps the parts page as where the owner is, and the parts labelled there (#778)", async () => {
    const request = await owner();

    const kept = await keep(request, { step: "parts", ticked: [], labelled: ["A", "B", "C"] });

    expect(kept.status).toBe(200);
    const { progress } = await opened(request);
    expect(progress.step).toBe("parts");
    expect(progress.labelled).toEqual(["A", "B", "C"]);
  });

  it("refuses a step the Build doesn't have", async () => {
    const request = await owner();

    const refused = await keep(request, { step: "fit-wheels", ticked: [] });

    expect(refused.status).toBe(400);
    expect(await errorOf(refused)).toBe("Workbench has no step fit-wheels.");
  });

  it("stays on its steps when one before them goes, as the castors do when taken off (#699)", async () => {
    const request = await owner();
    const progress = { step: "fit-supports", ticked: [{ step: "fit-supports", lines: [0] }] };
    await keep(request, progress);

    await writeFile(
      join(contextDir, "garage", "builds", "workbench.json"),
      JSON.stringify({
        name: "Workbench",
        template: "framed-bench",
        parameters: { ...goldenBench, castors: null },
      }),
    );

    const build = await opened(request);
    expect(build.progress).toEqual({
      ...progress,
      ways: [],
      buying: [],
      parked: [],
      labelled: [],
    });
    expect(build.derived.steps.find((step) => step.id === "fit-supports")?.number).toBe(6);
  });

  it("opens as not started from a file kept by step number, before steps had IDs", async () => {
    await mkdir(join(contextDir, "garage", "builds", "progress"), { recursive: true });
    await writeFile(
      join(contextDir, "garage", "builds", "progress", "workbench.json"),
      JSON.stringify({ step: 5, ticked: [{ step: 5, lines: [0, 1] }] }),
    );
    const request = await owner();

    expect((await opened(request)).progress).toEqual({
      step: null,
      ticked: [],
      ways: [],
      buying: [],
      parked: [],
      labelled: [],
    });
    // And it's kept the new way from the next tick.
    const kept = await keep(request, {
      step: null,
      ticked: [{ step: "check-delivery", lines: [0] }],
    });
    expect(kept.status).toBe(200);
  });

  it("keeps the saw a step was started with once a line is ticked, whatever's sent (#777)", async () => {
    const request = await owner();
    const cutDone = { step: "cut-timber", lines: [0, 1, 2, 3] };

    const kept = await keep(request, {
      step: "fit-castors",
      ticked: [cutDone],
      ways: [],
      buying: [],
      labelled: [],
    });
    expect(BuildProgress.parse(await kept.json()).ways).toEqual([
      { step: "cut-timber", tool: "hand-saw" },
    ]);
    // A tick sent without them, as a page with an older read would, keeps them.
    await keep(request, {
      step: "fit-castors",
      ticked: [cutDone, { step: "fit-castors", lines: [0] }],
    });
    expect((await opened(request)).progress.ways).toEqual([
      { step: "cut-timber", tool: "hand-saw" },
      { step: "fit-castors", tool: "through-plate" },
    ]);
    // Part ticked, it's still started, so its ticks stay on the lines they were ticked on.
    await keep(request, { step: "cut-timber", ticked: [{ step: "cut-timber", lines: [0, 1] }] });
    expect((await opened(request)).progress.ways).toEqual([
      { step: "cut-timber", tool: "hand-saw" },
    ]);
    // Every line unticked, it follows the tools again.
    await keep(request, { step: "cut-timber", ticked: [] });
    expect((await opened(request)).progress.ways).toEqual([]);
  });

  it("keeps a step parked with why, for Can't do this now at the bench (#793)", async () => {
    const request = await owner();
    const parked = [{ step: "fit-castors", why: "Missing: 10 mm spanner × 2" }];

    const kept = await keep(request, { step: "stand-on-bases", ticked: [], parked });

    expect(BuildProgress.parse(await kept.json()).parked).toEqual(parked);
    expect((await opened(request)).progress.parked).toEqual(parked);
    // Taken off, as Do it now does, it's gone.
    await keep(request, { step: "fit-castors", ticked: [], parked: [] });
    expect((await opened(request)).progress.parked).toEqual([]);
  });

  it("refuses a Build that isn't there", async () => {
    const request = await owner();

    const refused = await sendJson(
      request,
      "/api/fabrication/workspaces/garage/builds/shelves/progress",
      "PUT",
      { step: null, ticked: [] },
    );

    expect(refused.status).toBe(404);
  });
});

/** The owner's tools as Your tools saves them, at the context folder's top (#707). */
const ownTools = async (...names: string[]) => {
  await mkdir(join(contextDir, "things"), { recursive: true });
  for (const name of names) {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-$/, "");
    await writeFile(
      join(contextDir, "things", `${slug}.md`),
      `---\nname: ${JSON.stringify(name)}\nstatus: have\nkind: tool\n---\n`,
    );
  }
};

describe("a Build's steps with Your tools (#777)", () => {
  const cut = (build: BuildOpened) => build.derived.steps.find((step) => step.id === "cut-timber");
  const sawOf = (build: BuildOpened) => cut(build)?.ways.find((way) => way.using)?.tool;
  const theirs = ["Tape, pencil", "Square", "Hand saw", "Workmate", "Clamps", "Drill / driver"];
  /** The tools the Build's findings say aren't to hand, by name. */
  const missingOf = (build: BuildOpened) =>
    build.derived.findings.flatMap((finding) =>
      finding.kind === "tools-missing" ? finding.tools.map((tool) => tool.name) : [],
    );

  it("follow the owner's tools rather than the Build's own, saying what changed", async () => {
    await ownTools(...theirs, "Mitre saw");
    const request = await owner();

    const build = await opened(request);
    expect(sawOf(build)).toBe("mitre-saw");
    expect(cut(build)?.wayChanged).toEqual({ was: "Hand saw", now: "Mitre saw" });
    expect(cut(build)?.scene?.title).toBe("On the mitre saw");
    // Their drill bits aren't among them, so the steps that drill say so.
    expect(missingOf(build)).toContain("Drill bits");
  });

  it("find the kit no tile has by the words in its name, so it's no longer missing", async () => {
    await ownTools(...theirs, "Electric drill and drill bits", "Safety specs", "Countersink");
    const request = await owner();

    const missing = missingOf(await opened(request));
    expect(missing).not.toContain("Drill bits");
    expect(missing).not.toContain("Safety glasses");
    expect(missing).not.toContain("Countersink bit");
    expect(missing).toContain("Spanner");
  });

  it("give a cut too wide for the owner's mitre saw back to the hand saw (#780)", async () => {
    await ownTools(...theirs);
    await writeFile(
      join(contextDir, "things", "mitre-saw.md"),
      '---\nname: "Mitre saw"\nstatus: have\nkind: tool\nsize: "120 × 60 mm"\n---\n',
    );
    const request = await owner();

    const said = cut(await opened(request))?.actions.map((action) => action.howTo);
    expect(said).toContainEqual(
      expect.stringContaining(
        "The 145 castor bases and top support are too wide for your mitre saw: hand saw for these.",
      ),
    );
  });

  it("are the Build's own until the owner has saved any", async () => {
    const request = await owner();

    expect(sawOf(await opened(request))).toBe("hand-saw");
    expect(cut(await opened(request))?.wayChanged).toBeNull();
  });

  it("keep a step done as it was done when a better tool comes", async () => {
    await ownTools(...theirs);
    const request = await owner();
    await keep(request, {
      step: "fit-castors",
      ticked: [{ step: "cut-timber", lines: [0, 1, 2, 3] }],
    });

    await ownTools("Mitre saw");

    const build = await opened(request);
    expect(sawOf(build)).toBe("hand-saw");
    expect(cut(build)?.wayChanged).toBeNull();
    expect(cut(build)?.scene?.title).toBe("In the Workmate");
  });

  it("keep a step only part done as it was started, its ticks on the lines they were ticked on", async () => {
    await ownTools(...theirs);
    const request = await owner();
    await keep(request, { step: "cut-timber", ticked: [{ step: "cut-timber", lines: [0] }] });

    await ownTools("Mitre saw");

    const build = await opened(request);
    expect(sawOf(build)).toBe("hand-saw");
    expect(cut(build)?.actions[0]?.numbers).toBe("In the jaws, line just past the edge.");
  });

  it("know a drill bit set's sizes from the size it's kept with (#763)", async () => {
    await ownTools(...theirs);
    await writeFile(
      join(contextDir, "things", "drill-bits.md"),
      `---\nname: "Drill bits"\nstatus: have\nkind: tool\nsize: "1–6 mm"\n---\n`,
    );
    const request = await owner();

    const bits = (await opened(request)).derived.steps
      .find((step) => step.id === "fit-castors")
      ?.tools.find((tool) => tool.tool === "drill-bits")?.bits;
    expect(bits).toEqual([{ mm: 7, for: "the M6 bolts", have: false }]);
  });

  it("keep a step done before the ways were kept as the Build's own tools did it", async () => {
    // As kept before #777: the cut step done, no ways.
    await mkdir(join(contextDir, "garage", "builds", "progress"), { recursive: true });
    await writeFile(
      join(contextDir, "garage", "builds", "progress", "workbench.json"),
      JSON.stringify({
        step: "fit-castors",
        ticked: [{ step: "cut-timber", lines: [0, 1, 2, 3] }],
      }),
    );
    await ownTools(...theirs, "Mitre saw");
    const request = await owner();

    const build = await opened(request);
    expect(sawOf(build)).toBe("hand-saw");
    expect(cut(build)?.wayChanged).toBeNull();
    // And the next tick keeps it so.
    await keep(request, {
      step: "fit-castors",
      ticked: [
        { step: "cut-timber", lines: [0, 1, 2, 3] },
        { step: "fit-castors", lines: [0] },
      ],
    });
    expect((await opened(request)).progress.ways).toEqual([
      { step: "cut-timber", tool: "hand-saw" },
      { step: "fit-castors", tool: "through-plate" },
    ]);
  });
});

describe("the castor step started on its old lines (#783)", () => {
  const castors = (build: BuildOpened) =>
    build.derived.steps.find((step) => step.id === "fit-castors");
  const keptAs = async (progress: unknown) => {
    await mkdir(join(contextDir, "garage", "builds", "progress"), { recursive: true });
    await writeFile(
      join(contextDir, "garage", "builds", "progress", "workbench.json"),
      JSON.stringify(progress),
    );
  };
  const OLD = [
    "Set a castor on the base 10 mm in from each end, centred across it, and mark its holes.",
    "Drill a 7 mm clearance hole straight through at each mark.",
    "Push each bolt up through a washer, the castor plate and the base, then add a washer and a lock nut, and tighten with the spanner.",
  ];

  it("keeps those lines, done, its ticks where they were, and stays so as more is ticked", async () => {
    const done = { step: "fit-castors", lines: [0, 1, 2] };
    await keptAs({ step: "fit-castors", ticked: [done], ways: [] });
    const request = await owner();

    const build = await opened(request);
    expect(castors(build)?.actions.map((action) => action.howTo)).toEqual(OLD);
    // Every line ticked: still done, not three of four.
    expect(build.progress.ticked).toEqual([done]);
    expect(castors(build)?.actions).toHaveLength(done.lines.length);
    await keep(request, {
      step: "stand-on-bases",
      ticked: [done, { step: "stand-on-bases", lines: [0] }],
    });
    const after = await opened(request);
    expect(castors(after)?.actions.map((action) => action.howTo)).toEqual(OLD);
    expect(after.progress.ways).toEqual([]);
  });

  it("keeps a step part done on its old lines too, as kept before the ways were", async () => {
    await keptAs({ step: "fit-castors", ticked: [{ step: "fit-castors", lines: [0] }] });
    const request = await owner();

    expect(castors(await opened(request))?.actions.map((action) => action.howTo)).toEqual(OLD);
  });

  it("gives the new lines once its ticks are taken off", async () => {
    await keptAs({ step: "fit-castors", ticked: [{ step: "fit-castors", lines: [0] }], ways: [] });
    const request = await owner();

    await keep(request, { step: "fit-castors", ticked: [] });

    expect(castors(await opened(request))?.actions).toHaveLength(4);
  });
});

/** A Thing the owner has in the garage, as a planning workspace keeps it. */
const garageThing = async (name: string) => {
  await mkdir(join(contextDir, "garage", "things"), { recursive: true });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await writeFile(
    join(contextDir, "garage", "things", `${slug}.md`),
    `---\nname: ${JSON.stringify(name)}\nstatus: have\n---\n`,
  );
};

describe("a Build with what the owner has besides Your tools (#763)", () => {
  it("finds a step stool in a space for the long end's support, saying it will do", async () => {
    await ownTools("Tape, pencil", "Square", "Hand saw", "Workmate", "Clamps");
    await garageThing("Step stool");
    const request = await owner();

    const support = (await opened(request)).derived.steps
      .find((step) => step.id === "cut-timber")
      ?.tools.find((tool) => tool.tool === "long-end-support");
    expect(support).toMatchObject({ toHand: true, standIn: "Step stool" });
  });

  it("says on the bolts' line when the owner's own are too short", async () => {
    await garageThing("Castor bolts M6 × 50");
    const request = await owner();

    const bolts = (await opened(request)).derived.buyList.lines.find(
      (line) => line.item === "M6 × 60 bolts",
    );
    expect(bolts?.length?.yoursShort).toEqual({ name: "M6 × 50", by: 7.6 });
  });

  it("keeps a tool chosen to buy, listing it on the buy list until they have it", async () => {
    const request = await owner();

    const kept = await keep(request, { step: null, ticked: [], buying: ["spanner"] });
    expect(BuildProgress.parse(await kept.json()).buying).toEqual(["spanner"]);
    const lines = (await opened(request)).derived.buyList.lines;
    expect(lines.find((line) => line.kind === "tool")).toMatchObject({ item: "Spanner" });

    // A socket turns the nut and pliers hold the head (#783).
    await ownTools("Socket set", "Pliers");
    const had = (await opened(request)).derived.buyList.lines;
    expect(had.filter((line) => line.kind === "tool")).toEqual([]);
  });
});
