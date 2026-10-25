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

    expect((await opened(request)).progress).toEqual({ step: null, ticked: [] });
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
    expect(BuildProgress.parse(await kept.json())).toEqual(progress);
    // Read from the Build again, as another device opening it would.
    expect((await opened(request)).progress).toEqual(progress);
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
    expect(build.progress).toEqual(progress);
    expect(build.derived.steps.find((step) => step.id === "end-frames")?.number).toBe(4);
  });

  it("opens as not started from a file kept by step number, before steps had IDs", async () => {
    await mkdir(join(contextDir, "garage", "builds", "progress"), { recursive: true });
    await writeFile(
      join(contextDir, "garage", "builds", "progress", "workbench.json"),
      JSON.stringify({ step: 5, ticked: [{ step: 5, lines: [0, 1] }] }),
    );
    const request = await owner();

    expect((await opened(request)).progress).toEqual({ step: null, ticked: [] });
    // And it's kept the new way from the next tick.
    const kept = await keep(request, {
      step: null,
      ticked: [{ step: "check-delivery", lines: [0] }],
    });
    expect(kept.status).toBe(200);
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
