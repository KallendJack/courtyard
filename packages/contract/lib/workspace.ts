import { z } from "zod";

/** A workspace's folder name: lowercase letters and digits, words joined by single dashes. */
export const WorkspaceId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .brand<"WorkspaceId">();
export type WorkspaceId = z.infer<typeof WorkspaceId>;

export const WorkspaceMode = z.enum(["planning", "code"]);
export type WorkspaceMode = z.infer<typeof WorkspaceMode>;

export const WorkspaceSummary = z.object({
  id: WorkspaceId,
  name: z.string(),
  mode: WorkspaceMode,
  hasContextFile: z.boolean(),
  /** Why the workspace's config was ignored, when it was. */
  configProblem: z.string().optional(),
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummary>;

export const WorkspaceList = z.object({ workspaces: z.array(WorkspaceSummary) });
export type WorkspaceList = z.infer<typeof WorkspaceList>;

/**
 * Past this many characters (about 2,000 words) the workspace page warns that the context file
 * is long: it's sent with every message (docs/ai-conduct.md).
 */
export const CONTEXT_FILE_LONG_CHARACTERS = 8000;

/** A context file, read into its sections. Each fact, plan or idea is one line. */
export const ContextFile = z.object({
  title: z.string().optional(),
  /** Text above the first section. */
  intro: z.string(),
  facts: z.array(z.string()),
  plans: z.array(z.string()),
  ideas: z.array(z.string()),
  /** Any other sections, exactly as written. */
  other: z.string(),
  /** The whole file's length, as sent to a model. */
  characters: z.number().int().nonnegative(),
});
export type ContextFile = z.infer<typeof ContextFile>;

export const WorkspaceDetail = z.object({
  workspace: WorkspaceSummary,
  /** Absent when the workspace has no context file yet. */
  contextFile: ContextFile.nullable(),
});
export type WorkspaceDetail = z.infer<typeof WorkspaceDetail>;
