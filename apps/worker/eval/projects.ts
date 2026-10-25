import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectSave } from "@courtyard/contract";
import { projectPath } from "../src/features/projects/index.ts";
import type { ExpectedProject } from "./scenarios.ts";
import { describeWords, hasWords } from "./words.ts";

// The context eval's project checks (#603): what a turn should start or change, judged by the
// project's file afterwards.

export const describeProject = (save: ProjectSave) =>
  `${save.action === "add" ? "started" : "changed"} project ${save.project.name}${save.changes.length === 0 ? "" : ` (${save.changes.join("; ")})`}`;

/**
 * A turn's project checks (#603): one for each project it should start or change, judged by its
 * file afterwards, and one for saving no other. Nothing when the turn doesn't say.
 */
export const judgeProjects = async (judge: {
  expected: readonly ExpectedProject[] | undefined;
  saved: readonly ProjectSave[];
  /** The workspace's folder, where the projects are. */
  folder: string;
}): Promise<{ miss: string | null }[]> => {
  const { expected, saved, folder } = judge;
  if (expected === undefined) return [];
  const left = [...saved];
  const checks: { miss: string | null }[] = [];
  for (const wanted of expected) {
    const matching = left.filter(
      (save) =>
        save.action === wanted.action && hasWords(save.project.name, { words: wanted.name }),
    );
    const save = matching.at(-1);
    if (save === undefined) {
      checks.push({
        miss: `expected to ${wanted.action === "add" ? "start" : "change"} a project with ${describeWords(wanted.name)}; ${saved.length === 0 ? "saved none" : saved.map(describeProject).join("; ")}`,
      });
      continue;
    }
    // Several saves to the same project are one change to it, judged by its file.
    for (const one of matching) left.splice(left.indexOf(one), 1);
    const path = projectPath(save.project.slug);
    const text = await readFile(join(folder, path), "utf8").catch(() => "");
    checks.push({
      miss: hasWords(text, { words: wanted.words })
        ? null
        : `expected ${path} to have ${describeWords(wanted.words)}; it reads "${text.replace(/\s+/g, " ").slice(0, 600)}"`,
    });
  }
  checks.push({
    miss: left.length === 0 ? null : `not expected: ${left.map(describeProject).join("; ")}`,
  });
  return checks;
};
