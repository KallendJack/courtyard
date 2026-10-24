import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionSummary,
  ThingList,
  ToolsHeard,
  ToolsSaved,
  WorkspaceList,
  YourTools,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "../src/providers/fake.ts";
import {
  asOwner,
  changesIn,
  errorOf,
  followSession,
  postJson,
  type Requester,
  removeTestFolder,
  SAVING_MODEL,
  savingProvider,
  sendJson,
  testWorker,
} from "./testing.ts";

// The owner's tools (ADR 0037, #707): Things of kind tool at the owner's level, in the context
// folder's own `things` folder, so every workspace and every Build sees them. Fabrication's API
// lists and saves them, as one change with Undo, moves a workspace's tools there with the owner's
// Save, and hears a list said, saving nothing.

let root: string;
let contextDir: string;
const toolFile = (slug: string) => readFile(join(contextDir, "things", `${slug}.md`), "utf8");
const garageThing = (slug: string) =>
  readFile(join(contextDir, "garage", "things", `${slug}.md`), "utf8");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(join(contextDir, "garage"), { recursive: true });
  await writeFile(
    join(contextDir, "garage", "CONTEXT.md"),
    "# Garage\n\n## Facts\n\n- A garage.\n",
  );
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** The owner's tools as they'd have saved them: a hand saw, and two clamps. */
const withTools = async () => {
  await mkdir(join(contextDir, "things"), { recursive: true });
  await writeFile(
    join(contextDir, "things", "hand-saw.md"),
    "---\nname: Hand saw\nstatus: have\nkind: tool\n---\n",
  );
  await writeFile(
    join(contextDir, "things", "clamps.md"),
    "---\nname: Clamps\nstatus: have\nkind: tool\ncount: 2\n---\n",
  );
};

const yourTools = async (request: Requester) =>
  YourTools.parse(await (await request("/api/fabrication/tools")).json());

const saveTools = (request: Requester, tools: unknown) =>
  sendJson(request, "/api/fabrication/tools", "PUT", { tools });

describe("the owner's tools", () => {
  it("are listed with their counts, and the folder they're in is never a workspace", async () => {
    await withTools();
    const request = await asOwner(testWorker({ root }));

    const listed = await yourTools(request);
    expect(listed.saved).toBe(true);
    expect(listed.tools.map(({ name, kind, count }) => [name, kind, count])).toEqual([
      ["Clamps", "tool", 2],
      ["Hand saw", "tool", undefined],
    ]);

    const listedWorkspaces = WorkspaceList.parse(await (await request("/api/workspaces")).json());
    expect(listedWorkspaces.workspaces.map(({ id }) => id)).toEqual(["garage"]);
    const named = await postJson(request, "/api/workspaces", { name: "Things" });
    expect(named.status).toBe(400);
    expect(await errorOf(named)).toBe(
      `"things" is where the owner's tools are kept. Choose another name.`,
    );
  });

  it("are told to a model in a new workspace, so it never asks", async () => {
    await withTools();
    const saver = savingProvider([[]]);
    const request = await asOwner(testWorker({ root, providers: [saver.provider] }));
    await postJson(request, "/api/workspaces", { name: "Shed" });

    const started = await postJson(request, "/api/workspaces/shed/sessions", {
      text: "What tools have I got?",
      model: SAVING_MODEL,
    });
    const { id } = SessionSummary.parse(await started.json());
    await followSession(request, { sessionId: id, until: "turn-completed" });

    expect(saver.framings[0]?.instructions).toContain("<tools>\nClamps × 2\nHand saw\n</tools>");
  });

  it("saves what's ticked as one change, a printer with its plate getting a subject ID, and Undo puts them back", async () => {
    await withTools();
    const request = await asOwner(testWorker({ root }));

    const response = await saveTools(request, [
      { name: "Hand saw" },
      { name: "Clamps", count: 4 },
      { name: "Workmate" },
      { name: "3D printer", brand: "Prusa MK4", size: "250 × 210 mm plate, 0.2 mm clearance" },
    ]);

    expect(response.status).toBe(200);
    const saved = ToolsSaved.parse(await response.json());
    expect(saved.tools.tools.map(({ name, count }) => [name, count])).toEqual([
      ["3D printer", undefined],
      ["Clamps", 4],
      ["Hand saw", undefined],
      ["Workmate", undefined],
    ]);
    expect(await toolFile("workmate")).toBe("---\nname: Workmate\nstatus: have\nkind: tool\n---\n");
    expect(await toolFile("clamps")).toContain("count: 4\n");
    const printer = await toolFile("3d-printer");
    expect(printer).toMatch(
      /^---\nname: 3D printer\nstatus: have\nkind: tool\nbrand: Prusa MK4\nsize: 250 × 210 mm plate, 0\.2 mm clearance\nsubject: [0-9a-f-]{36}\n---\n$/,
    );
    expect((await changesIn(contextDir))[0]).toEqual({
      title: "Save your tools",
      trailers: [
        "Courtyard-Change: thing",
        "Courtyard-Place: owner-context",
        "Courtyard-File: things/3d-printer.md",
        "Courtyard-File: things/clamps.md",
        "Courtyard-File: things/workmate.md",
      ],
    });

    // Unticking one removes it, as the same kind of change.
    const fewer = ToolsSaved.parse(
      await (await saveTools(request, [{ name: "Clamps", count: 4 }])).json(),
    );
    expect(fewer.tools.tools.map(({ name }) => name)).toEqual(["Clamps"]);

    const undone = await postJson(request, "/api/fabrication/tools/undo", {
      change: fewer.change,
    });
    expect(undone.status).toBe(204);
    expect((await yourTools(request)).tools.map(({ name }) => name)).toEqual([
      "3D printer",
      "Clamps",
      "Hand saw",
      "Workmate",
    ]);
    expect(await toolFile("3d-printer")).toBe(printer);

    expect(
      (await postJson(request, "/api/fabrication/tools/undo", { change: fewer.change })).status,
    ).toBe(409);
  });

  it("refuses the same tool twice, and a save that changes nothing", async () => {
    await withTools();
    const request = await asOwner(testWorker({ root }));

    const twice = await saveTools(request, [{ name: "Hand saw" }, { name: "hand saw" }]);
    expect(twice.status).toBe(400);
    expect(await errorOf(twice)).toBe("Hand saw is there twice: give each tool once.");

    const same = await saveTools(request, [{ name: "Hand saw" }, { name: "Clamps", count: 2 }]);
    expect(same.status).toBe(400);
    expect(await errorOf(same)).toBe("That changes nothing.");
  });
});

describe("a workspace's tools, moved", () => {
  /** The garage's tools, saved as Things before the owner's tools were kept: and a bike that isn't one. */
  const withGarageTools = async () => {
    await mkdir(join(contextDir, "garage", "things"), { recursive: true });
    await writeFile(
      join(contextDir, "garage", "things", "f-clamps.md"),
      "---\nname: F-clamps\nstatus: have\nbrand: Bessey, 300 mm\n---\n\n- 2026-09-01: Bought two\n",
    );
    await writeFile(
      join(contextDir, "garage", "things", "tape-measure.md"),
      "---\nname: Tape measure\nstatus: have\nbrand: Stanley 5 m\n---\n",
    );
    await writeFile(
      join(contextDir, "garage", "things", "router.md"),
      "---\nname: Router\nstatus: have\nkind: tool\n---\n",
    );
    await writeFile(
      join(contextDir, "garage", "things", "jigsaw.md"),
      "---\nname: Jigsaw\nstatus: want\n---\n",
    );
    await writeFile(
      join(contextDir, "garage", "things", "bike.md"),
      "---\nname: Bike\nstatus: have\n---\n",
    );
  };

  it("are found, as the tile each would be, those the owner has and not those wanted", async () => {
    await withGarageTools();
    const request = await asOwner(testWorker({ root }));

    const listed = await yourTools(request);
    expect(listed.saved).toBe(false);
    expect(listed.found).toEqual([
      {
        tool: { name: "Clamps", from: { workspace: "garage", thing: "f-clamps" } },
        workspaceName: "Garage",
        thingName: "F-clamps",
      },
      {
        tool: { name: "Router", from: { workspace: "garage", thing: "router" } },
        workspaceName: "Garage",
        thingName: "Router",
      },
      {
        tool: { name: "Tape, pencil", from: { workspace: "garage", thing: "tape-measure" } },
        workspaceName: "Garage",
        thingName: "Tape measure",
      },
    ]);
  });

  it("move with Save, keeping what the Thing held, as one change Undo takes back whole", async () => {
    await withGarageTools();
    const request = await asOwner(testWorker({ root }));

    const response = await saveTools(request, [
      { name: "Clamps", count: 2, from: { workspace: "garage", thing: "f-clamps" } },
      { name: "Hand saw" },
    ]);

    expect(response.status).toBe(200);
    const saved = ToolsSaved.parse(await response.json());
    expect(saved.tools.found.map(({ thingName }) => thingName)).toEqual(["Router", "Tape measure"]);
    // The owner's name stays, the tile it's ticked as beside it.
    expect(saved.tools.tools.map(({ name, tile }) => [name, tile])).toEqual([
      ["F-clamps", "Clamps"],
      ["Hand saw", undefined],
    ]);
    expect(await toolFile("f-clamps")).toBe(
      "---\nname: F-clamps\nstatus: have\nkind: tool\ncount: 2\nbrand: Bessey, 300 mm\ntile: Clamps\n---\n\n- 2026-09-01: Bought two\n",
    );
    await expect(garageThing("f-clamps")).rejects.toThrow();
    const garage = ThingList.parse(await (await request("/api/workspaces/garage/things")).json());
    expect(garage.things.map(({ name }) => name)).not.toContain("F-clamps");
    expect((await changesIn(contextDir))[0]?.trailers).toEqual([
      "Courtyard-Change: thing",
      "Courtyard-Place: owner-context",
      "Courtyard-Place: workspace/garage",
      "Courtyard-File: things/f-clamps.md",
      "Courtyard-File: things/hand-saw.md",
      "Courtyard-File: garage/things/f-clamps.md",
    ]);

    // Ticked again by its tile, it's still the owner's F-clamps.
    const recounted = ToolsSaved.parse(
      await (await saveTools(request, [{ name: "Clamps", count: 3 }, { name: "Hand saw" }])).json(),
    );
    expect(recounted.tools.tools.map(({ name, count }) => [name, count])).toEqual([
      ["F-clamps", 3],
      ["Hand saw", undefined],
    ]);
    expect(await toolFile("f-clamps")).toContain("name: F-clamps\n");
    await expect(toolFile("clamps")).rejects.toThrow();
    await postJson(request, "/api/fabrication/tools/undo", { change: recounted.change });

    const undone = await postJson(request, "/api/fabrication/tools/undo", {
      change: saved.change,
    });
    expect(undone.status).toBe(204);
    expect(await garageThing("f-clamps")).toContain("name: F-clamps\n");
    expect((await yourTools(request)).tools).toEqual([]);
  });

  it("refuses a move from a Thing that isn't there", async () => {
    await withGarageTools();
    const request = await asOwner(testWorker({ root }));

    const response = await saveTools(request, [
      { name: "Hammer", from: { workspace: "garage", thing: "hammer" } },
    ]);

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe(
      "Garage has no Thing hammer to move any more: tick your tools again.",
    );
  });
});

describe("Or just say it", () => {
  it("ticks the tools a model heard, counts and all, and saves nothing", async () => {
    // The fake's scripted answer, so no real model is needed (CI has none).
    const request = await asOwner(
      testWorker({ root, providers: [createFakeProvider({ delayMs: 0 })] }),
    );

    const response = await postJson(request, "/api/fabrication/tools/heard", {
      said: "A hand saw, the Workmate and two clamps",
    });

    expect(response.status).toBe(200);
    expect(ToolsHeard.parse(await response.json()).tools).toEqual([
      { name: "Hand saw" },
      { name: "Workmate" },
      { name: "Clamps", count: 2 },
    ]);
    expect((await yourTools(request)).tools).toEqual([]);
    expect((await changesIn(contextDir).catch(() => [])).map(({ title }) => title)).not.toContain(
      "Save your tools",
    );
  });
});
