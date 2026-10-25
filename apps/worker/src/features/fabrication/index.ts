import { stat } from "node:fs/promises";
import { join } from "node:path";
import {
  BuildFile,
  type BuildParameters,
  type BuildProgress,
  type BuildSave,
  BuildSlug,
  type BuildStockPick,
  type BuildSummary,
  type BuildTemplate,
  type BuildView,
  type ChangeId,
  type DocumentSlug,
} from "@courtyard/contract";
import type { Build, BuildSetting } from "@courtyard/fabrication";
import { listFolder, readTextFile, writeTextFileIn } from "../../lib/files.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import { undoWholeFiles, type WholeFilesUndoRefusal } from "../context-folder/index.ts";
import { type SupersedesRefusal, supersedesNow } from "../documents/superseded.ts";
import {
  type PlanningFilesTarget,
  type PlanningFolderRefusal,
  pathInFolder,
  planningChange,
  planningFolder,
  slugFor,
} from "../planning-files/index.ts";
import { derive, merged, parameterChanges, pickStockIn } from "./parameters.ts";
import { NOT_STARTED, type OwnerSetting, ownerSetting, progressIn, settingOf } from "./setting.ts";

/**
 * Fabrication's Builds, hosted in a planning workspace (ADRs 0036, 0037; #697): a JSON file each in
 * its `builds` folder, holding the Build's name, template and parameters. Everything else is
 * derived on read by `packages/fabrication`, never stored. Every write is one change through the
 * context folder, so its note and Recent changes offer Undo. A code workspace keeps none.
 */

/** The folder in a workspace's folder that holds its Builds. */
export const BUILDS_FOLDER = "builds";

/** A Build's path in its workspace's folder. */
export const buildPath = (slug: BuildSlug) => `${BUILDS_FOLDER}/${slug}.json`;

const fileOf = (folder: string, slug: BuildSlug) => join(folder, BUILDS_FOLDER, `${slug}.json`);

/** A Build's file as written: its fields in order, two spaces in, a line ending at the end. */
const buildText = (file: BuildFile) => `${JSON.stringify(file, null, 2)}\n`;

/**
 * A Build's file read and worked out, or what's wrong with it: with the owner's tools and the ways
 * its steps were done, when given (#777).
 */
export const readBuildText = (
  text: string,
  setting?: BuildSetting,
): Result<{ file: BuildFile; derived: Build }, string> => {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return err("It isn't JSON.");
  }
  const file = BuildFile.safeParse(json);
  if (!file.success) {
    const [issue] = file.error.issues;
    return err(`It isn't a Build: ${issue?.path.join(".") || "its file"}: ${issue?.message ?? ""}`);
  }
  const derived = derive(file.data.template, file.data.parameters, setting);
  if (!derived.ok) return err(`Its parameters can't be worked out: ${derived.error.join("; ")}`);
  return ok({ file: file.data, derived: derived.value });
};

/**
 * A Build's progress file (#699), beside it rather than in it, so ticking a line never stands in
 * the way of undoing a change to the Build (`progress.ts` keeps it).
 */
export const progressPath = (slug: BuildSlug) => `${BUILDS_FOLDER}/progress/${slug}.json`;

/**
 * A Build as read: its summary, its file, what's derived from it, its file's text, and how far the
 * owner has got with its steps.
 */
export type ReadBuild = {
  readonly summary: BuildSummary;
  readonly file: BuildFile;
  readonly derived: Build;
  readonly text: string;
  readonly progress: BuildProgress;
};

/** A workspace's Builds as read, and the files that aren't Builds as written. */
export type ReadBuilds = {
  readonly builds: readonly ReadBuild[];
  readonly problems: readonly { readonly path: string; readonly problem: string }[];
};

/** A Build with everything derived, as the Fabrication API answers it. */
export const viewOf = ({ summary, file, derived }: ReadBuild): BuildView => ({
  ...summary,
  parameters: file.parameters,
  derived,
});

/** Why a Build wasn't read or saved. */
export type BuildRefusal =
  | PlanningFolderRefusal
  /** Its name doesn't fit. */
  | { readonly kind: "invalid"; readonly problem: string }
  /** Its parameters can't be worked out: each problem, where in them. */
  | { readonly kind: "parameters"; readonly problems: readonly string[] }
  /** A new Build needs a name, a template and its parameters. */
  | { readonly kind: "incomplete" }
  /** Another Build already has its file name. */
  | { readonly kind: "clash"; readonly name: string; readonly slug: BuildSlug }
  | { readonly kind: "not-found"; readonly slug: BuildSlug }
  /** Its file isn't a Build as written (a hand edit, say), so it can't be changed here. */
  | { readonly kind: "unreadable"; readonly path: string; readonly problem: string }
  /** It would change nothing. */
  | { readonly kind: "unchanged"; readonly name: string }
  /** It has changed since the model was shown it. */
  | { readonly kind: "stale" }
  /** A document it's to supersede isn't there (#786). */
  | SupersedesRefusal;

/** The Builds in a planning folder, worked out with the owner's tools and things (#763). */
const readBuildsIn = async (
  folder: string,
  owner: OwnerSetting,
): Promise<Result<ReadBuilds, BuildRefusal>> => {
  const names = await listFolder(join(folder, BUILDS_FOLDER));
  if (!names.ok) return err({ kind: "storage" });
  const builds: ReadBuild[] = [];
  const problems: { path: string; problem: string }[] = [];
  for (const name of names.value.sort()) {
    if (!name.endsWith(".json")) continue;
    const path = `${BUILDS_FOLDER}/${name}`;
    const slug = BuildSlug.safeParse(name.replace(/\.json$/, ""));
    if (!slug.success) {
      problems.push({ path, problem: "Its file name isn't lowercase letters, digits and dashes." });
      continue;
    }
    const text = await readTextFile(fileOf(folder, slug.data));
    if (!text.ok) return err({ kind: "storage" });
    const build = text.value;
    if (build === undefined) continue;
    const kept = await readTextFile(join(folder, progressPath(slug.data)));
    if (!kept.ok) return err({ kind: "storage" });
    const progress = progressIn(kept.value, () => readBuildText(build));
    const read = readBuildText(build, settingOf(owner, progress));
    if (!read.ok) {
      problems.push({ path, problem: read.error });
      continue;
    }
    let updatedAt: string;
    try {
      updatedAt = (await stat(fileOf(folder, slug.data))).mtime.toISOString();
    } catch {
      return err({ kind: "storage" });
    }
    const { file, derived } = read.value;
    builds.push({
      summary: { slug: slug.data, name: file.name, template: file.template, path, updatedAt },
      file,
      derived,
      text: build,
      progress,
    });
  }
  builds.sort((a, b) => a.file.name.localeCompare(b.file.name, "en-GB", { sensitivity: "base" }));
  return ok({ builds, problems });
};

/** A planning workspace's Builds, by name, and the files that aren't Builds. */
export const readBuilds = async (
  target: Pick<PlanningFilesTarget, "contextDir" | "workspaceId">,
): Promise<Result<ReadBuilds, BuildRefusal>> => {
  const folder = await planningFolder(target);
  return folder.ok ? readBuildsIn(folder.value, await ownerSetting(target.contextDir)) : folder;
};

/** One of a planning workspace's Builds, or why it can't be read. */
export const readBuild = async (
  target: Pick<PlanningFilesTarget, "contextDir" | "workspaceId">,
  slug: BuildSlug,
): Promise<Result<ReadBuild, BuildRefusal>> => {
  const read = await readBuilds(target);
  if (!read.ok) return read;
  const found = read.value.builds.find(({ summary }) => summary.slug === slug);
  if (found !== undefined) return ok(found);
  const problem = read.value.problems.find(({ path }) => path === buildPath(slug));
  return problem === undefined
    ? err({ kind: "not-found", slug })
    : err({ kind: "unreadable", ...problem });
};

/**
 * A change to one Build: a new one (its name, template and every parameter), or one that's there,
 * by its file's name, with a new name, its parameters changed by a merge patch, or one of its
 * stocks swapped for an option (#704).
 */
export type BuildEdit = (
  | {
      readonly slug?: undefined;
      readonly name?: string;
      readonly template?: BuildTemplate;
      readonly parameters?: BuildParameters;
    }
  | {
      readonly slug: BuildSlug;
      readonly name?: string;
      readonly parameters?: BuildParameters;
      readonly pick?: BuildStockPick;
    }
) & {
  /** The documents it supersedes now (#786), in place of those it did; empty for none. */
  readonly supersedes?: readonly DocumentSlug[];
};

/** A saved Build, the change it was committed as (if git kept it), and it as read now. */
export type BuildSaved = {
  readonly save: BuildSave;
  readonly change: ChangeId | undefined;
  readonly build: ReadBuild;
};

/**
 * Starts or changes one Build, as one change, once its parameters are worked out. `check` is given
 * the Build as it is now, and refuses the change by returning a refusal (one the model hasn't
 * seen as it is, say).
 */
export const saveBuild = async (
  target: PlanningFilesTarget,
  edit: BuildEdit,
  options: { now: number; check?: (now: ReadBuild) => BuildRefusal | undefined },
): Promise<Result<BuildSaved, BuildRefusal>> => {
  let title = "";
  let path = "";
  const saved = await target.contextFolder.changeWithId(
    async (): Promise<Result<Omit<BuildSaved, "change">, BuildRefusal>> => {
      const folder = await planningFolder(target);
      if (!folder.ok) return folder;
      const owner = await ownerSetting(target.contextDir);
      const read = await readBuildsIn(folder.value, owner);
      if (!read.ok) return read;
      const { builds, problems } = read.value;
      const editing = edit.slug;
      const current =
        editing === undefined ? undefined : builds.find(({ summary }) => summary.slug === editing);
      if (editing !== undefined && current === undefined) {
        const problem = problems.find((one) => one.path === buildPath(editing));
        return problem === undefined
          ? err({ kind: "not-found", slug: editing })
          : err({ kind: "unreadable", ...problem });
      }
      if (current !== undefined) {
        const refused = options.check?.(current);
        if (refused !== undefined) return err(refused);
      }
      const template =
        current?.file.template ?? (edit.slug === undefined ? edit.template : undefined);
      const name = edit.name ?? current?.file.name;
      const patched =
        current === undefined
          ? edit.parameters
          : merged(current.file.parameters, edit.parameters ?? {});
      const pick = edit.slug === undefined ? undefined : edit.pick;
      const picked =
        pick === undefined || template === undefined
          ? undefined
          : pickStockIn(template, patched, pick);
      if (picked?.ok === false) return err({ kind: "invalid", problem: picked.error.join(" ") });
      const parameters = picked?.ok ? picked.value : patched;
      if (template === undefined || name === undefined || parameters === undefined) {
        return err({ kind: "incomplete" });
      }
      const superseding = await supersedesNow(target, {
        given: edit.supersedes,
        before: current?.file.supersedes ?? [],
      });
      if (!superseding.ok) return superseding;
      const { supersedes } = superseding.value;
      const file = BuildFile.safeParse({
        name,
        template,
        parameters,
        ...(supersedes.length === 0 ? {} : { supersedes }),
      });
      if (!file.success) {
        const [issue] = file.error.issues;
        return err({ kind: "invalid", problem: issue?.message ?? "" });
      }
      const progress = current?.progress ?? NOT_STARTED;
      const derived = derive(template, file.data.parameters, settingOf(owner, progress));
      if (!derived.ok) return err({ kind: "parameters", problems: derived.error });

      const slug =
        current?.summary.slug ?? slugFor(file.data.name, { slug: BuildSlug, kind: "build" });
      if (slug === undefined) {
        return err({ kind: "invalid", problem: "Its name needs a letter or a digit." });
      }
      if (current === undefined) {
        const there = builds.find(({ summary }) => summary.slug === slug);
        const unreadable = problems.some((one) => one.path === buildPath(slug));
        if (there !== undefined || unreadable) {
          return err({ kind: "clash", name: there?.file.name ?? file.data.name, slug });
        }
      }
      const text = buildText(file.data);
      // By what it holds, so a file only laid out by hand isn't rewritten for a change of nothing.
      if (current !== undefined && text === buildText(current.file)) {
        return err({ kind: "unchanged", name: file.data.name });
      }
      if (!(await writeTextFileIn(fileOf(folder.value, slug), text))) {
        return err({ kind: "storage" });
      }
      path = buildPath(slug);
      title = `${current === undefined ? "Start" : "Change"} Build: ${file.data.name}`;
      const changes =
        current === undefined
          ? []
          : [
              ...(current.file.name === file.data.name
                ? []
                : [`Renamed from ${current.file.name}`]),
              ...parameterChanges(current.file.parameters, file.data.parameters),
              ...superseding.value.changes,
            ];
      return ok({
        save: {
          action: current === undefined ? "add" : "change",
          build: { slug, name: file.data.name },
          changes,
        },
        build: {
          summary: {
            slug,
            name: file.data.name,
            template,
            path,
            updatedAt: new Date(options.now).toISOString(),
          },
          file: file.data,
          derived: derived.value,
          text,
          progress,
        },
      });
    },
    () => planningChange(target, { kind: "build", title, paths: [path] }),
  );
  return saved.ok ? ok({ ...saved.value.value, change: saved.value.id }) : saved;
};

/**
 * Undoes a change to a Build (started or changed), as a change of its own: its file goes back as
 * it was, unless it's changed since.
 */
export const undoBuildChange = (
  target: Pick<PlanningFilesTarget, "contextDir" | "contextFolder" | "sessionId">,
  id: ChangeId,
) => undoWholeFiles(target, { id, kinds: ["build"] });

/**
 * Undoes a change to one Build, from Fabrication (#704): refused as not found when the change
 * isn't to that Build's file.
 */
export const undoChangeToBuild = async (
  target: Pick<PlanningFilesTarget, "contextDir" | "contextFolder" | "workspaceId">,
  undo: { readonly slug: BuildSlug; readonly id: ChangeId },
): Promise<Result<null, WholeFilesUndoRefusal>> => {
  const found = await target.contextFolder.changeOf(undo.id);
  if (!found.ok) return err({ kind: "storage" });
  const path = pathInFolder(target.workspaceId, buildPath(undo.slug));
  if (found.value === undefined || !found.value.files.includes(path)) {
    return err({ kind: "not-found" });
  }
  return undoBuildChange(target, undo.id);
};
