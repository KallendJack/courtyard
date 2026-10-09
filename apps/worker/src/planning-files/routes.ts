import { WorkspaceId } from "@courtyard/contract";
import type { Context } from "hono";
import type { z } from "zod";
import { apiError, contextError } from "../http.ts";
import type { PlanningFolderRefusal } from "./index.ts";

// What the documents' and Things' routes share: reading the workspace and the file a path names,
// and the answers for the refusals they have in common.

/** Documents or Things, as the owner reads them in an answer. */
export type PlanningFiles = { readonly one: string; readonly many: string };

export const DOCUMENTS: PlanningFiles = { one: "document", many: "documents" };
export const THINGS: PlanningFiles = { one: "Thing", many: "Things" };

/** The refusals documents and Things share: their workspace, a missing file, Undo and storage. */
export type SharedFileRefusal =
  | PlanningFolderRefusal
  | { readonly kind: "not-found" }
  | { readonly kind: "not-undoable" }
  | { readonly kind: "already-undone" }
  | { readonly kind: "storage" };

/** Why a document or a Thing wasn't read, saved or undone, in a case they share, as the API answers it. */
export const sharedFileError = (c: Context, refusal: SharedFileRefusal, files: PlanningFiles) => {
  switch (refusal.kind) {
    case "workspace":
      return contextError(c, refusal.error);
    case "code-workspace":
      return apiError(c, { status: 409, error: `Only planning workspaces keep ${files.many}.` });
    case "not-found":
      return apiError(c, { status: 404, error: `No such ${files.one}.` });
    case "not-undoable":
      return apiError(c, { status: 409, error: "This change can't be undone from here." });
    case "already-undone":
      return apiError(c, { status: 409, error: "This change is already undone." });
    case "storage":
      return apiError(c, {
        status: 500,
        error: `The workspace's ${files.many} can't be read or written.`,
      });
  }
};

/** `where` for the workspace a request's path names (`:id`), or `undefined` when it can't name one. */
export const workspaceIn = <T extends object>(c: Context, where: T) => {
  const id = WorkspaceId.safeParse(c.req.param("id"));
  return id.success ? { ...where, workspaceId: id.data } : undefined;
};

/**
 * `where` for the workspace a request's path names, and the file (`:slug`) as `slug` checks it, or
 * `undefined` when it can't name them.
 */
export const fileIn = <T extends object, Slug extends z.ZodType>(
  c: Context,
  where: T,
  slug: Slug,
) => {
  const workspace = workspaceIn(c, where);
  const named = slug.safeParse(c.req.param("slug"));
  return workspace === undefined || !named.success ? undefined : { workspace, slug: named.data };
};
