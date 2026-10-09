import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkHouseSkills, HOUSE_SKILLS_FOLDER } from "./index.ts";

// `pnpm verify` runs this: the house skills and their list, checked against the Agent Skills
// format (ADR 0016). Each mistake is shown on a copy of the package.

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

  it("a skill folder that isn't in skills.json", async () => {
    await skill("packing", "---\nname: packing\ndescription: Packs a bag.\n---\nPack it.\n");

    expect(await checkHouseSkills(copy)).toEqual(["packing isn't in skills.json."]);
  });

  it("an entry in skills.json with no folder", async () => {
    await manifest([GRILLING, { name: "packing", workspaces: ["planning"] }]);

    expect(await checkHouseSkills(copy)).toEqual([
      "skills.json lists packing, which has no folder.",
    ]);
  });

  it("a skill that fails the format check", async () => {
    await manifest([GRILLING, { name: "packing", workspaces: ["planning"] }]);
    await skill("packing", "---\nname: packing\n---\nPack it.\n");

    expect(await checkHouseSkills(copy)).toEqual(["packing: its SKILL.md has no description."]);
  });

  it("a skill with scripts listed for planning workspaces", async () => {
    await manifest([GRILLING, { name: "packing", workspaces: ["planning", "code"] }]);
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

describe("the Agent Skills format check", () => {
  let copy: string;

  beforeEach(async () => {
    copy = await mkdtemp(join(tmpdir(), "courtyard-skills-"));
    await writeFile(
      join(copy, "skills.json"),
      JSON.stringify({ skills: [{ name: "packing", workspaces: ["planning"] }] }),
    );
    await mkdir(join(copy, "packing"));
  });

  afterEach(async () => {
    await rm(copy, { recursive: true, force: true, maxRetries: 5 });
  });

  /** What the check says of a packing skill whose SKILL.md is `skillMd`. */
  const problemsWith = async (skillMd: string | undefined) => {
    if (skillMd !== undefined) await writeFile(join(copy, "packing", "SKILL.md"), skillMd);
    return checkHouseSkills(copy);
  };

  it.each([
    [undefined, "packing: it has no SKILL.md."],
    ["Pack it.\n", "packing: its SKILL.md doesn't start with a --- line."],
    [
      "---\nname: packing\ndescription: Packs.\n",
      "packing: its SKILL.md's --- lines aren't closed.",
    ],
    ["---\nname: [packing\n---\n", "packing: its SKILL.md's fields aren't valid YAML."],
    ["---\n- packing\n---\n", "packing: its SKILL.md's fields aren't a list of names and values."],
    ["---\ndescription: Packs.\n---\n", "packing: its SKILL.md has no name."],
    [
      "---\nname: Packing\ndescription: Packs.\n---\n",
      "packing: its name has to be lowercase letters, digits and single hyphens, up to 64 characters.",
    ],
    [
      "---\nname: packer\ndescription: Packs.\n---\n",
      "packing: its name, \"packer\", isn't its folder's name.",
    ],
    ["---\nname: packing\ndescription: ''\n---\n", "packing: its SKILL.md has no description."],
    [
      `---\nname: packing\ndescription: ${"x".repeat(1025)}\n---\n`,
      "packing: its description is over 1,024 characters.",
    ],
    [
      `---\nname: packing\ndescription: Packs.\ncompatibility: ${"x".repeat(501)}\n---\n`,
      "packing: its compatibility is over 500 characters.",
    ],
    [
      "---\nname: packing\ndescription: Packs.\ndisable-model-invocation: true\n---\n",
      "packing: its SKILL.md has a field the Agent Skills format doesn't: disable-model-invocation.",
    ],
  ])("%j", async (skillMd, problem) => {
    expect(await problemsWith(skillMd)).toEqual([problem]);
  });

  it("takes every field the format has", async () => {
    const skillMd = [
      "---",
      "name: packing",
      "description: Packs a bag for a trip.",
      "license: MIT",
      "compatibility: Any model.",
      "metadata:",
      "  author: courtyard.example",
      "allowed-tools: Read",
      "---",
      "Pack it.",
      "",
    ].join("\n");

    expect(await problemsWith(skillMd)).toEqual([]);
  });
});
