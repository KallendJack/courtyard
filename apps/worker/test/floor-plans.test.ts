import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanningHome, type SessionEvent, SessionSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  changesIn,
  followSession,
  postJson,
  type Requester,
  removeTestFolder,
  SAVING_MODEL,
  type ScriptedStep,
  savingProvider,
  testWorker,
} from "./testing.ts";

// Floor plans Courtyard draws itself (#257): a `plan` block in an answer is saved straight away as
// its room's document, one per room, and shows on the workspace's Home.

const GARAGE = {
  room: "Garage",
  width: 300,
  depth: 540,
  front: "Garage door",
  openings: [{ kind: "garage-door", wall: "front", at: 30, width: 240 }],
  items: [
    {
      name: "Workbench",
      fromLeft: 0,
      fromBack: 300,
      width: 60,
      depth: 120,
      why: "Tool wall above",
    },
  ],
};

const block = (plan: unknown) =>
  `Here's the garage:\n\n\`\`\`plan\n${JSON.stringify(plan)}\n\`\`\`\n`;

let root: string;
let contextDir: string;
const planFile = () => readFile(join(contextDir, "garage", "docs", "garage-floor-plan.md"), "utf8");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(join(contextDir, "garage"), { recursive: true });
  await writeFile(
    join(contextDir, "garage", "CONTEXT.md"),
    "# Garage\n\n## Facts\n\n- 5.4 × 3 m.\n",
  );
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** A session in the garage whose turns follow the scripted steps, each sent and finished in turn. */
const sessionWith = async (turns: readonly (readonly ScriptedStep[])[]) => {
  const saver = savingProvider(turns);
  const request = await asOwner(testWorker({ root, providers: [saver.provider] }));
  const started = await postJson(request, "/api/workspaces/garage/sessions", {
    text: "Draw the garage?",
    model: SAVING_MODEL,
  });
  const session = SessionSummary.parse(await started.json());
  const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });
  for (let turn = 1; turn < turns.length; turn++) {
    await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "And again?",
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
  return { request, session, events };
};

const home = async (request: Requester) =>
  PlanningHome.parse(await (await request("/api/workspaces/garage/home")).json());

const saved = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "document-saved" ? [event.save] : []));

describe("a floor plan in an answer (#257)", () => {
  it("is saved straight away as its room's document, as one change with a note, and shows on Home", async () => {
    const { request, events } = await sessionWith([[{ write: block(GARAGE) }]]);

    expect(saved(events)).toEqual([
      { action: "save", document: { slug: "garage-floor-plan", name: "Garage floor plan" } },
    ]);
    const [, heading, json] = /^(# .+\n\n```plan\n)([\s\S]+)\n```\n$/.exec(await planFile()) ?? [];
    expect(heading).toBe("# Garage floor plan\n\n```plan\n");
    expect(JSON.parse(json ?? "")).toEqual(GARAGE);
    expect((await changesIn(contextDir))[0]?.title).toBe("Save floor plan: Garage");
    // A space's main subject is its floor plan (#603).
    expect((await home(request)).subject).toEqual({
      kind: "plan",
      name: "Garage plan",
      document: "garage-floor-plan",
      plan: GARAGE,
    });
  });

  it("replaces the room's plan when it's drawn again, and saves nothing when it hasn't changed", async () => {
    const moved = {
      ...GARAGE,
      items: [{ ...GARAGE.items[0], fromBack: 270 }],
    };
    const { request, events } = await sessionWith([
      [{ write: block(GARAGE) }],
      [{ write: block(moved) }],
      [{ write: block(moved) }],
    ]);

    expect(saved(events)).toEqual([
      { action: "save", document: { slug: "garage-floor-plan", name: "Garage floor plan" } },
      { action: "update", document: { slug: "garage-floor-plan", name: "Garage floor plan" } },
    ]);
    expect((await changesIn(contextDir))[0]?.title).toBe("Update floor plan: Garage");
    expect((await home(request)).subject).toMatchObject({ plan: moved });
  });

  it("keeps a thing whose size isn't known without one, and whether the outline was measured (#661)", async () => {
    // Placed by where it is, never given a stand-in size: the boiler on the left wall, the
    // projecting wall only as deep as was worked out from two measurements.
    const sizesKnown = {
      ...GARAGE,
      measured: true,
      items: [
        ...GARAGE.items,
        { name: "Boiler", wall: "left", at: 0 },
        { name: "Projecting wall", fromLeft: 287, fromBack: 480, width: 13 },
        { name: "Fuse box", fromLeft: 150, fromBack: 0 },
      ],
    };
    const { request, events } = await sessionWith([[{ write: block(sizesKnown) }]]);

    expect(saved(events)).toEqual([
      { action: "save", document: { slug: "garage-floor-plan", name: "Garage floor plan" } },
    ]);
    expect((await home(request)).subject).toMatchObject({ kind: "plan", plan: sizesKnown });
  });

  it("saves nothing for a block that isn't a plan Courtyard can draw", async () => {
    const { request, events } = await sessionWith([
      [{ write: block({ ...GARAGE, width: "three metres" }) }],
    ]);

    expect(saved(events)).toEqual([]);
    // With no plan, the garage is still there to draw, from its size saved (#604).
    expect((await home(request)).subject).toMatchObject({ kind: "space", size: "5.4 m × 3 m" });
  });
});
