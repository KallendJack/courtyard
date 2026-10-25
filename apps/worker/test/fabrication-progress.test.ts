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

    expect((await opened(request)).progress).toEqual({ step: null, ticked: [], ways: [] });
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
    expect(BuildProgress.parse(await kept.json())).toEqual({ ...progress, ways: [] });
    // Read from the Build again, as another device opening it would.
    expect((await opened(request)).progress).toEqual({ ...progress, ways: [] });
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

  it("refuses a step the Build doesn't have", async () => {
    const request = await owner();

    const refused = await keep(request, { step: "fit-wheels", ticked: [] });

    expect(refused.status).toBe(400);
    expect(await errorOf(refused)).toBe("Workbench has no step fit-wheels.");
  });

  it("stays on its steps when one before them goes, as the castors do when taken off (#699)", async () => {
    const request = await owner();
    const progress = { step: "end-frames", ticked: [{ step: "end-frames", lines: [0] }] };
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
    expect(build.progress).toEqual({ ...progress, ways: [] });
    expect(build.derived.steps.find((step) => step.id === "end-frames")?.number).toBe(4);
  });

  it("opens as not started from a file kept by step number, before steps had IDs", async () => {
    await mkdir(join(contextDir, "garage", "builds", "progress"), { recursive: true });
    await writeFile(
      join(contextDir, "garage", "builds", "progress", "workbench.json"),
      JSON.stringify({ step: 5, ticked: [{ step: 5, lines: [0, 1] }] }),
    );
    const request = await owner();

    expect((await opened(request)).progress).toEqual({ step: null, ticked: [], ways: [] });
    // And it's kept the new way from the next tick.
    const kept = await keep(request, {
      step: null,
      ticked: [{ step: "check-delivery", lines: [0] }],
    });
    expect(kept.status).toBe(200);
  });

  it("keeps the saw a step was done with once every line is ticked, whatever's sent (#777)", async () => {
    const request = await owner();
    const cutDone = { step: "cut-timber", lines: [0, 1, 2, 3] };

    const kept = await keep(request, { step: "fit-castors", ticked: [cutDone], ways: [] });
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
    ]);
    // Unticked, it isn't done, so it follows the tools again.
    await keep(request, { step: "cut-timber", ticked: [{ step: "cut-timber", lines: [0, 1] }] });
    expect((await opened(request)).progress.ways).toEqual([]);
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

  it("follow the owner's tools rather than the Build's own, saying what changed", async () => {
    await ownTools(...theirs, "Mitre saw");
    const request = await owner();

    const build = await opened(request);
    expect(sawOf(build)).toBe("mitre-saw");
    expect(cut(build)?.wayChanged).toEqual({ was: "Hand saw", now: "Mitre saw" });
    expect(cut(build)?.scene?.title).toBe("On the mitre saw");
    // Their drill bits aren't among them, so the steps that drill say so.
    const missing = build.derived.findings.find((finding) => finding.kind === "tools-missing");
    expect(JSON.stringify(missing)).toContain("Drill bits");
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
});
