import { join } from "node:path";
import type { BuildProgress, BuildSlug } from "@courtyard/contract";
import { writeTextFileIn } from "../../lib/files.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import { type PlanningFilesTarget, pathInFolder, planningFolder } from "../planning-files/index.ts";
import { type BuildRefusal, progressPath, readBuild } from "./index.ts";

/**
 * How far the owner has got with a Build's steps (#699), kept in `builds/progress/<slug>.json` and
 * read with the Build (`index.ts`). Each write is a change in the context folder's history, so
 * it's backed up, but not one Recent changes lists: it's where the owner is, not something to undo.
 */

/** Why progress wasn't kept: as a Build's, or a step the Build doesn't have. */
export type ProgressRefusal =
  | BuildRefusal
  | { readonly kind: "no-such-step"; readonly name: string; readonly steps: number };

/** Keeps a Build's progress, once the Build has the step it names. */
export const keepProgress = async (
  target: PlanningFilesTarget,
  slug: BuildSlug,
  progress: BuildProgress,
): Promise<Result<BuildProgress, ProgressRefusal>> => {
  let name = "";
  return target.contextFolder.change(
    async (): Promise<Result<BuildProgress, ProgressRefusal>> => {
      const read = await readBuild(target, slug);
      if (!read.ok) return read;
      name = read.value.file.name;
      const steps = read.value.derived.steps.length;
      if (progress.step > steps) return err({ kind: "no-such-step", name, steps });
      const folder = await planningFolder(target);
      if (!folder.ok) return folder;
      const text = `${JSON.stringify(progress, null, 2)}\n`;
      if (!(await writeTextFileIn(join(folder.value, progressPath(slug)), text))) {
        return err({ kind: "storage" });
      }
      return ok(progress);
    },
    () => ({
      kind: "build-progress",
      title: `Progress on Build: ${name}`,
      places: [{ kind: "workspace", id: target.workspaceId }],
      files: [pathInFolder(target.workspaceId, progressPath(slug))],
    }),
  );
};
