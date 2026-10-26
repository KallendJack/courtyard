import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BuildOpened, StockSaved } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { goldenBench } from "../../../packages/fabrication/bench/fixtures/golden.ts";
import {
  asOwner,
  changesIn,
  errorOf,
  postJson,
  type Requester,
  removeTestFolder,
  testWorker,
} from "./testing.ts";

// Your stock (#760): what the owner has for making, Things of kind material or fixing at the
// owner's level beside their tools. Have it on a buy-list line saves it there, as one change with
// Undo, and every Build's buy list leaves it off.

let root: string;
let contextDir: string;

/** A Build of the golden bench in a planning workspace. */
const workbenchIn = async (workspace: string, name: string) => {
  await mkdir(join(contextDir, workspace, "builds"), { recursive: true });
  await writeFile(join(contextDir, workspace, "CONTEXT.md"), `# ${workspace}\n`);
  await writeFile(
    join(contextDir, workspace, "builds", "workbench.json"),
    JSON.stringify({ name, template: "framed-bench", parameters: goldenBench }),
  );
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await workbenchIn("garage", "Workbench");
  await workbenchIn("shed", "Potting bench");
});

afterEach(async () => {
  await removeTestFolder(root);
});

const buyList = async (request: Requester, workspace = "garage") =>
  BuildOpened.parse(
    await (await request(`/api/fabrication/workspaces/${workspace}/builds/workbench`)).json(),
  ).derived.buyList;

const items = (lines: readonly { item: string }[]) => lines.map(({ item }) => item);

const haveIt = (request: Requester, body: unknown) =>
  postJson(request, "/api/fabrication/stock", body);

const stockFile = (slug: string) => readFile(join(contextDir, "things", `${slug}.md`), "utf8");

describe("Have it", () => {
  it("saves the line to Your stock at the owner's level, and every Build leaves it off", async () => {
    const request = await asOwner(testWorker({ root }));
    expect(items((await buyList(request)).lines)).toContain("5 × 80 screws");

    const response = await haveIt(request, { name: "5 × 80 screws", kind: "fixing", count: 32 });

    expect(response.status).toBe(200);
    expect(StockSaved.parse(await response.json()).change).not.toBeNull();
    expect(await stockFile("5-80-screws")).toBe(
      "---\nname: 5 × 80 screws\nstatus: have\nkind: fixing\ncount: 32\n---\n",
    );
    expect((await changesIn(contextDir))[0]).toEqual({
      title: "Have it: 5 × 80 screws",
      trailers: [
        "Courtyard-Change: thing",
        "Courtyard-Place: owner-context",
        "Courtyard-File: things/5-80-screws.md",
      ],
    });
    const garage = await buyList(request);
    expect(items(garage.lines)).not.toContain("5 × 80 screws");
    expect(items(garage.had)).toEqual(["5 × 80 screws"]);
    expect(garage.lines).toHaveLength(10);
    // Another workspace's Build sees the same stock.
    expect(items((await buyList(request, "shed")).had)).toEqual(["5 × 80 screws"]);
  });

  it("is undone whole, the line back on the list", async () => {
    const request = await asOwner(testWorker({ root }));
    const saved = StockSaved.parse(
      await (
        await haveIt(request, { name: "18 mm plywood, 2440 × 1220", kind: "material", count: 1 })
      ).json(),
    );
    expect(items((await buyList(request)).had)).toEqual(["18 mm plywood, 2440 × 1220"]);

    const undone = await postJson(request, "/api/fabrication/stock/undo", { change: saved.change });

    expect(undone.status).toBe(204);
    expect(items((await buyList(request)).lines)).toContain("18 mm plywood, 2440 × 1220");
    expect((await buyList(request)).had).toEqual([]);
    expect(
      (await postJson(request, "/api/fabrication/stock/undo", { change: saved.change })).status,
    ).toBe(409);
  });

  it("tops up what the owner has of it, keeping where it's kept, so a part-covered line drops off", async () => {
    await mkdir(join(contextDir, "things"), { recursive: true });
    await writeFile(
      join(contextDir, "things", "4-40-screws.md"),
      "---\nname: 4x40 screws\nstatus: have\nkind: fixing\ncount: 20\nwhere: Diall case\n---\n",
    );
    const request = await asOwner(testWorker({ root }));
    expect(
      (await buyList(request)).lines.find((line) => line.item === "4 × 40 screws"),
    ).toMatchObject({ needed: 23, have: 20 });

    const response = await haveIt(request, { name: "4 × 40 screws", kind: "fixing", count: 43 });

    expect(response.status).toBe(200);
    expect(await stockFile("4-40-screws")).toBe(
      "---\nname: 4x40 screws\nstatus: have\nkind: fixing\ncount: 43\nwhere: Diall case\n---\n",
    );
    expect(items((await buyList(request)).had)).toEqual(["4 × 40 screws"]);
    // Having enough already changes nothing.
    const again = await haveIt(request, { name: "4 × 40 screws", kind: "fixing", count: 40 });
    expect(again.status).toBe(400);
    expect(await errorOf(again)).toBe("That changes nothing.");
  });

  it("never takes a tool, nor touches Your tools", async () => {
    await mkdir(join(contextDir, "things"), { recursive: true });
    await writeFile(
      join(contextDir, "things", "spanner.md"),
      "---\nname: Spanner\nstatus: have\nkind: tool\n---\n",
    );
    const request = await asOwner(testWorker({ root }));

    expect((await haveIt(request, { name: "Spanner", kind: "tool", count: 1 })).status).toBe(400);
    const clash = await haveIt(request, { name: "Spanner", kind: "fixing", count: 1 });
    expect(clash.status).toBe(409);
    expect(await errorOf(clash)).toBe("Spanner is one of your tools.");
  });
});
