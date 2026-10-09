import { join } from "node:path";
import type {
  Activity,
  SkillName,
  SkillProblem,
  SkillSource,
  SkillSummary,
  WorkspaceMode,
} from "@courtyard/contract";
import { checkSkill, type HouseSkill, readHouseManifest, readSkillFile } from "@courtyard/skills";
import { z } from "zod";
import { listEntries } from "../files.ts";
import { err, ok, type Result } from "../result.ts";
import {
  type FileToolFound,
  type FileToolRefusal,
  workspaceFiles,
} from "../workspace-files/index.ts";

/**
 * A workspace's skills (ADR 0016), worked out in one place: four places, the more specific
 * winning by name, each skill's source kept beside it. A skill that fails the Agent Skills format
 * check, or has scripts in a planning workspace, can't be used, and says why.
 */

/** Where the owner's skills sit in a folder: the context folder's top, a workspace's, a repo's. */
export const SKILLS_FOLDER = join(".agents", "skills");

/** A skill a workspace's models can use: what the app shows of it, and its folder. */
export type UsableSkill = {
  readonly name: SkillName;
  readonly description: string;
  readonly source: SkillSource;
  readonly ownerOnly: boolean;
  readonly replacesHouse: boolean;
  readonly folder: string;
};

/** A workspace's skills: the ones it can use, one per name, and the ones it can't. */
export type WorkspaceSkills = {
  readonly usable: readonly UsableSkill[];
  readonly unusable: readonly SkillSummary[];
};

/** A workspace, as finding its skills needs it. */
export type SkillsWorkspace = {
  readonly folder: string;
  readonly mode: WorkspaceMode;
  /** A code workspace's repo, whose `.agents/skills` holds the project's skills. */
  readonly repoPath: string | null;
};

/** One skill folder found in one place, checked. */
type Found = {
  readonly folderName: string;
  readonly folder: string;
  readonly source: SkillSource;
  readonly checked: Awaited<ReturnType<typeof checkSkill>>;
};

/** The skill folders in one place, each checked; none when the place isn't there. */
const foundIn = async (skillsDir: string, source: SkillSource): Promise<Found[]> => {
  const entries = await listEntries(skillsDir);
  if (!entries.ok) return [];
  const folders = entries.value.filter(
    (entry) => (entry.kind === "folder" || entry.kind === "link") && !entry.name.startsWith("."),
  );
  return Promise.all(
    folders.map(async ({ name }) => {
      const folder = join(skillsDir, name);
      return { folderName: name, folder, source, checked: await checkSkill(folder) };
    }),
  );
};

/** The house skills this kind of workspace gets, from `skills.json`, and every owner-only name. */
const houseSkills = async (houseFolder: string, mode: WorkspaceMode) => {
  const manifest = await readHouseManifest(houseFolder);
  if (!manifest.ok) {
    // verify checks the house skills, so this is a broken install: the owner's still work.
    console.error(`The house skills can't be read: ${manifest.error}.`);
    return { found: [], ownerOnly: new Set<string>() };
  }
  const { skills } = manifest.value;
  const forMode = skills.filter((skill: HouseSkill) => skill.workspaces.includes(mode));
  const found = await Promise.all(
    forMode.map(async ({ name }): Promise<Found> => {
      const folder = join(houseFolder, name);
      return { folderName: name, folder, source: "house", checked: await checkSkill(folder) };
    }),
  );
  const ownerOnly = new Set<string>(
    skills.flatMap((skill: HouseSkill) => (skill.start === "owner" ? [skill.name] : [])),
  );
  return { found, ownerOnly };
};

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/**
 * A workspace's skills, from the four places in order (ADR 0016): the workspace's own
 * `.agents/skills` in the context folder, a code workspace's repo's, the context folder's top-level
 * one, then the house skills for its kind of workspace. The first usable skill of each name wins.
 * A broken skill, or one with scripts in a planning workspace, replaces nothing, and is listed
 * after the rest with why. "Only the owner starts it" goes with a house skill's name, so a skill of
 * the owner's that replaces it is owner-only too.
 */
export const workspaceSkills = async (options: {
  contextDir: string;
  houseFolder: string;
  workspace: SkillsWorkspace;
}): Promise<WorkspaceSkills> => {
  const { workspace } = options;
  const house = await houseSkills(options.houseFolder, workspace.mode);
  const places = await Promise.all([
    foundIn(join(workspace.folder, SKILLS_FOLDER), "workspace"),
    workspace.mode === "code" && workspace.repoPath !== null
      ? foundIn(join(workspace.repoPath, SKILLS_FOLDER), "project")
      : Promise.resolve([]),
    foundIn(join(options.contextDir, SKILLS_FOLDER), "everywhere"),
  ]);
  const houseNames = new Set(house.found.map((found) => found.folderName));

  const usable = new Map<string, UsableSkill>();
  const unusable: SkillSummary[] = [];
  for (const found of [...places.flat(), ...house.found]) {
    const problem: SkillProblem | undefined = !found.checked.ok
      ? { kind: "broken", reason: found.checked.error }
      : found.checked.value.hasScripts && workspace.mode === "planning"
        ? { kind: "needs-code-workspace" }
        : undefined;
    const ownerOnly = house.ownerOnly.has(found.folderName);
    if (problem !== undefined || !found.checked.ok) {
      unusable.push({
        name: found.folderName,
        description: found.checked.ok ? found.checked.value.description : "",
        source: found.source,
        ownerOnly,
        replacesHouse: false,
        ...(problem === undefined ? {} : { problem }),
      });
      continue;
    }
    const { name, description } = found.checked.value;
    if (usable.has(name)) continue;
    usable.set(name, {
      name,
      description,
      source: found.source,
      ownerOnly,
      replacesHouse: found.source !== "house" && houseNames.has(name),
      folder: found.folder,
    });
  }
  return { usable: [...usable.values()].sort(byName), unusable: unusable.sort(byName) };
};

/** What the use skill tool found: a skill's instructions, or one of its own files. */
export type UseSkillFound =
  | { readonly kind: "instructions"; readonly text: string }
  | { readonly kind: "file"; readonly found: FileToolFound };

/** Why the use skill tool gave nothing. */
export type UseSkillRefusal =
  | { readonly kind: "malformed" }
  | { readonly kind: "unknown"; readonly name: string }
  | { readonly kind: "owner-only"; readonly name: string }
  | { readonly kind: "unreadable" }
  | { readonly kind: "file"; readonly refusal: FileToolRefusal };

export type UseSkillAnswer = Result<UseSkillFound, UseSkillRefusal>;

/**
 * The tool's input as the prompts module describes it. Strict, so a field Courtyard doesn't know
 * about is refused rather than let through unchecked; a model may send `null` for one it leaves out.
 */
const UseSkillInput = z.strictObject({
  name: z.string(),
  path: z.string().nullish(),
  start_line: z.number().int().min(1).nullish(),
});

/**
 * The use skill tool for one turn (docs/ai-conduct.md, Skills): a usable skill's `SKILL.md`, or
 * one of its own files, read with the same check as every file read, confined to the skill's
 * folder. A skill only the owner starts is refused unless it's in use in the session. Loading a
 * skill that isn't in use yet is reported, and puts it in use; each of its files read is reported.
 */
export const skillTool = (options: {
  readonly skills: readonly UsableSkill[];
  /** The skills in use in the session so far, which the tool adds to as a model loads one. */
  readonly inUse: SkillName[];
  readonly report: (activity: Activity) => Promise<void>;
}) => {
  return async (input: unknown): Promise<UseSkillAnswer> => {
    const parsed = UseSkillInput.safeParse(input);
    if (!parsed.success) return err({ kind: "malformed" });
    const skill = options.skills.find((usable) => usable.name === parsed.data.name);
    if (skill === undefined) return err({ kind: "unknown", name: parsed.data.name });
    const inUse = options.inUse.includes(skill.name);
    if (skill.ownerOnly && !inUse) return err({ kind: "owner-only", name: skill.name });

    const { path, start_line } = parsed.data;
    if (path == null) {
      const text = await readSkillFile(skill.folder);
      if (text === undefined) return err({ kind: "unreadable" });
      if (!inUse) {
        options.inUse.push(skill.name);
        await options.report({ kind: "skill-loaded", name: skill.name, source: skill.source });
      }
      return ok({ kind: "instructions", text });
    }
    const files = workspaceFiles({
      folder: skill.folder,
      report: async (activity) => {
        if (activity.kind !== "read-file") return;
        await options.report({ kind: "skill-file-read", name: skill.name, path: activity.path });
      },
    });
    const read = await files.read({ path, ...(start_line == null ? {} : { start_line }) });
    return read.ok
      ? ok({ kind: "file", found: read.value })
      : err({ kind: "file", refusal: read.error });
  };
};

/** The text of each skill in use that the workspace can still use, in order. */
export const inUseTexts = async (
  skills: readonly UsableSkill[],
  inUse: readonly SkillName[],
): Promise<{ name: SkillName; text: string }[]> => {
  const texts = await Promise.all(
    inUse.map(async (name) => {
      const skill = skills.find((usable) => usable.name === name);
      const text = skill === undefined ? undefined : await readSkillFile(skill.folder);
      return text === undefined ? [] : [{ name, text }];
    }),
  );
  return texts.flat();
};

/** A workspace's skills as the app lists them: the usable ones, then the rest. */
export const skillList = (skills: WorkspaceSkills): SkillSummary[] => [
  ...skills.usable.map(({ folder: _, ...summary }) => summary),
  ...skills.unusable,
];
