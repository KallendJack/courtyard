import { mkdir, mkdtemp, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, WorkspaceDetail, WorkspaceList, WorkspaceSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  changesIn,
  errorOf,
  postJson,
  type Requester,
  removeTestFolder,
  sendJson,
  testWorker,
} from "./testing.ts";

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
  await removeTestFolder(root);
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
  it("reads its context file into facts and ideas, keeping the text above them and Plans as written", async () => {
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
      ideas: ["Rubber flooring."],
      // Plans went with projects (#603): a Plans section is kept as written, for the move review.
      other: "## Plans\n\n- Squat rack on the left wall.",
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

    expect(contextFile).toMatchObject({ facts: [], ideas: ["A standing desk."] });
    expect(contextFile?.title).toBeUndefined();
  });

  it("joins an item's wrapped lines, keeps plain lines, and keeps other sections as written, Plans among them (#603)", async () => {
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
    expect(contextFile?.other).toBe(
      "## Links\n\nSee the seed catalogue.\n\n## plans (decided, not done)\n1. Build two raised beds.",
    );
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
      ideas: [],
      // Plans went with projects (#603): its lines are kept as written, not as facts.
      other: "### Plans\n- Move the desk under the window.",
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

const changeIcon = (id: string, icon: unknown) => changeWorkspace(id, { icon });
const renameWorkspace = (id: string, name: unknown) => changeWorkspace(id, { name });
const archive = (id: string) => postJson(request, `/api/workspaces/${id}/archive`, {});

describe("adding a workspace", () => {
  it("makes its folder and a starter context file with empty facts and ideas", async () => {
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
    // No hint where the intro line goes: models would read it as what the workspace is for (#300).
    expect(contextFile).toMatchObject({
      title: "Garage gym",
      intro: "",
      facts: [],
      ideas: [],
      other: "",
    });
    expect(markdown).not.toContain("one line");
    expect(markdown).not.toContain("Plans");
  });

  it("reads a context file whose intro line is still the old starter hint as having none", async () => {
    await workspace("garage-gym", {
      "CONTEXT.md": [
        "# Garage gym",
        "",
        "Write one line for each fact, plan or idea. Facts are true now, plans are decided but not done, and ideas are being considered.",
        "",
        "## Facts",
        "",
        "- Budget is £1,200.",
        "",
      ].join("\n"),
    });

    const { contextFile } = await openWorkspace("garage-gym");

    expect(contextFile).toMatchObject({ intro: "", facts: ["Budget is £1,200."] });
  });

  it("starts the context file with what it's for, when the owner says, as its intro line", async () => {
    const response = await postJson(request, "/api/workspaces", {
      name: "Garage gym",
      intro: "  Turning the garage into a home gym by Christmas  ",
    });

    expect(response.status).toBe(201);
    const { contextFile } = await openWorkspace("garage-gym");
    expect(contextFile).toMatchObject({
      title: "Garage gym",
      intro: "Turning the garage into a home gym by Christmas",
      facts: [],
      ideas: [],
    });
  });

  it("starts with no intro line when what it's for is left empty, and refuses more than one line", async () => {
    await postJson(request, "/api/workspaces", { name: "Garage gym", intro: "   " });
    const tooLong = await postJson(request, "/api/workspaces", {
      name: "Shed",
      intro: "x".repeat(251),
    });
    const twoLines = await postJson(request, "/api/workspaces", {
      name: "Shed",
      intro: "A shed.\nA big one.",
    });

    expect((await openWorkspace("garage-gym")).contextFile?.intro).toBe("");
    expect([tooLong.status, twoLines.status]).toEqual([400, 400]);
    expect(await errorOf(twoLines)).toContain("one line");
    expect((await listWorkspaces()).map((w) => w.id)).toEqual(["garage-gym"]);
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

  it("suggests an icon from the new workspace's name, and keeps it in its config", async () => {
    const icons = [];
    for (const name of ["Mountain Biking", "Garage", "Homelab", "Garage gym", "Pottery"]) {
      icons.push([name, (await added(name)).icon]);
    }

    expect(icons).toEqual([
      ["Mountain Biking", "bicycle"],
      ["Garage", "garage"],
      ["Homelab", "server"],
      // What it's for wins over where it is.
      ["Garage gym", "dumbbell"],
      // A name that says nothing gets the plain one.
      ["Pottery", "book"],
    ]);
    const config = JSON.parse(
      await readFile(join(contextDir, "mountain-biking", "workspace.json"), "utf8"),
    );
    expect(config).toEqual({ icon: "bicycle" });
  });
});

describe("a workspace's icon", () => {
  it("is suggested from its name when its config keeps none, and code for a code workspace", async () => {
    await workspace("courtyard", {
      "workspace.json": '{ "name": "Courtyard", "mode": "code", "repoPath": "/path/to/repo" }',
    });
    await workspace("homelab", { "CONTEXT.md": "# Homelab\n" });
    // A colour kept from before workspaces had icons is left alone.
    await workspace("office", { "workspace.json": '{ "colour": "moss" }' });

    expect((await listWorkspaces()).map((w) => [w.name, w.icon])).toEqual([
      ["Homelab", "server"],
      ["office", "briefcase"],
      ["Courtyard", "code"],
    ]);
    expect((await openWorkspace("courtyard")).workspace.icon).toBe("code");
  });

  it("can be changed, keeping the rest of the workspace's config", async () => {
    await workspace("side-project", {
      "workspace.json": '{ "mode": "code", "repoPath": "/path/to/repo", "colour": "moss" }',
    });
    await workspace("office");

    const response = await changeIcon("side-project", "music");

    expect(response.status).toBe(200);
    expect(WorkspaceSummary.parse(await response.json())).toMatchObject({
      icon: "music",
      mode: "code",
    });
    expect((await openWorkspace("side-project")).workspace).toMatchObject({
      icon: "music",
      mode: "code",
    });
    const config = JSON.parse(
      await readFile(join(contextDir, "side-project", "workspace.json"), "utf8"),
    );
    expect(config).toEqual({
      mode: "code",
      repoPath: "/path/to/repo",
      colour: "moss",
      icon: "music",
    });
    // No other workspace's config is written.
    expect(await readdir(join(contextDir, "office"))).toEqual([]);
  });

  it("refuses an icon that isn't one of the set, or a workspace that doesn't exist", async () => {
    await workspace("office");

    expect((await changeIcon("office", "teal")).status).toBe(400);
    expect((await changeIcon("nope", "music")).status).toBe(404);
  });

  it("won't overwrite a config it had to ignore", async () => {
    await workspace("office", { "workspace.json": "{ not json" });

    const response = await changeIcon("office", "music");

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
    expect((await listWorkspaces()).map((w) => [w.id, w.name, w.icon])).toEqual([
      ["side-project", "Courtyard", "code"],
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

/** Arranges the workspaces as the rail or the sidebar does once a tile is let go (#321). */
const arrange = (order: unknown) => sendJson(request, "/api/workspaces/order", "PUT", { order });

const ids = async () => (await listWorkspaces()).map((w) => w.id);

describe("arranging the workspaces", () => {
  const planningAndCode = async () => {
    await workspace("bike", { "CONTEXT.md": "# Bike\n" });
    await workspace("garage-gym", { "CONTEXT.md": "# Garage gym\n" });
    await workspace("office", { "CONTEXT.md": "# Office\n" });
    await workspace("courtyard", {
      "workspace.json": '{ "name": "Courtyard", "mode": "code", "repoPath": "/path/to/repo" }',
    });
    await workspace("homelab-mcp", {
      "workspace.json": '{ "name": "Homelab MCP", "mode": "code", "repoPath": "/path/to/other" }',
    });
  };

  it("lists them in the order saved, kept in the context folder as one change", async () => {
    await planningAndCode();
    const order = ["office", "bike", "garage-gym", "homelab-mcp", "courtyard"];

    const response = await arrange(order);

    expect(response.status).toBe(200);
    expect(WorkspaceList.parse(await response.json()).workspaces.map((w) => w.id)).toEqual(order);
    expect(await ids()).toEqual(order);
    expect(JSON.parse(await readFile(join(contextDir, "workspace-order.json"), "utf8"))).toEqual({
      order,
    });
    expect((await changesIn(contextDir))[0]).toEqual({
      title: "Arrange the workspaces",
      trailers: ["Courtyard-Change: workspace"],
    });
  });

  it("keeps the order when the worker starts again, as on any other device", async () => {
    await planningAndCode();
    const order = ["garage-gym", "office", "bike", "homelab-mcp", "courtyard"];
    await arrange(order);

    // A worker started again on the same context folder (with its own data folder, so its owner
    // is set up afresh).
    request = await asOwner(
      testWorker({ root, env: { COURTYARD_DATA_DIR: join(root, "data-again") } }),
    );

    expect(await ids()).toEqual(order);
  });

  it("puts a workspace the order doesn't name at the end of its own group, by name", async () => {
    await planningAndCode();
    await arrange(["office", "bike", "garage-gym", "homelab-mcp", "courtyard"]);

    await added("Allotment");
    await workspace("side-project", {
      "workspace.json": '{ "name": "Abacus", "mode": "code", "repoPath": "/path/to/third" }',
    });

    expect(await ids()).toEqual([
      "office",
      "bike",
      "garage-gym",
      "allotment",
      "homelab-mcp",
      "courtyard",
      "side-project",
    ]);
  });

  it("keeps planning and code workspaces in their own groups, refusing an order that mixes them", async () => {
    await planningAndCode();
    await arrange(["office", "bike", "garage-gym", "homelab-mcp", "courtyard"]);

    const mixed = await arrange(["office", "courtyard", "bike", "garage-gym", "homelab-mcp"]);

    expect(mixed.status).toBe(400);
    expect(await errorOf(mixed)).toContain("code");
    expect(await ids()).toEqual(["office", "bike", "garage-gym", "homelab-mcp", "courtyard"]);
  });

  it("lists planning workspaces first whatever order the file was left in by hand", async () => {
    await planningAndCode();
    await writeFile(
      join(contextDir, "workspace-order.json"),
      JSON.stringify({ order: ["courtyard", "office", "homelab-mcp", "bike"] }),
    );

    expect(await ids()).toEqual(["office", "bike", "garage-gym", "courtyard", "homelab-mcp"]);
  });

  it("falls back to names when the order file can't be read", async () => {
    await planningAndCode();
    await writeFile(join(contextDir, "workspace-order.json"), "{ not json");

    expect(await ids()).toEqual(["bike", "garage-gym", "office", "courtyard", "homelab-mcp"]);
  });

  it("refuses a workspace named twice, or one that doesn't exist", async () => {
    await planningAndCode();

    expect((await arrange(["office", "office", "bike"])).status).toBe(400);
    expect((await arrange(["office", "nope"])).status).toBe(404);
    expect((await arrange("office")).status).toBe(400);
    expect(await ids()).toEqual(["bike", "garage-gym", "office", "courtyard", "homelab-mcp"]);
  });
});
