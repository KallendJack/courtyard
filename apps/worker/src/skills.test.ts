import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillList, type SkillSummary } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asOwner,
  postJson,
  type Requester,
  testWorker,
  writeHouseSkills,
  writeSkill,
} from "./testing.ts";

// A workspace's skills (ADR 0016): four places, the more specific winning by name, a broken skill
// shown with its reason, and a skill with scripts kept for code workspaces.

let root: string;
const contextDir = () => join(root, "context");
const houseDir = () => join(root, "house");
const repoDir = () => join(root, "repo");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  await mkdir(join(contextDir(), "garage-gym"), { recursive: true });
  await writeHouseSkills(houseDir(), [
    { name: "grilling", workspaces: ["planning", "code"] },
    { name: "get-to-know", workspaces: ["planning"], start: "owner" },
    { name: "code-review", workspaces: ["code"] },
  ]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const skill = writeSkill;

const workspaceSkills = () => join(contextDir(), "garage-gym", ".agents", "skills");
const everywhereSkills = () => join(contextDir(), ".agents", "skills");
const projectSkills = () => join(repoDir(), ".agents", "skills");

const asCode = () =>
  writeFile(
    join(contextDir(), "garage-gym", "workspace.json"),
    JSON.stringify({ mode: "code", repoPath: repoDir() }),
  );

const owner = () => asOwner(testWorker({ root, houseSkills: houseDir() }));

const skillsOf = async (request: Requester, workspace = "garage-gym") => {
  const response = await request(`/api/workspaces/${workspace}/skills`);
  expect(response.status).toBe(200);
  return SkillList.parse(await response.json()).skills;
};

const usable = (skills: readonly SkillSummary[]) =>
  skills.filter((s) => s.kind === "usable").map((s) => [s.name, s.source]);

describe("a workspace's skills", () => {
  it("are the house skills for its kind of workspace, until the owner adds their own", async () => {
    const skills = await skillsOf(await owner());

    expect(skills).toEqual([
      {
        kind: "usable",
        name: "get-to-know",
        description: "What get-to-know does.",
        source: "house",
        ownerOnly: true,
        replacesHouse: false,
      },
      {
        kind: "usable",
        name: "grilling",
        description: "What grilling does.",
        source: "house",
        ownerOnly: false,
        replacesHouse: false,
      },
    ]);
  });

  it("come from four places, the more specific winning by name", async () => {
    await asCode();
    await skill(workspaceSkills(), "grilling", { description: "My own grilling." });
    await skill(projectSkills(), "programme-check", { description: "The project's." });
    await skill(projectSkills(), "release-notes");
    await skill(everywhereSkills(), "programme-check", { description: "Mine, everywhere." });
    await skill(everywhereSkills(), "shopping-list");
    await skill(everywhereSkills(), "code-review", { description: "My code review." });

    const skills = await skillsOf(await owner());

    expect(usable(skills)).toEqual([
      ["code-review", "everywhere"],
      ["grilling", "workspace"],
      ["programme-check", "project"],
      ["release-notes", "project"],
      ["shopping-list", "everywhere"],
    ]);
    const byName = new Map(skills.map((s) => [s.name, s]));
    expect(byName.get("grilling")).toMatchObject({
      description: "My own grilling.",
      replacesHouse: true,
    });
    expect(byName.get("programme-check")?.description).toBe("The project's.");
    expect(byName.get("code-review")).toMatchObject({ replacesHouse: true });
  });

  it("keep a house skill only the owner starts that way, even when the owner's replaces it", async () => {
    await skill(workspaceSkills(), "get-to-know", { description: "My own get to know." });

    const skills = await skillsOf(await owner());

    expect(skills.find((s) => s.name === "get-to-know")).toMatchObject({
      source: "workspace",
      ownerOnly: true,
      replacesHouse: true,
    });
  });

  it("skip a broken skill, showing why, without it replacing a house skill", async () => {
    await skill(workspaceSkills(), "warm-up", { description: "" });
    await skill(everywhereSkills(), "grilling", { description: "" });
    await mkdir(join(workspaceSkills(), "Notes"));

    const skills = await skillsOf(await owner());

    expect(usable(skills)).toEqual([
      ["get-to-know", "house"],
      ["grilling", "house"],
    ]);
    // Can't-be-used ones come after the rest.
    expect(skills.slice(2)).toEqual([
      {
        kind: "unusable",
        name: "grilling",
        description: "",
        source: "everywhere",
        ownerOnly: false,
        problem: { kind: "broken", reason: "its SKILL.md has no description" },
      },
      {
        kind: "unusable",
        name: "Notes",
        description: "",
        source: "workspace",
        ownerOnly: false,
        problem: { kind: "broken", reason: "it has no SKILL.md" },
      },
      {
        kind: "unusable",
        name: "warm-up",
        description: "",
        source: "workspace",
        ownerOnly: false,
        problem: { kind: "broken", reason: "its SKILL.md has no description" },
      },
    ]);
  });

  it("keep a skill with scripts out of a planning workspace, and offer it in a code one", async () => {
    await skill(everywhereSkills(), "ride-log-chart", { scripts: true });

    const request = await owner();
    const planning = await skillsOf(request);
    expect(planning.find((s) => s.name === "ride-log-chart")).toMatchObject({
      kind: "unusable",
      problem: { kind: "needs-code-workspace" },
    });

    await asCode();
    const code = await skillsOf(request);
    expect(code.find((s) => s.name === "ride-log-chart")?.kind).toBe("usable");
  });

  it("are only the house's and the owner's when a code workspace's repo isn't there", async () => {
    await writeFile(
      join(contextDir(), "garage-gym", "workspace.json"),
      JSON.stringify({ mode: "code", repoPath: "/path/to/repo" }),
    );

    expect(usable(await skillsOf(await owner()))).toEqual([
      ["code-review", "house"],
      ["grilling", "house"],
    ]);
  });

  it("are gone after a fresh start, apart from the house's", async () => {
    await skill(workspaceSkills(), "warm-up");
    await skill(everywhereSkills(), "shopping-list");
    const request = await owner();

    expect((await postJson(request, "/api/fresh-start", { confirm: "start fresh" })).status).toBe(
      204,
    );
    await mkdir(join(contextDir(), "garage-gym"));

    expect(usable(await skillsOf(request))).toEqual([
      ["get-to-know", "house"],
      ["grilling", "house"],
    ]);
  });

  it("can't be listed for a workspace that isn't there", async () => {
    const response = await (await owner())("/api/workspaces/attic/skills");

    expect(response.status).toBe(404);
  });
});
