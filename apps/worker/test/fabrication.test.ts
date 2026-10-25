import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BuildChanged,
  Builds,
  BuildView,
  PlanningHome,
  RecentChanges,
  type SessionEvent,
  SessionSummary,
} from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { goldenBench } from "../../../packages/fabrication/bench/fixtures/golden.ts";
import {
  asOwner,
  changesIn,
  errorOf,
  followSession,
  postJson,
  type Requester,
  removeTestFolder,
  SAVING_MODEL,
  type ScriptedStep,
  savingProvider,
  sendJson,
  testWorker,
} from "./testing.ts";

// A planning workspace's Builds (ADR 0036, 0037, #697): a JSON file each in its `builds` folder,
// holding only the template and parameters chosen. A model starts and changes one with the Build
// tool, told the numbers code derives; the Fabrication API lists them, reads one with everything
// derived, and changes its parameters. Every change is one commit with Undo.

let root: string;
let contextDir: string;
const buildFile = async (slug: string): Promise<unknown> =>
  JSON.parse(await readFile(join(contextDir, "garage", "builds", `${slug}.json`), "utf8"));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(join(contextDir, "garage"), { recursive: true });
  await writeFile(
    join(contextDir, "garage", "CONTEXT.md"),
    "# Garage\n\n## Facts\n\n- A single garage, 2.6 m by 5 m.\n",
  );
});

afterEach(async () => {
  await removeTestFolder(root);
});

const buildTool = (input: unknown): ScriptedStep => ({ call: "save_build", input });

/** A session in the garage whose turns follow the scripted steps. */
const sessionWith = async (turns: readonly (readonly ScriptedStep[])[]) => {
  const saver = savingProvider(turns);
  const request = await asOwner(testWorker({ root, providers: [saver.provider] }));
  const started = await postJson(request, "/api/workspaces/garage/sessions", {
    text: "A bench for the garage.",
    model: SAVING_MODEL,
  });
  const session = SessionSummary.parse(await started.json());
  const events = await followSession(request, { sessionId: session.id, until: "turn-completed" });
  for (const _ of turns.slice(1)) {
    await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "And then?",
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
  return { request, session, events, saver };
};

const buildSaves = (events: readonly SessionEvent[]) =>
  events.flatMap((event) => (event.type === "build-saved" ? [event] : []));

const viewOf = async (request: Requester, slug: string) =>
  BuildView.parse(
    await (await request(`/api/fabrication/workspaces/garage/builds/${slug}`)).json(),
  );

const START_BENCH = buildTool({
  name: "Workbench",
  template: "framed-bench",
  parameters: goldenBench,
});

describe("the Build tool", () => {
  it("starts a Build from its parameters, one change with a note, and tells the model what code derived", async () => {
    const { saver, events, session, request } = await sessionWith([[START_BENCH]]);

    expect(await buildFile("workbench")).toEqual({
      name: "Workbench",
      template: "framed-bench",
      parameters: goldenBench,
    });
    expect(buildSaves(events)).toMatchObject([
      {
        save: { action: "add", build: { slug: "workbench", name: "Workbench" }, changes: [] },
        change: expect.any(String),
      },
    ]);
    expect((await changesIn(contextDir))[0]).toEqual({
      title: "Start Build: Workbench",
      trailers: [
        "Courtyard-Change: build",
        "Courtyard-Place: workspace/garage",
        `Courtyard-Session: ${session.id}`,
        "Courtyard-File: garage/builds/workbench.json",
      ],
    });

    const listed = Builds.parse(
      await (await request("/api/fabrication/workspaces/garage/builds")).json(),
    );
    expect(listed).toMatchObject({
      builds: [
        {
          slug: "workbench",
          name: "Workbench",
          template: "framed-bench",
          path: "builds/workbench.json",
        },
      ],
      problems: [],
    });

    // Its numbers are the engine's, the golden bench's hand-checked ones: 899.6 mm high on its
    // castors, told to the owner to the whole mm, and £177.02 in all, the longer bolts unpriced.
    const view = await viewOf(request, "workbench");
    expect(view.derived).toMatchObject({
      size: { length: 1500, depth: 600, height: 899.6 },
      buyList: { total: 17702, unpriced: 1 },
    });
    const [reply] = saver.replies[0] ?? [];
    expect(reply?.ok).toBe(true);
    expect(reply?.reply).toMatch(/^Started \[B1\] Workbench \(builds\/workbench\.json\)/);
    expect(reply?.reply).toContain("1500 × 600 × 900 mm");
    expect(reply?.reply).toContain("Total: £177.02, leaving out 1 line with no price");
    // The bolts given too short are only the length to use, its sum on its line (#763).
    expect(reply?.reply).toContain(
      "- M6 × 60 bolts: 16 × 1 (16 used, fit the castors to the bases), no price yet; long enough for 59.2 mm, through the castor plate 4 + castor base 45 + M6 washer 1.6 + M6 washer 1.6 + M6 lock nut 5 + two threads 2",
    );
    expect(reply?.reply).not.toContain("M6 × 50");
    expect(reply?.reply).toContain(
      "Stock options, the recommended first:\n- Frame timber, now 45 × 95 C16, for legs, long rails, end rails and shelf support:\n  - Sawn C16, 45 × 95 (recommended, picked): 5 lengths of 2.4 m, £34.00 at Woodstore (https://shop.example/c16-45x95). Strong, kiln-dried, rough faces. Right for a bench. Fine in a garage.\n  - CLS, 38 × 89: 5 lengths of 2.4 m, £31.50 at Woodstore (https://shop.example/cls-38x89). Smooth, with rounded edges, but 7 mm slimmer than C16, so each screw has less to grip. Less wood for screws.",
    );
    expect(reply?.reply).toContain(
      "  - MDF, 18 mm: 1 sheet of 2440 × 1220, £28.00 at Panel Cutters (https://shop.example/mdf-18). Smooth and cheap, but heavy, and splits at screws near its edges. Keep it dry.",
    );
  });

  it("marks an option's price with no shop, or no link, so the model never gives it as sourced (#704)", async () => {
    const { saver } = await sessionWith([
      [
        buildTool({
          name: "Workbench",
          template: "framed-bench",
          parameters: {
            ...goldenBench,
            prices: {
              ...goldenBench.prices,
              "osb-18": { pence: 3200 },
              "mdf-18": { pence: 2800, shop: "Panel Cutters" },
            },
          },
        }),
      ],
    ]);
    const [reply] = saver.replies[0] ?? [];
    expect(reply?.reply).toContain(
      "  - OSB, 18 mm: 1 sheet of 2440 × 1220, £32.00, no shop given. ",
    );
    expect(reply?.reply).toContain(
      "  - MDF, 18 mm: 1 sheet of 2440 × 1220, £28.00 at Panel Cutters, no link given. ",
    );
  });

  it("changes one size by its label, leaving every other parameter, and the Build works the rest out again", async () => {
    const { saver, events } = await sessionWith([
      [START_BENCH],
      [buildTool({ build: "B1", parameters: { height: { value: 850 } } })],
    ]);

    expect(await buildFile("workbench")).toEqual({
      name: "Workbench",
      template: "framed-bench",
      parameters: { ...goldenBench, height: { ...goldenBench.height, value: 850 } },
    });
    expect(buildSaves(events)[1]?.save).toEqual({
      action: "change",
      build: { slug: "workbench", name: "Workbench" },
      changes: ["height: 900 mm → 850 mm"],
    });
    const [reply] = saver.replies[1] ?? [];
    expect(reply?.reply).toMatch(/^Changed \[B1\] Workbench/);
    expect(reply?.reply).toContain("1500 × 600 × 850 mm");
  });

  it("gives a Build's numbers as they are for only its label, or a change of nothing, writing nothing", async () => {
    const { saver, events } = await sessionWith([
      [START_BENCH],
      [
        buildTool({ build: "B1" }),
        buildTool({ build: "B1", parameters: { height: goldenBench.height } }),
      ],
    ]);

    // A later session asked "how many screws?" reads them rather than working them out.
    const replies = saver.replies[1] ?? [];
    expect(replies.map(({ ok }) => ok)).toEqual([true, true]);
    for (const { reply } of replies) {
      expect(reply).toMatch(
        /^\[B1\] Workbench \(builds\/workbench\.json\) is as it was: nothing changed\. Its numbers as they are now:\n\nA framed bench, 1500 × 600 × 900 mm\./,
      );
      expect(reply).toContain("Total: £177.02");
    }
    expect(buildSaves(events)).toHaveLength(1);
    expect((await changesIn(contextDir)).map(({ title }) => title)).not.toContain(
      "Change Build: Workbench",
    );
  });

  it("refuses parameters code can't work out, saving nothing, and a Build that isn't there", async () => {
    const { height: _height, ...noHeight } = goldenBench;
    const { saver, request } = await sessionWith([
      [
        buildTool({ name: "Workbench", template: "framed-bench", parameters: noHeight }),
        buildTool({ build: "B4", parameters: { height: { value: 850 } } }),
      ],
    ]);

    expect(saver.replies[0]).toEqual([
      {
        ok: false,
        reply: expect.stringMatching(/^Those parameters can't be worked out:\n- height: /),
      },
      {
        ok: false,
        reply: expect.stringContaining("There's no Build labelled B4"),
      },
    ]);
    expect(
      Builds.parse(await (await request("/api/fabrication/workspaces/garage/builds")).json()),
    ).toEqual({ builds: [], problems: [] });
  });
});

/** The garage with a workbench, written as Fabrication keeps it, and the owner logged in. */
const withBench = async () => {
  await mkdir(join(contextDir, "garage", "builds"), { recursive: true });
  await writeFile(
    join(contextDir, "garage", "builds", "workbench.json"),
    JSON.stringify({ name: "Workbench", template: "framed-bench", parameters: goldenBench }),
  );
  return asOwner(testWorker({ root }));
};

describe("Fabrication's API", () => {
  it("changes a Build's parameters by a merge patch, as one change the owner can undo", async () => {
    const request = await withBench();

    const response = await sendJson(
      request,
      "/api/fabrication/workspaces/garage/builds/workbench/parameters",
      "PATCH",
      { parameters: { castors: null, shelf: { on: false } } },
    );
    expect(response.status).toBe(200);
    const changed = BuildChanged.parse(await response.json());
    expect(changed.build.parameters).not.toHaveProperty("castors");
    expect(changed.build.parameters).toMatchObject({
      shelf: { on: false, height: goldenBench.shelf.height },
    });
    // Without castors the bench stands on its legs, the full 900 mm.
    expect(changed.build.derived).toMatchObject({ size: { height: 900 } });
    expect((await changesIn(contextDir))[0]?.title).toBe("Change Build: Workbench");

    expect((await postJson(request, `/api/changes/${changed.change}/undo`, {})).status).toBe(204);
    expect(await buildFile("workbench")).toMatchObject({
      parameters: { castors: goldenBench.castors },
    });
  });

  it("refuses parameters that can't be worked out, and changes nothing", async () => {
    const request = await withBench();

    const response = await sendJson(
      request,
      "/api/fabrication/workspaces/garage/builds/workbench/parameters",
      "PATCH",
      { parameters: { height: { source: null } } },
    );

    expect(response.status).toBe(400);
    expect(await errorOf(response)).toMatch(
      /^Those parameters can't be worked out: height\.source/,
    );
    expect(await buildFile("workbench")).toMatchObject({
      parameters: { height: goldenBench.height },
    });
  });

  it("swaps a stock for one of its options, as one change the owner can undo from Fabrication (#704)", async () => {
    const request = await withBench();
    const options = (await viewOf(request, "workbench")).derived.options;
    expect(options.map(({ stock, name }) => [stock, name])).toEqual([
      ["45 × 95 C16", "Frame timber"],
      ["18 mm plywood", "Sheet"],
    ]);

    const response = await postJson(
      request,
      "/api/fabrication/workspaces/garage/builds/workbench/stock",
      { stock: "45 × 95 C16", option: "cls-38x89" },
    );
    expect(response.status).toBe(200);
    const changed = BuildChanged.parse(await response.json());
    expect(changed.build.derived.buyList.lines[0]).toMatchObject({
      item: "38 × 89 CLS, 2.4 m",
      total: 3150,
    });
    expect(changed.build.derived.parts.find(({ label }) => label === "C")?.length).toBe(474);
    expect((await changesIn(contextDir))[0]?.title).toBe("Change Build: Workbench");

    const undone = await postJson(
      request,
      `/api/fabrication/workspaces/garage/builds/workbench/changes/${changed.change}/undo`,
      {},
    );
    expect(undone.status).toBe(200);
    expect(BuildView.parse(await undone.json()).derived.buyList.lines[0]).toMatchObject({
      item: "45 × 95 C16, 2.4 m",
      total: 3400,
    });
    expect(await buildFile("workbench")).toEqual({
      name: "Workbench",
      template: "framed-bench",
      parameters: goldenBench,
    });
  });

  it("refuses an option the stock doesn't have, and Undo of another Build's change", async () => {
    const request = await withBench();
    const refused = await postJson(
      request,
      "/api/fabrication/workspaces/garage/builds/workbench/stock",
      { stock: "45 × 95 C16", option: "mdf-18" },
    );
    expect(refused.status).toBe(400);
    expect(await errorOf(refused)).toBe("mdf-18 isn't one of 45 × 95 C16's options.");

    await writeFile(
      join(contextDir, "garage", "builds", "trestle.json"),
      JSON.stringify({ name: "Trestle", template: "framed-bench", parameters: goldenBench }),
    );
    const picked = BuildChanged.parse(
      await (
        await postJson(request, "/api/fabrication/workspaces/garage/builds/workbench/stock", {
          stock: "18 mm plywood",
          option: "osb-18",
        })
      ).json(),
    );
    const elsewhere = await postJson(
      request,
      `/api/fabrication/workspaces/garage/builds/trestle/changes/${picked.change}/undo`,
      {},
    );
    expect(elsewhere.status).toBe(404);
    expect(await buildFile("workbench")).toMatchObject({
      parameters: { top: { sheet: { name: "18 mm OSB" } } },
    });
  });

  it("reports a file that isn't a Build rather than failing, and keeps none in a code workspace", async () => {
    const request = await withBench();
    await writeFile(join(contextDir, "garage", "builds", "shelves.json"), "{ not json");
    await writeFile(
      join(contextDir, "garage", "builds", "trestle.json"),
      JSON.stringify({ name: "Trestle", template: "framed-bench", parameters: { length: 900 } }),
    );

    const listed = Builds.parse(
      await (await request("/api/fabrication/workspaces/garage/builds")).json(),
    );
    expect(listed.builds.map(({ slug }) => slug)).toEqual(["workbench"]);
    expect(listed.problems).toEqual([
      { path: "builds/shelves.json", problem: "It isn't JSON." },
      {
        path: "builds/trestle.json",
        problem: expect.stringMatching(/^Its parameters can't be worked out: length: /),
      },
    ]);
    const unreadable = await request("/api/fabrication/workspaces/garage/builds/shelves");
    expect(unreadable.status).toBe(409);
    expect(await errorOf(unreadable)).toBe(
      "builds/shelves.json can't be read as a Build: It isn't JSON.",
    );

    await writeFile(
      join(contextDir, "garage", "workspace.json"),
      JSON.stringify({ mode: "code", repoPath: "/path/to/repo" }),
    );
    expect((await request("/api/fabrication/workspaces/garage/builds")).status).toBe(409);
  });
});

describe("a project step's Build", () => {
  const projectFile = () => join(contextDir, "garage", "projects", "split-the-garage.md");
  /** The garage's project, its second step for making the bench, then any more steps' lines. */
  const withProject = async (...steps: string[]) => {
    await mkdir(join(contextDir, "garage", "projects"), { recursive: true });
    await writeFile(
      projectFile(),
      [
        "---",
        "name: Split the garage",
        "status: active",
        "---",
        "",
        "## Steps",
        "",
        "- [ ] Measure the back wall [id: s1] [who: you]",
        "- [ ] Build the workbench · a weekend [id: s2] [who: you]",
        ...steps,
        "",
      ].join("\n"),
    );
  };

  it("is given with the Build, so the step owns it, and stays through a change to the step", async () => {
    await withProject();
    const { saver, events, request } = await sessionWith([
      [
        buildTool({
          name: "Workbench",
          template: "framed-bench",
          parameters: goldenBench,
          project: "P1",
          step: "s2",
        }),
      ],
      [
        {
          call: "save_project",
          input: { project: "P1", step: "s2", step_text: "Build the bench" },
        },
      ],
    ]);

    expect(saver.replies[0]?.[0]?.reply).toContain(
      "Its project step: Changed [P1] Split the garage.",
    );
    expect(events.flatMap((event) => (event.type === "project-saved" ? [event.save] : []))).toEqual(
      [
        {
          action: "change",
          project: { slug: "split-the-garage", name: "Split the garage" },
          changes: ["Step: Build the workbench (you, Build: workbench)"],
        },
        {
          action: "change",
          project: { slug: "split-the-garage", name: "Split the garage" },
          changes: ["Step: Build the bench (you, Build: workbench)"],
        },
      ],
    );
    expect(await readFile(projectFile(), "utf8")).toContain(
      "- [ ] Build the bench · a weekend [id: s2] [who: you] [build: workbench]\n",
    );
    const home = PlanningHome.parse(await (await request("/api/workspaces/garage/home")).json());
    expect(home.projects[0]?.steps[1]).toEqual({
      id: "s2",
      text: "Build the bench",
      detail: "a weekend",
      who: "you",
      done: false,
      needs: [],
      build: "workbench",
    });
  });

  it("shows a step whose Build was undone as removed, until the step's Build is cleared", async () => {
    await withProject();
    const saver = savingProvider([
      [
        buildTool({
          name: "Workbench",
          template: "framed-bench",
          parameters: goldenBench,
          project: "P1",
          step: "s2",
        }),
      ],
      [{ call: "save_project", input: { project: "P1", step: "s2", step_build: "" } }],
    ]);
    const request = await asOwner(testWorker({ root, providers: [saver.provider] }));
    const started = await postJson(request, "/api/workspaces/garage/sessions", {
      text: "A bench for the garage.",
      model: SAVING_MODEL,
    });
    const sessionId = SessionSummary.parse(await started.json()).id;
    const events = await followSession(request, { sessionId, until: "turn-completed" });
    const [saved] = buildSaves(events);
    const undone = await postJson(
      request,
      `/api/sessions/${sessionId}/builds/${saved?.seq}/undo`,
      {},
    );
    expect(undone.status).toBe(204);
    const turn = async () => {
      await postJson(request, `/api/sessions/${sessionId}/messages`, {
        text: "And then?",
        model: SAVING_MODEL,
      });
      events.push(
        ...(await followSession(request, {
          sessionId,
          until: "turn-completed",
          after: events.at(-1)?.seq ?? 0,
        })),
      );
    };

    await turn();
    const removed =
      "- projects/split-the-garage.md: Step s2's Build, workbench: Build removed. Give the step a Build again with save_build, or clear it with step_build as an empty text.";
    expect(saver.framings[1]?.instructions).toContain(removed);
    expect(saver.replies[1]).toEqual([{ ok: true, reply: "Changed [P1] Split the garage." }]);
    expect(await readFile(projectFile(), "utf8")).toContain(
      "- [ ] Build the workbench · a weekend [id: s2] [who: you]\n",
    );
    await turn();
    expect(saver.framings[2]?.instructions).not.toContain("Build removed");
  });

  it("reads a project with a mistyped Build link, keeping the step without it and saying why", async () => {
    await withProject("- [ ] Fit the shelf [id: s3] [who: you] [build: Work Bench]");
    const { saver, request } = await sessionWith([[]]);

    const home = PlanningHome.parse(await (await request("/api/workspaces/garage/home")).json());
    expect(home.projects[0]?.steps[2]).toEqual({
      id: "s3",
      text: "Fit the shelf",
      who: "you",
      done: false,
      needs: [],
    });
    expect(saver.framings[0]?.instructions).toContain(
      `- projects/split-the-garage.md: Step "Fit the shelf"'s Build link "[build: Work Bench]" isn't a Build's file name (lowercase letters, digits and dashes), so the step is read without it.`,
    );
    expect(saver.framings[0]?.instructions).not.toContain("can't be read as a project");
  });

  it("is given to a step by the Build's label alone, when the Build is there already", async () => {
    await withProject();
    const { saver, events } = await sessionWith([
      [START_BENCH],
      [buildTool({ build: "B1", project: "P1", step: "s2" })],
    ]);

    const [reply] = saver.replies[1] ?? [];
    expect(reply?.reply).toMatch(/^\[B1\] Workbench \(builds\/workbench\.json\) is as it was/);
    expect(reply?.reply).toContain("Its project step: Changed [P1] Split the garage.");
    expect(buildSaves(events)).toHaveLength(1);
    expect(await readFile(projectFile(), "utf8")).toContain(
      "- [ ] Build the workbench · a weekend [id: s2] [who: you] [build: workbench]\n",
    );
  });
});

describe("Undo", () => {
  it("from a Build's note puts its file back, tells the next turn, and Recent changes lists the change and its undo", async () => {
    const { session, events, request, saver } = await sessionWith([
      [START_BENCH],
      [buildTool({ build: "B1", parameters: { height: { value: 850 } } })],
    ]);
    const [, changed] = buildSaves(events);

    const undone = await postJson(
      request,
      `/api/sessions/${session.id}/builds/${changed?.seq}/undo`,
      {},
    );
    expect(undone.status).toBe(204);
    expect(await buildFile("workbench")).toMatchObject({ parameters: { height: { value: 900 } } });

    const changes = RecentChanges.parse(
      await (await request("/api/workspaces/garage/changes")).json(),
    ).changes;
    expect(changes.map(({ kind, build, undo }) => ({ kind, build, undo }))).toEqual([
      {
        kind: "undo",
        build: { did: "changed", name: "Workbench", slug: "workbench" },
        undo: "none",
      },
      {
        kind: "build",
        build: { did: "changed", name: "Workbench", slug: "workbench" },
        undo: "undone",
      },
      {
        kind: "build",
        build: { did: "added", name: "Workbench", slug: "workbench" },
        undo: "available",
      },
    ]);

    // The next turn is told its Build saves, and that the owner undid the height, so it doesn't
    // carry on as if the bench were lower.
    await postJson(request, `/api/sessions/${session.id}/messages`, {
      text: "How high is it now?",
      model: SAVING_MODEL,
    });
    await followSession(request, {
      sessionId: session.id,
      until: "turn-completed",
      after: events.at(-1)?.seq ?? 0,
    });
    expect(saver.framings[2]?.message).toContain(
      "You: Done.\n\nYour saves in this answer:\n- Changed the Build Workbench: height: 900 mm → 850 mm (the owner undid this)",
    );
    expect(saver.framings[2]?.message).toContain(
      "Your saves in this answer:\n- Started the Build Workbench (kept)",
    );

    // Undoing its start from Recent changes, through its session, takes the Build away.
    const started = changes[2]?.id;
    expect((await postJson(request, `/api/changes/${started}/undo`, {})).status).toBe(204);
    expect(
      Builds.parse(await (await request("/api/fabrication/workspaces/garage/builds")).json())
        .builds,
    ).toEqual([]);
  });
});
