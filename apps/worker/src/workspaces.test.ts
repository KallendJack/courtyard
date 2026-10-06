import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, WorkspaceDetail, WorkspaceList, WorkspaceSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asOwner, errorOf, postJson, type Requester, testWorker } from "./testing.ts";

let root: string;
let contextDir: string;
let request: Requester;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(contextDir);
  request = await asOwner(testWorker({ root }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Creates a workspace folder in the temporary context folder, with the files given. */
const workspace = async (id: string, files: Record<string, string> = {}) => {
  await mkdir(join(contextDir, id));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(contextDir, id, name), content);
  }
};

const listWorkspaces = async () => {
  const response = await request("/api/workspaces");
  expect(response.status).toBe(200);
  return WorkspaceList.parse(await response.json()).workspaces;
};

describe("the workspace list", () => {
  it("lists every workspace folder", async () => {
    await workspace("garage-gym", { "CONTEXT.md": "# Garage gym\n" });
    await workspace("side-project");

    const ids = (await listWorkspaces()).map((w) => w.id);

    expect(ids).toEqual(["garage-gym", "side-project"]);
  });

  it("skips folders that aren't workspace ids, and loose files", async () => {
    await workspace("garage-gym");
    await mkdir(join(contextDir, ".git"));
    await mkdir(join(contextDir, "Old Notes"));
    await writeFile(join(contextDir, "readme.md"), "not a workspace");

    const ids = (await listWorkspaces()).map((w) => w.id);

    expect(ids).toEqual(["garage-gym"]);
  });

  it("names a workspace from its config, then its context file's title, then its folder", async () => {
    await workspace("bike", { "workspace.json": '{ "name": "MTB workstation" }' });
    await workspace("garage-gym", { "CONTEXT.md": "# Garage gym\n\n## Facts\n" });
    await workspace("office");

    const names = (await listWorkspaces()).map((w) => [w.id, w.name]);

    expect(names).toEqual([
      ["garage-gym", "Garage gym"],
      ["bike", "MTB workstation"],
      ["office", "office"],
    ]);
  });

  it("says which workspaces have a context file", async () => {
    await workspace("garage-gym", { "CONTEXT.md": "# Garage gym\n" });
    await workspace("office");

    const flags = (await listWorkspaces()).map((w) => [w.id, w.hasContextFile]);

    expect(flags).toEqual([
      ["garage-gym", true],
      ["office", false],
    ]);
  });

  it("treats a workspace as a planning workspace unless its config says code", async () => {
    await workspace("side-project", {
      "workspace.json": '{ "mode": "code", "repoPath": "/path/to/repo" }',
    });
    await workspace("garage-gym");

    const modes = (await listWorkspaces()).map((w) => [w.id, w.mode]);

    expect(modes).toEqual([
      ["garage-gym", "planning"],
      ["side-project", "code"],
    ]);
  });

  it("falls back to a planning workspace when its config is invalid, and says why", async () => {
    await workspace("broken-json", { "workspace.json": "{ not json" });
    await workspace("code-without-repo", { "workspace.json": '{ "mode": "code" }' });

    const [broken, noRepo] = await listWorkspaces();

    expect(broken).toMatchObject({ id: "broken-json", mode: "planning" });
    expect(broken?.configProblem).toContain("workspace.json");
    expect(noRepo).toMatchObject({ id: "code-without-repo", mode: "planning" });
    expect(noRepo?.configProblem).toContain("repoPath");
  });
});

const openWorkspace = async (id: string) => {
  const response = await request(`/api/workspaces/${id}`);
  expect(response.status).toBe(200);
  return WorkspaceDetail.parse(await response.json());
};

describe("opening a workspace", () => {
  it("reads its context file into facts, plans and ideas, keeping the text above them", async () => {
    await workspace("garage-gym", {
      "CONTEXT.md": [
        "# Garage gym",
        "",
        "Single garage, shared with the bikes.",
        "",
        "## Facts",
        "",
        "- The garage isn't cleared out yet.",
        "- Budget is £1,200.",
        "",
        "## Plans",
        "",
        "- Squat rack on the left wall.",
        "",
        "## Ideas",
        "",
        "- Rubber flooring.",
        "",
      ].join("\n"),
    });

    const { workspace: summary, contextFile } = await openWorkspace("garage-gym");

    expect(summary).toMatchObject({ id: "garage-gym", name: "Garage gym", hasContextFile: true });
    expect(contextFile).toEqual({
      title: "Garage gym",
      intro: "Single garage, shared with the bikes.",
      facts: ["The garage isn't cleared out yet.", "Budget is £1,200."],
      plans: ["Squat rack on the left wall."],
      ideas: ["Rubber flooring."],
      other: "",
      characters: expect.any(Number),
    });
  });

  it("says how long its context file is, since the whole file goes with every message", async () => {
    await workspace("office", { "CONTEXT.md": "## Ideas\n\n- A standing desk.\n" });

    const { contextFile } = await openWorkspace("office");

    expect(contextFile?.characters).toBe(29);
  });

  it("treats missing sections as empty", async () => {
    await workspace("office", { "CONTEXT.md": "## Ideas\n\n- A standing desk.\n" });

    const { contextFile } = await openWorkspace("office");

    expect(contextFile).toMatchObject({ facts: [], plans: [], ideas: ["A standing desk."] });
    expect(contextFile?.title).toBeUndefined();
  });

  it("joins an item's wrapped lines, keeps plain lines, and keeps other sections as written", async () => {
    await workspace("allotment", {
      "CONTEXT.md": [
        "## Facts",
        "- The plot is ten metres long",
        "  and faces south.",
        "The shed has one window.",
        "",
        "## Links",
        "",
        "See the seed catalogue.",
        "",
        "## plans (decided, not done)",
        "1. Build two raised beds.",
      ].join("\r\n"),
    });

    const { contextFile } = await openWorkspace("allotment");

    expect(contextFile?.facts).toEqual([
      "The plot is ten metres long and faces south.",
      "The shed has one window.",
    ]);
    expect(contextFile?.plans).toEqual(["Build two raised beds."]);
    expect(contextFile?.other).toBe("## Links\n\nSee the seed catalogue.");
  });

  it("recognises sections at any heading level, and skips subheadings inside them", async () => {
    await workspace("office", {
      "CONTEXT.md": [
        "# Office",
        "# Facts",
        "### Desk",
        "- The desk is 140 cm wide.",
        "### Plans",
        "- Move the desk under the window.",
      ].join("\n"),
    });

    const { contextFile } = await openWorkspace("office");

    expect(contextFile).toMatchObject({
      title: "Office",
      facts: ["The desk is 140 cm wide."],
      plans: ["Move the desk under the window."],
    });
  });

  it("says when a workspace has no context file yet", async () => {
    await workspace("office");

    const { workspace: summary, contextFile } = await openWorkspace("office");

    expect(summary.hasContextFile).toBe(false);
    expect(contextFile).toBeNull();
  });

  it("reports a context file that can't be read, rather than calling it missing", async () => {
    await workspace("office");
    await mkdir(join(contextDir, "office", "CONTEXT.md"));

    for (const path of ["/api/workspaces", "/api/workspaces/office"]) {
      const response = await request(path);
      expect(response.status).toBe(500);
      expect(await errorOf(response)).toContain("office");
    }
  });

  it("ignores a workspace config that can't be read, and says why", async () => {
    await workspace("office");
    await mkdir(join(contextDir, "office", "workspace.json"));

    const { workspace: summary } = await openWorkspace("office");

    expect(summary.mode).toBe("planning");
    expect(summary.configProblem).toContain("workspace.json");
  });

  it("answers 404 for a workspace that doesn't exist or isn't a valid id", async () => {
    await workspace("garage-gym");

    for (const id of ["nope", "Garage%20Gym", "..%2Fsecret"]) {
      const response = await request(`/api/workspaces/${id}`);
      expect(response.status).toBe(404);
      expect(ApiError.safeParse(await response.json()).success).toBe(true);
    }
  });
});

const addWorkspace = (name: unknown) => postJson(request, "/api/workspaces", { name });

const added = async (name: string) => {
  const response = await addWorkspace(name);
  expect(response.status).toBe(201);
  return WorkspaceSummary.parse(await response.json());
};

const changeWorkspace = (id: string, change: unknown) =>
  request(`/api/workspaces/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(change),
  });

const changeColour = (id: string, colour: unknown) => changeWorkspace(id, { colour });
const renameWorkspace = (id: string, name: unknown) => changeWorkspace(id, { name });
const archive = (id: string) => postJson(request, `/api/workspaces/${id}/archive`, {});

describe("adding a workspace", () => {
  it("makes its folder and a starter context file with empty facts, plans and ideas", async () => {
    const workspace = await added("Garage gym");

    expect(workspace).toMatchObject({
      id: "garage-gym",
      name: "Garage gym",
      mode: "planning",
      hasContextFile: true,
    });
    const markdown = await readFile(join(contextDir, "garage-gym", "CONTEXT.md"), "utf8");
    expect(markdown).toMatch(/^# Garage gym\n/);
    const { contextFile } = await openWorkspace("garage-gym");
    expect(contextFile).toMatchObject({ title: "Garage gym", facts: [], plans: [], ideas: [] });
    // The hint says how to write lines, in the words of docs/ai-conduct.md.
    expect(contextFile?.intro).toContain("one line");
  });

  it("makes a folder name from the name, keeping the name as written", async () => {
    const birthday = await added("  Nan's 80th Birthday!  ");
    const cafe = await added("Café plans");
    const shed = await added("Søren's Straße shed");

    expect([birthday.id, birthday.name]).toEqual(["nans-80th-birthday", "Nan's 80th Birthday!"]);
    expect([cafe.id, cafe.name]).toEqual(["cafe-plans", "Café plans"]);
    expect(shed.id).toBe("sorens-strasse-shed");
    expect((await listWorkspaces()).map((w) => w.id)).toEqual([
      "cafe-plans",
      "nans-80th-birthday",
      "sorens-strasse-shed",
    ]);
  });

  it("refuses a name that clashes with a workspace's folder or its name", async () => {
    await workspace("garage-gym");
    await workspace("bike", { "workspace.json": '{ "name": "MTB workstation" }' });

    for (const name of ["Garage Gym", "mtb workstation"]) {
      const response = await addWorkspace(name);
      expect(response.status).toBe(409);
      expect(await errorOf(response)).toContain("already");
    }
    expect((await listWorkspaces()).map((w) => w.id)).toEqual(["garage-gym", "bike"]);
  });

  it("refuses a name that can't be a folder name, saying why", async () => {
    for (const name of ["", "   ", "!!!", "日本語", "Con", "nul", "x".repeat(61), 42]) {
      const response = await addWorkspace(name);
      expect(response.status, String(name)).toBe(400);
      expect(await errorOf(response)).not.toBe("");
    }
    expect(await listWorkspaces()).toEqual([]);
  });

  it("gives each new workspace the colour the fewest workspaces have, in turn", async () => {
    const colours = [];
    for (const name of ["One", "Two", "Three", "Four", "Five", "Six"]) {
      colours.push((await added(name)).colour);
    }

    expect(colours).toEqual(["bracken", "heather", "slate", "moss", "peat", "bracken"]);
  });

  it("never changes another workspace's colour", async () => {
    await workspace("office");
    await workspace("studio");
    const before = (await listWorkspaces()).map((w) => [w.id, w.colour]);

    const allotment = await added("Allotment");

    expect(before).toEqual([
      ["office", "bracken"],
      ["studio", "heather"],
    ]);
    expect(allotment.colour).toBe("slate");
    expect((await listWorkspaces()).map((w) => [w.id, w.colour])).toEqual([
      ["allotment", "slate"],
      ...before,
    ]);
  });
});

describe("changing a workspace's colour", () => {
  it("keeps the new colour, and the rest of the workspace's config", async () => {
    await workspace("side-project", {
      "workspace.json": '{ "mode": "code", "repoPath": "/path/to/repo" }',
    });

    const response = await changeColour("side-project", "moss");

    expect(response.status).toBe(200);
    expect(WorkspaceSummary.parse(await response.json())).toMatchObject({
      colour: "moss",
      mode: "code",
    });
    const { workspace: reopened } = await openWorkspace("side-project");
    expect(reopened).toMatchObject({ colour: "moss", mode: "code" });
  });

  it("never changes another workspace's colour, even one that wasn't kept yet", async () => {
    await workspace("office");
    await workspace("studio");
    await workspace("workshop");
    const before = (await listWorkspaces()).map((w) => [w.id, w.colour]);

    expect((await changeColour("office", "moss")).status).toBe(200);

    expect(before).toEqual([
      ["office", "bracken"],
      ["studio", "heather"],
      ["workshop", "slate"],
    ]);
    expect((await listWorkspaces()).map((w) => [w.id, w.colour])).toEqual([
      ["office", "moss"],
      ["studio", "heather"],
      ["workshop", "slate"],
    ]);
    // Kept now, so a folder added by hand later can't move them either.
    await workspace("attic");
    expect((await listWorkspaces()).map((w) => w.colour)).toEqual([
      "bracken",
      "moss",
      "heather",
      "slate",
    ]);
  });

  it("refuses a colour that isn't one of the five, or a workspace that doesn't exist", async () => {
    await workspace("office");

    expect((await changeColour("office", "teal")).status).toBe(400);
    expect((await changeColour("nope", "moss")).status).toBe(404);
  });

  it("won't overwrite a config it had to ignore", async () => {
    await workspace("office", { "workspace.json": "{ not json" });

    const response = await changeColour("office", "moss");

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toContain("workspace.json");
    expect(await readFile(join(contextDir, "office", "workspace.json"), "utf8")).toBe("{ not json");
  });
});

describe("renaming a workspace", () => {
  it("keeps the new name in its config, alongside the rest, and leaves its folder alone", async () => {
    await workspace("side-project", {
      "CONTEXT.md": "# Side project\n",
      "workspace.json": '{ "mode": "code", "repoPath": "/path/to/repo", "colour": "moss" }',
    });

    const response = await renameWorkspace("side-project", "  Courtyard  ");

    expect(response.status).toBe(200);
    expect(WorkspaceSummary.parse(await response.json())).toMatchObject({
      id: "side-project",
      name: "Courtyard",
    });
    const config = JSON.parse(
      await readFile(join(contextDir, "side-project", "workspace.json"), "utf8"),
    );
    expect(config).toEqual({
      mode: "code",
      repoPath: "/path/to/repo",
      colour: "moss",
      name: "Courtyard",
    });
    expect((await listWorkspaces()).map((w) => [w.id, w.name, w.colour])).toEqual([
      ["side-project", "Courtyard", "moss"],
    ]);
  });

  it("refuses a name another workspace has, but not a new spelling of its own", async () => {
    await workspace("garage-gym", { "CONTEXT.md": "# Garage gym\n" });
    await workspace("office");

    const clash = await renameWorkspace("office", "garage GYM");
    const ownName = await renameWorkspace("garage-gym", "Garage Gym");

    expect(clash.status).toBe(409);
    expect(await errorOf(clash)).toContain("already a workspace called Garage gym");
    expect(ownName.status).toBe(200);
    expect((await listWorkspaces()).map((w) => w.name)).toEqual(["Garage Gym", "office"]);
  });

  it("refuses an empty or overlong name, and a workspace that doesn't exist", async () => {
    await workspace("office");

    for (const name of ["", "   ", "x".repeat(61), 42]) {
      expect((await renameWorkspace("office", name)).status, String(name)).toBe(400);
    }
    expect((await changeWorkspace("office", {})).status).toBe(400);
    expect((await renameWorkspace("nope", "Studio")).status).toBe(404);
  });

  it("won't overwrite a config it had to ignore", async () => {
    await workspace("office", { "workspace.json": "{ not json" });

    const response = await renameWorkspace("office", "Studio");

    expect(response.status).toBe(409);
    expect(await readFile(join(contextDir, "office", "workspace.json"), "utf8")).toBe("{ not json");
  });
});

describe("archiving a workspace", () => {
  it("takes it out of the list and moves its folder, files and all, to the archived folder", async () => {
    await workspace("garage-gym", { "CONTEXT.md": "# Garage gym\n" });
    await workspace("office");

    const response = await archive("garage-gym");

    expect(response.status).toBe(204);
    expect((await listWorkspaces()).map((w) => w.id)).toEqual(["office"]);
    expect(await readdir(join(contextDir, "archived"))).toEqual(["garage-gym"]);
    expect(await readFile(join(contextDir, "archived", "garage-gym", "CONTEXT.md"), "utf8")).toBe(
      "# Garage gym\n",
    );
  });

  it("says a workspace is archived when it's opened, and comes back when its folder is moved back", async () => {
    await workspace("garage-gym", { "CONTEXT.md": "# Garage gym\n" });
    await archive("garage-gym");

    const opened = await request("/api/workspaces/garage-gym");

    expect(opened.status).toBe(410);
    expect(await errorOf(opened)).toContain("archived");
    await rename(join(contextDir, "archived", "garage-gym"), join(contextDir, "garage-gym"));
    expect((await listWorkspaces()).map((w) => w.id)).toEqual(["garage-gym"]);
  });

  it("refuses a new workspace whose folder an archived one has, saying how to bring it back", async () => {
    await workspace("garage-gym");
    await archive("garage-gym");

    const response = await addWorkspace("Garage gym");

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toContain("archived");
  });

  it("never lists the archived folder as a workspace, or lets one be called that", async () => {
    await mkdir(join(contextDir, "archived"));

    expect(await listWorkspaces()).toEqual([]);
    expect((await addWorkspace("Archived")).status).toBe(400);
    expect((await archive("archived")).status).toBe(404);
  });

  it("answers 404 for a workspace that doesn't exist", async () => {
    expect((await archive("nope")).status).toBe(404);
  });
});
