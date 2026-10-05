import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, WorkspaceDetail, WorkspaceList } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asOwner } from "./testing.ts";
import { createWorker } from "./worker.ts";

let root: string;
let contextDir: string;
let request: (path: string) => Response | Promise<Response>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(contextDir);
  const worker = createWorker({
    env: { COURTYARD_CONTEXT_DIR: contextDir, COURTYARD_DATA_DIR: join(root, "data") },
  });
  if (!worker.ok) throw new Error(worker.error);
  request = await asOwner(worker.value.app);
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
    });
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
      expect(ApiError.parse(await response.json()).error).toContain("office");
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
