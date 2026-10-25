import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holdersOf } from "@courtyard/builds";
import { BuildView, MadePart } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { goldenBench } from "../../../packages/fabrication/bench/fixtures/golden.ts";
import { goldenHolster } from "../../../packages/fabrication/print/fixtures/golden.ts";
import {
  asOwner,
  errorOf,
  type Requester,
  removeTestFolder,
  testBuildsLock,
  testWorker,
} from "./testing.ts";

// A printed part (#702, ADR 0036): its Build's recipe made into a solid by the worker, in a thread
// of its own with a time limit and in the machine's builds lock, and given back as its size, its
// triangles for the 3D view, and its files to print.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  const garage = join(root, "context", "garage");
  await mkdir(join(garage, "builds"), { recursive: true });
  await writeFile(join(garage, "CONTEXT.md"), "# Garage\n\n## Facts\n\n- A single garage.\n");
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** A Build's file in the garage, as the Build tool writes one. */
const buildFile = (slug: string, file: { name: string; template: string; parameters: unknown }) =>
  writeFile(join(root, "context", "garage", "builds", `${slug}.json`), JSON.stringify(file));

const BUILDS = "/api/fabrication/workspaces/garage/builds";

const start = (env: Record<string, string> = {}) => asOwner(testWorker({ root, env }));

const madeOf = async (request: Requester, slug: string) => {
  const response = await request(`${BUILDS}/${slug}/print`);
  expect(response.status).toBe(200);
  return MadePart.parse(await response.json());
};

describe("a printed part's Build", () => {
  it("comes back made: its size as the Build says, closed all round, and its files", async () => {
    await buildFile("battery-holster", {
      name: "Battery holster",
      template: "battery-holster",
      parameters: goldenHolster,
    });
    const request = await start();
    const view = BuildView.parse(await (await request(`${BUILDS}/battery-holster`)).json());
    expect(view.derived.size).toEqual({ length: 84.4, depth: 119.2, height: 70.2 });
    expect(view.derived.print?.fits).toBe(true);

    const made = await madeOf(request, "battery-holster");
    expect(made.size).toEqual(view.derived.size);
    expect(made.watertight).toBe(true);
    expect(made.grams).toBeGreaterThan(0);
    expect(made.mesh.triangles.length % 3).toBe(0);
    expect(made.files).toEqual({ threeMf: "battery-holster.3mf", stl: "battery-holster.stl" });

    const threeMf = await request(`${BUILDS}/battery-holster/print/battery-holster.3mf`);
    expect(threeMf.status).toBe(200);
    expect(threeMf.headers.get("content-type")).toBe("model/3mf");
    expect(threeMf.headers.get("content-disposition")).toBe(
      'attachment; filename="battery-holster.3mf"',
    );
    expect(
      Buffer.from(await threeMf.arrayBuffer())
        .subarray(0, 2)
        .toString(),
    ).toBe("PK");

    const stl = await request(`${BUILDS}/battery-holster/print/battery-holster.stl`);
    expect(stl.headers.get("content-type")).toBe("model/stl");
    expect((await stl.arrayBuffer()).byteLength).toBe(84 + 50 * (made.mesh.triangles.length / 3));

    expect((await request(`${BUILDS}/battery-holster/print/other.stl`)).status).toBe(404);
  });

  it("raises its lettering in the bundled font, standing out from its face", async () => {
    await buildFile("tag", {
      name: "Tag",
      template: "printed-part",
      parameters: {
        part: "Shelf tag",
        recipe: {
          base: { kind: "plate", width: 60, depth: 20, thickness: 3 },
          features: [
            { kind: "text", face: "top", text: "Batteries", size: 6, depth: 1, style: "raised" },
          ],
        },
      },
    });
    const made = await madeOf(await start(), "tag");
    expect(made.size).toEqual({ length: 60, depth: 20, height: 4 });
    expect(made.volume).toBeGreaterThan(60 * 20 * 3);
    expect(made.watertight).toBe(true);
  });

  it("is stopped when making it runs past its time limit, freeing its place in the builds lock", async () => {
    await buildFile("battery-holster", {
      name: "Battery holster",
      template: "battery-holster",
      parameters: goldenHolster,
    });
    const request = await start({ COURTYARD_PRINT_TIME_LIMIT_MS: "1" });
    const response = await request(`${BUILDS}/battery-holster/print`);
    expect(response.status).toBe(503);
    expect(await errorOf(response)).toBe(
      "Making that part took too long, so it was stopped: make it simpler.",
    );
    expect(holdersOf(testBuildsLock(root))).toEqual([]);
  });

  it("isn't made when its recipe can't be, saying why", async () => {
    await buildFile("odd", {
      name: "Odd part",
      template: "printed-part",
      parameters: {
        part: "Odd part",
        recipe: {
          base: { kind: "plate", width: 20, depth: 20, thickness: 3 },
          features: [{ kind: "knurl" }],
        },
      },
    });
    const response = await (await start())(`${BUILDS}/odd/print`);
    expect(response.status).toBe(422);
    expect(await errorOf(response)).toMatch(/Feature 1 is a knurl, which no recipe knows/);
  });

  it("is only a printed part's: a bench has no file to print", async () => {
    await buildFile("workbench", {
      name: "Workbench",
      template: "framed-bench",
      parameters: goldenBench,
    });
    const response = await (await start())(`${BUILDS}/workbench/print`);
    expect(response.status).toBe(404);
  });
});
