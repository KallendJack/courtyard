import { join } from "node:path";
import type {
  Activity,
  SkillName,
  SkillProblem,
  SkillSource,
  SkillSummary,
  UsableSkillSummary,
  WorkspaceMode,
} from "@courtyard/contract";
import { checkSkill, type HouseSkill, readHouseManifest, readSkillFile } from "@courtyard/skills";
import { z } from "zod";
import { listEntries } from "../files.ts";
import type { MattSkills } from "../matt-skills/index.ts";
import { err, ok, type Result } from "../result.ts";
import {
  type FileToolFound,
  type FileToolRefusal,
  workspaceFiles,
} from "../workspace-files/index.ts";

/**
 * A workspace's skills (ADR 0016), worked out in one place: five places (Matt Pocock's in a code
 * workspace, ADR 0023), the more specific winning by name, each skill's source kept beside it. A skill that fails the Agent Skills format
 * check, or has scripts in a planning workspace, can't be used, and says why.
 */

/** Where the owner's skills sit in a folder: the context folder's top, a workspace's, a repo's. */
export const SKILLS_FOLDER = join(".agents", "skills");

/** A skill a workspace's models can use: what the app shows of it, and its folder. */
export type UsableSkill = UsableSkillSummary & { readonly folder: string };

/** A workspace's skills: the ones it can use, one per name, and the ones it can't. */
export type WorkspaceSkills = {
  readonly usable: readonly UsableSkill[];
  readonly unusable: readonly SkillSummary[];
};

/** A workspace as `getWorkspace` reads it, as far as finding its skills needs it. */
export type SkillsWorkspace = {
  readonly folder: string;
  readonly summary: { readonly mode: WorkspaceMode };
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

/** Where Matt's skills come from, as a broken skill names them when the copy can't be loaded. */
const MATT_PLUGIN = "mattpocock-skills";

/**
 * Matt Pocock's skills, for a code workspace (ADR 0023): each in Courtyard's pinned copy, checked
 * as Claude Code loads it, with the ones the picker lists; or why the copy can't be loaded.
 */
const mattSkills = async (matt: MattSkills) => {
  const copy = await matt.copy();
  if (!copy.ok) {
    const problem: SkillSummary = {
      kind: "unusable",
      name: MATT_PLUGIN,
      description: "",
      source: "matt",
      ownerOnly: false,
      problem: { kind: "broken", reason: copy.error },
    };
    return { found: [], picker: new Set<string>(), problem };
  }
  const found = await Promise.all(
    copy.value.skills.map(
      async ({ name, folder }): Promise<Found> => ({
        folderName: name,
        folder,
        source: "matt",
        checked: await checkSkill(folder, { claudeCode: true }),
      }),
    ),
  );
  return { found, picker: new Set<string>(copy.value.picker), problem: undefined };
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
 * A workspace's skills, from the places in order (ADR 0016): the workspace's own `.agents/skills`
 * in the context folder, a code workspace's repo's, the context folder's top-level one, a code
 * workspace's Matt Pocock skills (ADR 0023; when his copy can't be loaded, one broken entry says
 * why), then the house skills for its kind of workspace. The first usable skill of each name wins.
 * Matt's own `disable-model-invocation` makes one owner-only.
 * A broken skill, or one with scripts in a planning workspace, replaces nothing, and is listed
 * after the rest with why. "Only the owner starts it" goes with a house skill's name, so a skill of
 * the owner's that replaces it is owner-only too.
 */
export const workspaceSkills = async (options: {
  contextDir: string;
  houseFolder: string;
  workspace: SkillsWorkspace;
  /** Matt Pocock's skills, which a code workspace gets (ADR 0023); none when they're off. */
  matt: MattSkills | undefined;
}): Promise<WorkspaceSkills> => {
  const { folder, repoPath, summary } = options.workspace;
  const { mode } = summary;
  const house = await houseSkills(options.houseFolder, mode);
  const [matt, ...places] = await Promise.all([
    mode === "code" && options.matt !== undefined
      ? mattSkills(options.matt)
      : { found: [], picker: new Set<string>(), problem: undefined },
    foundIn(join(folder, SKILLS_FOLDER), "workspace"),
    mode === "code" && repoPath !== null
      ? foundIn(join(repoPath, SKILLS_FOLDER), "project")
      : Promise.resolve([]),
    foundIn(join(options.contextDir, SKILLS_FOLDER), "everywhere"),
  ]);
  const houseNames = new Set(house.found.map((found) => found.folderName));

  const usable = new Map<string, UsableSkill>();
  const unusable: SkillSummary[] = matt.problem === undefined ? [] : [matt.problem];
  for (const found of [...places.flat(), ...matt.found, ...house.found]) {
    const { checked, folderName, source } = found;
    const ownerOnly = house.ownerOnly.has(folderName) || (checked.ok && checked.value.ownerStarts);
    const cantUse = (problem: SkillProblem, description: string) =>
      unusable.push({
        kind: "unusable",
        name: folderName,
        description,
        source,
        ownerOnly,
        problem,
      });
    if (!checked.ok) {
      cantUse({ kind: "broken", reason: checked.error }, "");
      continue;
    }
    const { name, description, hasScripts } = checked.value;
    if (hasScripts && mode === "planning") {
      cantUse({ kind: "needs-code-workspace" }, description);
      continue;
    }
    if (usable.has(name)) continue;
    usable.set(name, {
      kind: "usable",
      name,
      description,
      source,
      ownerOnly,
      replacesHouse: source !== "house" && houseNames.has(name),
      inPicker: source !== "matt" || matt.picker.has(name),
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
  /** The skills in use in the session when the turn started. */
  readonly inUse: readonly SkillName[];
  readonly report: (activity: Activity) => Promise<void>;
}) => {
  /** The skills in use so far, with those a model has loaded in this turn. */
  const inUseNow = new Set(options.inUse);
  return async (input: unknown): Promise<UseSkillAnswer> => {
    const parsed = UseSkillInput.safeParse(input);
    if (!parsed.success) return err({ kind: "malformed" });
    const skill = options.skills.find((usable) => usable.name === parsed.data.name);
    if (skill === undefined) return err({ kind: "unknown", name: parsed.data.name });
    const inUse = inUseNow.has(skill.name);
    if (skill.ownerOnly && !inUse) return err({ kind: "owner-only", name: skill.name });

    const { path, start_line } = parsed.data;
    if (path == null) {
      const text = await readSkillFile(skill.folder);
      if (!text.ok) return text;
      if (!inUse) {
        inUseNow.add(skill.name);
        await options.report({ kind: "skill-loaded", name: skill.name, source: skill.source });
      }
      return ok({ kind: "instructions", text: text.value });
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
      if (skill === undefined) return [];
      const text = await readSkillFile(skill.folder);
      return text.ok ? [{ name, text: text.value }] : [];
    }),
  );
  return texts.flat();
};

/** A workspace's skills as the app lists them: the usable ones, then the rest. */
export const skillList = (skills: WorkspaceSkills): SkillSummary[] => [
  ...skills.usable.map(({ folder: _, ...summary }) => summary),
  ...skills.unusable,
];
