import type { SessionId, WorkspaceId } from "@courtyard/contract";
import type { z } from "zod";
import type { ChangeNote, ContextFolder } from "../context-folder/index.ts";
import { err, ok, type Result } from "../result.ts";
import {
  getWorkspace,
  plainName,
  RESERVED_ON_WINDOWS,
  type WorkspaceError,
} from "../workspaces/index.ts";

/**
 * What documents and Things share (ADR 0020): both are files in a planning workspace's folder,
 * named after what they're called, each write one change through the context folder that names
 * its files, so Recent changes lists it with Undo.
 */

/** Where a planning workspace's files are kept, and the session a change comes from, if any. */
export type PlanningFilesTarget = {
  readonly contextDir: string;
  readonly contextFolder: ContextFolder;
  readonly workspaceId: WorkspaceId;
  readonly sessionId?: SessionId;
};

/** Why a workspace can't keep documents or Things. */
export type PlanningFolderRefusal =
  /** The workspace can't be read, or isn't there. */
  | { readonly kind: "workspace"; readonly error: WorkspaceError }
  /** Only planning workspaces keep them (ADR 0020). */
  | { readonly kind: "code-workspace" };

/** A planning workspace's folder on the worker machine, or why it can't keep documents or Things. */
export const planningFolder = async (
  target: Pick<PlanningFilesTarget, "contextDir" | "workspaceId">,
): Promise<Result<string, PlanningFolderRefusal>> => {
  const workspace = await getWorkspace(target.contextDir, target.workspaceId);
  if (!workspace.ok) return err({ kind: "workspace", error: workspace.error });
  if (workspace.value.summary.mode !== "planning") return err({ kind: "code-workspace" });
  return ok(workspace.value.folder);
};

/** The longest a file's name gets, cut at a word. */
const SLUG_MAX = 60;

/**
 * The file name for a document or a Thing called `name`, as `slug` checks it, or `undefined`
 * when it has no letter or digit. A name Windows keeps for itself gets the kind after it
 * (`con-thing`).
 */
export const slugFor = <Slug extends z.ZodType>(
  name: string,
  file: { readonly slug: Slug; readonly kind: "document" | "thing" },
): z.output<Slug> | undefined => {
  let plain = plainName(name);
  if (plain.length > SLUG_MAX) plain = plain.slice(0, SLUG_MAX).replace(/-[^-]*$/, "");
  if (RESERVED_ON_WINDOWS.test(plain)) plain = `${plain}-${file.kind}`;
  const slug = file.slug.safeParse(plain);
  return slug.success ? slug.data : undefined;
};

/** A path in a workspace's folder (`docs/chain.md`) from the context folder's top, as changes name it. */
export const pathInFolder = (workspaceId: WorkspaceId, path: string) => `${workspaceId}/${path}`;

/** A path from the context folder's top, as changes name it, in its workspace's folder. */
export const pathInWorkspace = (path: string) => path.split("/").slice(1).join("/");

/**
 * A change to a planning workspace's documents or Things, described for the context folder's
 * history: its files by their paths in the workspace's folder, each named once.
 */
export const planningChange = (
  target: Pick<PlanningFilesTarget, "workspaceId" | "sessionId">,
  change: {
    readonly kind: "document" | "thing";
    readonly title: string;
    readonly paths: readonly string[];
  },
): ChangeNote => ({
  kind: change.kind,
  title: change.title,
  places: [{ kind: "workspace", id: target.workspaceId }],
  ...(target.sessionId === undefined ? {} : { session: target.sessionId }),
  files: [...new Set(change.paths.map((path) => pathInFolder(target.workspaceId, path)))],
});
