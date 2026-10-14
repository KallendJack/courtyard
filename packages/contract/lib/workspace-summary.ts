// A workspace as the lists show it, in Zod's small edition (zod/mini): the home page checks the
// workspace list on the first load, so it's kept apart from the rest of workspace.ts (#393).
import { z } from "zod/mini";

/** A workspace's folder name: lowercase letters and digits, words joined by single dashes. */
export const WorkspaceId = z
  .string()
  .check(z.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))
  .brand<"WorkspaceId">();
export type WorkspaceId = z.infer<typeof WorkspaceId>;

export const WorkspaceMode = z.enum(["planning", "code"]);
export type WorkspaceMode = z.infer<typeof WorkspaceMode>;

/**
 * The plain line icons a workspace can show on its tile (#210), in the order the Icon sheet
 * offers them. `book` is the plain one a name that says nothing gets.
 */
export const WorkspaceIcon = z.enum([
  "bicycle",
  "garage",
  "house",
  "dumbbell",
  "server",
  "code",
  "book",
  "sprout",
  "mountain",
  "camera",
  "wallet",
  "heart",
  "briefcase",
  "wrench",
  "music",
]);
export type WorkspaceIcon = z.infer<typeof WorkspaceIcon>;

export const WorkspaceSummary = z.object({
  id: WorkspaceId,
  name: z.string(),
  mode: WorkspaceMode,
  icon: WorkspaceIcon,
  hasContextFile: z.boolean(),
  /** Why the workspace's config was ignored, when it was. */
  configProblem: z.optional(z.string()),
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummary>;

export const WorkspaceList = z.object({ workspaces: z.array(WorkspaceSummary) });
export type WorkspaceList = z.infer<typeof WorkspaceList>;
