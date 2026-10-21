import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MovesMade, PlanningHome, RecentChanges } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider, type OneOffInput, type Provider } from "../src/providers/index.ts";
import {
  asOwner,
  changesIn,
  errorOf,
  postJson,
  quotedInGuide,
  type Requester,
  removeTestFolder,
  testWorker,
} from "./testing.ts";

// The move review (#603, ADR 0032): once, a planning workspace's guides, Plans and Ideas lines
// and wanted Things are proposed moves, which Home shows ticked; only the ticked ones move, each
// one change with Undo, and the review is done.

let root: string;
const bike = () => join(root, "context", "mountain-biking");
const fileIn = (path: string) => readFile(join(bike(), path), "utf8").catch(() => null);

/** 21 October 2026, midday: the day moves date history lines. */
const TODAY = Date.UTC(2026, 9, 21, 12);

const CONTEXT = [
  "# Mountain biking",
  "",
  "## Facts",
  "",
  "- Rides a Boardman MHT 8.6",
  "",
  "## Plans",
  "",
  "- Get the chain checked at a shop",
  "- Set the brake levers before the next ride",
  "",
  "## Ideas",
  "",
  "- Ride a pump track one day",
  "",
].join("\n");

/** Each move the fake proposes, as a line of the workspace's files scripts it. */
const MOVES = [
  {
    title: "Journey guide → a project",
    about: "Ride red trails with confidence: skills as its steps, next up as Next",
    project: {
      name: "Ride red trails with confidence",
      goal: "Ride the reds at the bike park",
      steps: [
        { kind: "you can do this", text: "Cornering drill on Saturday", detail: "30 minutes" },
        { kind: "you can do this", text: "Get the chain checked at a shop", detail: null },
      ],
    },
    remove: { documents: ["journey-guide"], lines: ["Get the chain checked at a shop"] },
  },
  {
    title: "Day one guide → archive",
    about: "Done: you've had day one. Kept, out of the way",
    archive: ["day-one-guide"],
  },
  {
    title: "Wanted DMR V8 pedals → upcoming on Pedals",
    about: "The pedals go onto the bike as upcoming",
    upcoming: [
      { part: "pedals", name: "DMR V8", price: "about £30", shop: null, link: null, why: null },
    ],
    remove: { things: ["dmr-v8-pedals"] },
  },
  {
    title: "Setup and care → a one-screen checklist",
    about: "Before every ride, weekly, monthly, as a short table",
    documents: [
      {
        slug: "setup-and-care",
        text: "# Setup and care\n\n| When | Job |\n|---|---|\n| Every ride | Tyres 25/28 psi |",
      },
    ],
  },
  {
    title: "Ideas → later steps",
    about: "The pump track as a later step of Bike set up right",
    project: {
      slug: "bike-set-up-right",
      name: null,
      goal: null,
      steps: [{ kind: "you can do this", text: "Ride a pump track", detail: null }],
    },
    remove: { lines: ["Ride a pump track one day"] },
  },
];

const JOURNEY = "# Journey guide\n\nWhere I am, and what's next.\n";
const DAY_ONE = "# Day one guide\n\nShop today, ride tomorrow.\n";
const SETUP = "# Setup and care\n\nA long walkthrough of every job, in prose.\n";
const BIKE_SET_UP = [
  "---",
  "name: Bike set up right",
  "status: active",
  "---",
  "",
  "## Steps",
  "",
  "- [you can do this] Fit the DMR V8 pedals",
  "",
  "## History",
  "",
  "- 2026-10-20: Started",
  "",
].join("\n");
const PEDALS =
  "---\nname: Pedals\nstatus: have\nbrand: Wellgo alloy flats\npart of: boardman\n---\n";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(bike(), "docs"), { recursive: true });
  await mkdir(join(bike(), "things"), { recursive: true });
  await mkdir(join(bike(), "projects"), { recursive: true });
  await writeFile(join(bike(), "CONTEXT.md"), CONTEXT);
  await writeFile(join(bike(), "docs", "journey-guide.md"), JOURNEY);
  await writeFile(join(bike(), "docs", "day-one-guide.md"), DAY_ONE);
  await writeFile(join(bike(), "docs", "setup-and-care.md"), SETUP);
  // The fake proposes the moves a workspace's files script, one a line.
  await writeFile(
    join(bike(), "docs", "notes.md"),
    `# Notes\n\n${MOVES.map((move) => `move: ${JSON.stringify(move)}`).join("\n")}\n`,
  );
  await writeFile(join(bike(), "projects", "bike-set-up-right.md"), BIKE_SET_UP);
  await writeFile(
    join(bike(), "things", "boardman.md"),
    "---\nname: Boardman MHT 8.6\nstatus: have\n---\n",
  );
  await writeFile(join(bike(), "things", "pedals.md"), PEDALS);
  await writeFile(
    join(bike(), "things", "dmr-v8-pedals.md"),
    "---\nname: DMR V8 pedals\nstatus: want\nbrand: DMR V8\nprice: about £30\npart of: boardman\n---\n",
  );
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** The owner, on a worker whose background work (the review being written) the test waits for. */
const owner = async (providers: readonly Provider[] = [createFakeProvider({ delayMs: 0 })]) => {
  const pending: Promise<void>[] = [];
  const request = await asOwner(
    testWorker({
      root,
      providers,
      now: () => TODAY,
      background: (work) => {
        pending.push(work);
      },
    }),
  );
  return { request, written: () => Promise.all(pending) };
};

const homeOf = async (request: Requester) =>
  PlanningHome.parse(await (await request("/api/workspaces/mountain-biking/home")).json());

/** Home once the review has been written. */
const reviewed = async (asked: Awaited<ReturnType<typeof owner>>) => {
  expect((await homeOf(asked.request)).review).toBeNull();
  await asked.written();
  return homeOf(asked.request);
};

const tick = async (request: Requester, moves: number[]) => {
  const response = await postJson(request, "/api/workspaces/mountain-biking/review", { moves });
  expect(response.status).toBe(200);
  return MovesMade.parse(await response.json());
};

describe("the move review", () => {
  it("is written once there's something to move, and Home shows each move, ticked", async () => {
    const asked = await owner();

    const home = await reviewed(asked);

    expect(home.review?.moves).toEqual(MOVES.map(({ title, about }, id) => ({ id, title, about })));
    // Home is the review until it's done: the subject and projects come back after.
    expect(home.projects.map(({ name }) => name)).toEqual(["Bike set up right"]);
  });

  it("gives the model the guide's rule, and the workspace's files whole, Things and projects", async () => {
    const asked: OneOffInput[] = [];
    const fake = createFakeProvider({ delayMs: 0 });
    const spy: Provider = {
      ...fake,
      answerOnce: async (input) => {
        asked.push(input);
        return fake.answerOnce(input);
      },
    };
    await reviewed(await owner([spy]));

    const [input] = asked;
    expect(input?.purpose).toBe("move-review");
    expect(input?.instructions).toBe(
      await quotedInGuide("You sort one planning workspace in Courtyard"),
    );
    expect(input?.message).toContain(
      `The workspace is "Mountain biking".\n\nIts context file:\n\n<context_file>\n${CONTEXT.trim()}\n</context_file>`,
    );
    expect(input?.message).toContain(
      `<document>\ndocs/day-one-guide.md\n\n${DAY_ONE.trim()}\n</document>`,
    );
    expect(input?.message).toContain(
      "<things>\n[T1] Boardman MHT 8.6, have (things/boardman.md)\n[T2] DMR V8 pedals, want, DMR V8, price about £30, part of [T1] (things/dmr-v8-pedals.md)\n[T3] Pedals, have, Wellgo alloy flats, part of [T1] (things/pedals.md)\n</things>",
    );
    expect(input?.message).toContain(
      "<projects>\n[P1] Bike set up right, active, next: Fit the DMR V8 pedals (you can do this), 1 step, 0 decisions (projects/bike-set-up-right.md)\n</projects>",
    );
  });

  it("makes only the ticked moves, each one change with Undo, then it's done", async () => {
    const asked = await owner();
    await reviewed(asked);

    const made = await tick(asked.request, [0, 1, 2, 4]);

    expect(made).toEqual({
      moved: [0, 1, 2, 4].map((id) => ({ title: MOVES[id]?.title })),
      left: [],
    });
    // The journey guide is a project, with the Plans line it took as a step.
    expect(await fileIn("projects/ride-red-trails-with-confidence.md")).toBe(
      [
        "---",
        "name: Ride red trails with confidence",
        "goal: Ride the reds at the bike park",
        "status: active",
        "---",
        "",
        "## Steps",
        "",
        "- [you can do this] Cornering drill on Saturday · 30 minutes",
        "- [you can do this] Get the chain checked at a shop",
        "",
        "## History",
        "",
        "- 2026-10-21: Started from Journey guide → a project",
        "",
      ].join("\n"),
    );
    expect(await fileIn("docs/journey-guide.md")).toBeNull();
    // The day one guide is in the archive, out of the documents.
    expect(await fileIn("docs/day-one-guide.md")).toBeNull();
    expect(await fileIn("docs/archive/day-one-guide.md")).toBe(DAY_ONE);
    // The wanted pedals are upcoming on the bike's pedals.
    expect(await fileIn("things/pedals.md")).toBe(
      "---\nname: Pedals\nstatus: replace\nbrand: Wellgo alloy flats\npart of: boardman\nupcoming: DMR V8\nupcoming price: about £30\n---\n\n- 2026-10-21: Picked DMR V8 as upcoming\n",
    );
    expect(await fileIn("things/dmr-v8-pedals.md")).toBeNull();
    // The idea is a later step, and both lines have left the context file.
    expect(await fileIn("projects/bike-set-up-right.md")).toContain(
      "- [you can do this] Fit the DMR V8 pedals\n- [you can do this] Ride a pump track\n",
    );
    expect(await fileIn("CONTEXT.md")).toBe(
      CONTEXT.replace("- Get the chain checked at a shop\n", "").replace(
        "## Ideas\n\n- Ride a pump track one day\n",
        "## Ideas\n\n",
      ),
    );
    // Setup and care wasn't ticked, so it's as it was.
    expect(await fileIn("docs/setup-and-care.md")).toBe(SETUP);
    const titles = (await changesIn(join(root, "context"))).slice(0, 4).map(({ title }) => title);
    expect(titles).toEqual([
      "Move: Ideas → later steps",
      "Move: Wanted DMR V8 pedals → upcoming on Pedals",
      "Move: Day one guide → archive",
      "Move: Journey guide → a project",
    ]);
    expect((await homeOf(asked.request)).review).toBeNull();
    // Once done, it's never proposed again.
    await asked.written();
    expect((await homeOf(asked.request)).review).toBeNull();
  });

  it("is listed in Recent changes by its words, and Undo puts its files back", async () => {
    const asked = await owner();
    await reviewed(asked);
    await tick(asked.request, [1]);

    const listed = RecentChanges.parse(
      await (await asked.request("/api/workspaces/mountain-biking/changes")).json(),
    ).changes;

    expect(listed[0]).toMatchObject({
      kind: "move",
      move: { title: "Day one guide → archive" },
      undo: "available",
    });
    const undone = await postJson(asked.request, `/api/changes/${listed[0]?.id}/undo`, {});
    expect(undone.status).toBe(204);
    expect(await fileIn("docs/day-one-guide.md")).toBe(DAY_ONE);
    expect(await fileIn("docs/archive/day-one-guide.md")).toBeNull();
  });

  it("leaves a move whose files have gone, with why, for the review to show again", async () => {
    const asked = await owner();
    await reviewed(asked);
    await rm(join(bike(), "docs", "setup-and-care.md"));

    const made = await tick(asked.request, [1, 3]);

    expect(made).toEqual({
      moved: [{ title: "Day one guide → archive" }],
      left: [
        {
          title: "Setup and care → a one-screen checklist",
          problem: "The document setup-and-care isn't there any more.",
        },
      ],
    });
    expect((await homeOf(asked.request)).review?.moves.map(({ title }) => title)).toEqual([
      "Setup and care → a one-screen checklist",
    ]);
  });

  it("leaves everything as it is when nothing's ticked, and the review is done", async () => {
    const asked = await owner();
    await reviewed(asked);

    expect(await tick(asked.request, [])).toEqual({ moved: [], left: [] });

    expect(await fileIn("CONTEXT.md")).toBe(CONTEXT);
    expect(await fileIn("docs/journey-guide.md")).toBe(JOURNEY);
    expect((await homeOf(asked.request)).review).toBeNull();
    const again = await postJson(asked.request, "/api/workspaces/mountain-biking/review", {
      moves: [0],
    });
    expect([again.status, await errorOf(again)]).toEqual([
      409,
      "There's nothing waiting to move here any more.",
    ]);
  });

  it("proposes nothing in a workspace with nothing to move, and asks no model", async () => {
    const asked: OneOffInput[] = [];
    const fake = createFakeProvider({ delayMs: 0 });
    const spy: Provider = {
      ...fake,
      answerOnce: async (input) => {
        asked.push(input);
        return fake.answerOnce(input);
      },
    };
    await mkdir(join(root, "context", "garage"), { recursive: true });
    await writeFile(
      join(root, "context", "garage", "CONTEXT.md"),
      "# Garage\n\n## Facts\n\n- A single garage.\n",
    );
    const { request, written } = await owner([spy]);

    await request("/api/workspaces/garage/home");
    await written();

    expect(asked).toEqual([]);
  });
});
