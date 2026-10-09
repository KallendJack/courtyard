import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkHouseSkills, HOUSE_SKILLS_FOLDER, readHouseManifest } from "./index.ts";

// `pnpm verify` runs this: the house skills and their list, checked against the Agent Skills
// format (ADR 0016). Each mistake is shown on a copy of the package. The format check's own rules
// are tested through the worker's API, which runs the same check on every skill (skills.test.ts).

describe("the house skills", () => {
  it("are each in skills.json, and each passes the Agent Skills format check", async () => {
    expect(await checkHouseSkills(HOUSE_SKILLS_FOLDER)).toEqual([]);
  });
});

describe("the check catches", () => {
  let copy: string;

  beforeEach(async () => {
    copy = await mkdtemp(join(tmpdir(), "courtyard-skills-"));
    await cp(HOUSE_SKILLS_FOLDER, copy, {
      recursive: true,
      filter: (source) => !source.includes("node_modules"),
    });
  });

  afterEach(async () => {
    await rm(copy, { recursive: true, force: true, maxRetries: 5 });
  });

  const manifest = (skills: unknown) =>
    writeFile(join(copy, "skills.json"), JSON.stringify({ skills }));

  const skill = async (name: string, skillMd: string) => {
    await mkdir(join(copy, name), { recursive: true });
    await writeFile(join(copy, name, "SKILL.md"), skillMd);
  };

  const GRILLING = { name: "grilling", workspaces: ["planning", "code"] };

  /** skills.json as the house skills have it, with `more` after its own entries. */
  const manifestWith = async (...more: unknown[]) => {
    const house = await readHouseManifest();
    if (!house.ok) throw new Error(house.error);
    await manifest([...house.value.skills, ...more]);
  };

  it("a skill folder that isn't in skills.json", async () => {
    await skill("packing", "---\nname: packing\ndescription: Packs a bag.\n---\nPack it.\n");

    expect(await checkHouseSkills(copy)).toEqual(["packing isn't in skills.json."]);
  });

  it("an entry in skills.json with no folder", async () => {
    await manifestWith({ name: "packing", workspaces: ["planning"] });

    expect(await checkHouseSkills(copy)).toEqual([
      "skills.json lists packing, which has no folder.",
    ]);
  });

  it("a skill that fails the format check", async () => {
    await manifestWith({ name: "packing", workspaces: ["planning"] });
    await skill("packing", "---\nname: packing\n---\nPack it.\n");

    expect(await checkHouseSkills(copy)).toEqual(["packing: its SKILL.md has no description."]);
  });

  it("a skill with scripts listed for planning workspaces", async () => {
    await manifestWith({ name: "packing", workspaces: ["planning", "code"] });
    await skill("packing", "---\nname: packing\ndescription: Packs a bag.\n---\nPack it.\n");
    await mkdir(join(copy, "packing", "scripts"));
    await writeFile(join(copy, "packing", "scripts", "pack.sh"), "echo packed\n");

    expect(await checkHouseSkills(copy)).toEqual([
      "packing has scripts, so it can only be listed for code workspaces.",
    ]);
  });

  it("a skills.json that doesn't fit its shape", async () => {
    await manifest([{ ...GRILLING, workspaces: ["life"] }]);

    expect(await checkHouseSkills(copy)).toEqual([
      'skills.json doesn\'t fit its shape: skills.0.workspaces.0: Invalid option: expected one of "planning"|"code".',
    ]);
  });
});
