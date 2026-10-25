import type { DocumentSlug } from "@courtyard/contract";
import { err, ok, type Result } from "../../lib/result.ts";
import type { PlanningFilesTarget } from "../planning-files/index.ts";
import { documentPath, listDocuments } from "./index.ts";

// The documents a Build supersedes (#786): an old shopping list or plan for the same thing, kept
// in the Build's file by their file names (`fabrication/`), which the documents list every turn
// reads marks, so a model never takes sizes from them again.

/** Why what a Build supersedes wasn't taken: a document that isn't there, or it couldn't be read. */
export type SupersedesRefusal =
  | { readonly kind: "no-document"; readonly path: string }
  | { readonly kind: "storage" };

/**
 * What a Build supersedes once it's saved: those given, each a document there, else those it
 * did; and what changed, a line each for its note ("Supersedes: Workbench shopping list (…)").
 */
export const supersedesNow = async (
  target: Pick<PlanningFilesTarget, "contextDir" | "workspaceId">,
  change: { given: readonly DocumentSlug[] | undefined; before: readonly DocumentSlug[] },
): Promise<Result<{ supersedes: DocumentSlug[]; changes: string[] }, SupersedesRefusal>> => {
  const { given, before } = change;
  const supersedes = [...new Set(given ?? before)];
  if (given === undefined) return ok({ supersedes, changes: [] });
  const documents = await listDocuments(target);
  if (!documents.ok) return err({ kind: "storage" });
  const said = (slug: DocumentSlug) => {
    const document = documents.value.find((one) => one.slug === slug);
    return document === undefined ? documentPath(slug) : `${document.name} (${document.path})`;
  };
  const missing = supersedes.find((slug) => !documents.value.some((one) => one.slug === slug));
  if (missing !== undefined) return err({ kind: "no-document", path: documentPath(missing) });
  return ok({
    supersedes,
    changes: [
      ...supersedes
        .filter((slug) => !before.includes(slug))
        .map((slug) => `Supersedes: ${said(slug)}`),
      ...before
        .filter((slug) => !supersedes.includes(slug))
        .map((slug) => `No longer supersedes: ${said(slug)}`),
    ],
  });
};
