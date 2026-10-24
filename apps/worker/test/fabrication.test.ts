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
    // castors, and £172.06 in all.
    const view = await viewOf(request, "workbench");
    expect(view.derived).toMatchObject({
      size: { length: 1500, depth: 600, height: 899.6 },
      buyList: { total: 17206, unpriced: 0 },
    });
    const [reply] = saver.replies[0] ?? [];
    expect(reply?.ok).toBe(true);
    expect(reply?.reply).toMatch(/^Started \[B1\] Workbench \(builds\/workbench\.json\)/);
    expect(reply?.reply).toContain("1500 × 600 × 899.6 mm");
    expect(reply?.reply).toContain("Total: £172.06");
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
    expect(reply?.reply).toContain("1500 × 600 × 849.6 mm");
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
  it("is given with the Build, so the step owns it, and stays through a change to the step", async () => {
    await mkdir(join(contextDir, "garage", "projects"), { recursive: true });
    await writeFile(
      join(contextDir, "garage", "projects", "split-the-garage.md"),
      [
        "---",
        "name: Split the garage",
        "status: active",
        "---",
        "",
        "## Steps",
        "",
        "- [you can do this] Measure the back wall",
        "- [you can do this] Build the workbench · a weekend",
        "",
      ].join("\n"),
    );
    const { saver, events, request } = await sessionWith([
      [
        buildTool({
          name: "Workbench",
          template: "framed-bench",
          parameters: goldenBench,
          project: "P1",
          step: 2,
        }),
      ],
      [{ call: "save_project", input: { project: "P1", step: 2, step_text: "Build the bench" } }],
    ]);

    expect(saver.replies[0]?.[0]?.reply).toContain(
      "Its project step: Changed [P1] Split the garage.",
    );
    expect(events.flatMap((event) => (event.type === "project-saved" ? [event.save] : []))).toEqual(
      [
        {
          action: "change",
          project: { slug: "split-the-garage", name: "Split the garage" },
          changes: ["Step: Build the workbench (you can do this, Build: workbench)"],
        },
        {
          action: "change",
          project: { slug: "split-the-garage", name: "Split the garage" },
          changes: ["Step: Build the bench (you can do this, Build: workbench)"],
        },
      ],
    );
    expect(
      await readFile(join(contextDir, "garage", "projects", "split-the-garage.md"), "utf8"),
    ).toContain("- [you can do this] Build the bench · a weekend [build: workbench]\n");
    const home = PlanningHome.parse(await (await request("/api/workspaces/garage/home")).json());
    expect(home.projects[0]?.steps[1]).toEqual({
      kind: "you can do this",
      text: "Build the bench",
      detail: "a weekend",
      build: "workbench",
    });
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
