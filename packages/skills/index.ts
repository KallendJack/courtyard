import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { SkillName, WorkspaceMode } from "@courtyard/contract";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * Courtyard's house skills (ADR 0016): a folder per skill in the open Agent Skills format, and
 * `skills.json` saying which kinds of workspace get each one and whether only the owner starts it.
 * Also the format check every skill passes before a model gets it, house or the owner's, which
 * `pnpm verify` runs on the house skills and the worker runs on everyone's.
 */

/** Where the house skills are: this package's folder. */
export const HOUSE_SKILLS_FOLDER = import.meta.dirname;

const MANIFEST = "skills.json";
const SKILL_FILE = "SKILL.md";
/** Folders in a skill's folder whose code waits for a shell (phase 4). */
const SCRIPTS = "scripts";

/** What a module interface returns instead of throwing (the worker's `Result`, structurally). */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** `skills.json`: each house skill, the kinds of workspace that get it, and who starts it. */
export const HouseManifest = z.strictObject({
  skills: z.array(
    z.strictObject({
      name: SkillName,
      workspaces: z.array(WorkspaceMode).min(1),
      /** Only the owner starts it, from a button or the skill picker; a model never loads it. */
      start: z.literal("owner").optional(),
    }),
  ),
});
export type HouseManifest = z.infer<typeof HouseManifest>;
export type HouseSkill = HouseManifest["skills"][number];

/**
 * `matt.json`: the version of Matt Pocock's skills Courtyard pins for code workspaces (ADR 0024),
 * where they come from, the checksum of the copy kept (`mattChecksum` in the worker), and the
 * ones the Skill picker lists, since the owner starts them.
 */
export const MattPin = z.strictObject({
  /** His own plugin list (marketplace): a git repository whose tag `v<version>` is the release. */
  source: z.url(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  checksum: z.string().regex(/^sha256-[0-9a-f]{64}$/),
  picker: z.array(SkillName),
});
export type MattPin = z.infer<typeof MattPin>;

const MATT_PIN = "matt.json";

/** Reads `matt.json` from the house skills' folder, or says why it can't be used. */
export const readMattPin = async (
  folder: string = HOUSE_SKILLS_FOLDER,
): Promise<Result<MattPin, string>> => {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(join(folder, MATT_PIN), "utf8"));
  } catch {
    return err(`${MATT_PIN} can't be read as JSON`);
  }
  const parsed = MattPin.safeParse(json);
  return parsed.success ? ok(parsed.data) : err(`${MATT_PIN} doesn't fit its shape`);
};

/** A skill that passed the format check: its name, what it's for, and whether it has scripts. */
export type CheckedSkill = {
  readonly name: SkillName;
  readonly description: string;
  readonly hasScripts: boolean;
  /** Claude Code never loads it by itself (`disable-model-invocation`), so only the owner starts it. */
  readonly ownerStarts: boolean;
};

/**
 * Claude Code's own SKILL.md fields that a skill Claude Code loads itself may carry (Matt's, ADR
 * 0024): only the owner starting it, the hint for its arguments, and whether the `/` menu lists
 * it. Anything else Claude-only (its own hooks, a model, a sub-agent) still fails the check.
 */
const CLAUDE_CODE_FIELDS = ["disable-model-invocation", "argument-hint", "user-invocable"];

const hasCode = (error: unknown, code: string) =>
  error instanceof Error && "code" in error && error.code === code;

const isFolder = async (path: string) => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

/** The fields the Agent Skills format has; any other fails the check, as the reference's does. */
const FIELDS = ["name", "description", "license", "compatibility", "metadata", "allowed-tools"];
const MAX_DESCRIPTION = 1024;
const MAX_COMPATIBILITY = 500;

/** The frontmatter's fields once checked: the format's own, and none of Claude's or Codex's. */
const Frontmatter = z.strictObject({
  name: z.string(),
  description: z.string().min(1).max(MAX_DESCRIPTION),
  license: z.unknown().optional(),
  compatibility: z.string().max(MAX_COMPATIBILITY).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  "allowed-tools": z.unknown().optional(),
});

/** The text between a SKILL.md's opening and closing `---` lines, or why there's none. */
const frontmatterOf = (text: string): Result<string, string> => {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return err("its SKILL.md doesn't start with a --- line");
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) return err("its SKILL.md's --- lines aren't closed");
  return ok(lines.slice(1, end).join("\n"));
};

/** Checks a skill's fields as the reference validator (skills-ref) does, in the owner's words. */
const checkFields = (
  given: Record<string, unknown>,
  folderName: string,
  claudeCode: boolean,
): Result<z.infer<typeof Frontmatter> & { name: SkillName }, string> => {
  const fields = claudeCode
    ? Object.fromEntries(
        Object.entries(given).filter(([field]) => !CLAUDE_CODE_FIELDS.includes(field)),
      )
    : given;
  const unknown = Object.keys(fields).filter((field) => !FIELDS.includes(field));
  if (unknown.length > 0) {
    return err(`its SKILL.md has a field the Agent Skills format doesn't: ${unknown.join(", ")}`);
  }
  const rawName = fields.name;
  if (typeof rawName !== "string" || rawName.trim() === "") return err("its SKILL.md has no name");
  const name = SkillName.safeParse(rawName.normalize("NFKC").trim());
  if (!name.success) {
    return err(
      "its name has to be lowercase letters, digits and single hyphens, up to 64 characters",
    );
  }
  if (name.data !== folderName.normalize("NFKC")) {
    return err(`its name, "${name.data}", isn't its folder's name`);
  }
  const { description, compatibility } = fields;
  if (typeof description !== "string" || description.trim() === "") {
    return err("its SKILL.md has no description");
  }
  if (description.length > MAX_DESCRIPTION) {
    return err(`its description is over ${MAX_DESCRIPTION.toLocaleString("en-GB")} characters`);
  }
  if (compatibility !== undefined && typeof compatibility !== "string") {
    return err("its compatibility isn't text");
  }
  if (typeof compatibility === "string" && compatibility.length > MAX_COMPATIBILITY) {
    return err(`its compatibility is over ${MAX_COMPATIBILITY} characters`);
  }
  const parsed = Frontmatter.safeParse(fields);
  if (!parsed.success) return err("its SKILL.md's fields don't fit the Agent Skills format");
  return ok({ ...parsed.data, name: name.data });
};

/**
 * Checks one skill's folder against the Agent Skills format (https://agentskills.io/specification),
 * following the rules of its reference validator, skills-ref (agentskills/agentskills, read
 * 2026-10-09): a `SKILL.md` whose frontmatter has a name matching the folder's, a description, and
 * no field the format hasn't got. A skill that fails says why, in words for the owner, without a
 * full stop ("its SKILL.md has no description"). A skill Claude Code loads itself (`claudeCode`)
 * may also carry Claude Code's fields for who starts it (`CLAUDE_CODE_FIELDS`).
 */
export const checkSkill = async (
  folder: string,
  options: { readonly claudeCode?: boolean } = {},
): Promise<Result<CheckedSkill, string>> => {
  const claudeCode = options.claudeCode === true;
  let text: string;
  try {
    text = await readFile(join(folder, SKILL_FILE), "utf8");
  } catch (error) {
    return err(
      hasCode(error, "ENOENT") || hasCode(error, "ENOTDIR")
        ? "it has no SKILL.md"
        : "its SKILL.md can't be read",
    );
  }
  const frontmatter = frontmatterOf(text);
  if (!frontmatter.ok) return frontmatter;
  let fields: unknown;
  try {
    fields = parseYaml(frontmatter.value);
  } catch {
    return err("its SKILL.md's fields aren't valid YAML");
  }
  const mapping = z.record(z.string(), z.unknown()).safeParse(fields);
  if (!mapping.success || Array.isArray(fields)) {
    return err("its SKILL.md's fields aren't a list of names and values");
  }
  const checked = checkFields(mapping.data, folder.split(/[\\/]/).at(-1) ?? "", claudeCode);
  if (!checked.ok) return checked;
  return ok({
    name: checked.value.name,
    description: checked.value.description,
    hasScripts: await isFolder(join(folder, SCRIPTS)),
    ownerStarts: claudeCode && mapping.data["disable-model-invocation"] === true,
  });
};

/** A skill's whole `SKILL.md`, as a model is given it, or that it can't be read. */
export const readSkillFile = async (
  folder: string,
): Promise<Result<string, { readonly kind: "unreadable" }>> => {
  try {
    return ok(await readFile(join(folder, SKILL_FILE), "utf8"));
  } catch {
    return err({ kind: "unreadable" });
  }
};

/** Reads `skills.json` from the house skills' folder, or says why it can't be used. */
export const readHouseManifest = async (
  folder: string = HOUSE_SKILLS_FOLDER,
): Promise<Result<HouseManifest, string>> => {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(join(folder, MANIFEST), "utf8"));
  } catch {
    return err(`${MANIFEST} can't be read as JSON`);
  }
  const parsed = HouseManifest.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    return err(`${MANIFEST} doesn't fit its shape: ${issues.join("; ")}`);
  }
  return ok(parsed.data);
};

/** The skill folders in the house skills' folder: every folder but the package's own. */
const skillFolders = async (folder: string) => {
  const entries = await readdir(folder, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
};

/**
 * Every problem with the house skills in `folder`, one sentence each, or none: a skill folder not
 * in `skills.json`, an entry with no folder, a skill that fails the format check, or a skill with
 * scripts listed for planning workspaces, which have no shell.
 */
export const checkHouseSkills = async (folder: string): Promise<string[]> => {
  const manifest = await readHouseManifest(folder);
  if (!manifest.ok) return [`${manifest.error}.`];
  const listed = manifest.value.skills;
  const folders = await skillFolders(folder);
  const problems: string[] = [];
  for (const name of folders) {
    if (!listed.some((skill) => skill.name === name))
      problems.push(`${name} isn't in ${MANIFEST}.`);
  }
  for (const skill of listed) {
    if (!folders.includes(skill.name)) {
      problems.push(`${MANIFEST} lists ${skill.name}, which has no folder.`);
      continue;
    }
    const checked = await checkSkill(join(folder, skill.name));
    if (!checked.ok) problems.push(`${skill.name}: ${checked.error}.`);
    else if (checked.value.hasScripts && skill.workspaces.includes("planning")) {
      problems.push(`${skill.name} has scripts, so it can only be listed for code workspaces.`);
    }
  }
  return problems;
};
