import { z } from "zod";

/** A workspace's folder name: lowercase letters and digits, words joined by single dashes. */
export const WorkspaceId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .brand<"WorkspaceId">();
export type WorkspaceId = z.infer<typeof WorkspaceId>;

export const WorkspaceMode = z.enum(["planning", "code"]);
export type WorkspaceMode = z.infer<typeof WorkspaceMode>;

/** The five workspace colours, in the order new workspaces take them (the theme defines each). */
export const WorkspaceColour = z.enum(["bracken", "heather", "slate", "moss", "peat"]);
export type WorkspaceColour = z.infer<typeof WorkspaceColour>;

export const WorkspaceSummary = z.object({
  id: WorkspaceId,
  name: z.string(),
  mode: WorkspaceMode,
  colour: WorkspaceColour,
  hasContextFile: z.boolean(),
  /** Why the workspace's config was ignored, when it was. */
  configProblem: z.string().optional(),
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummary>;

export const WorkspaceList = z.object({ workspaces: z.array(WorkspaceSummary) });
export type WorkspaceList = z.infer<typeof WorkspaceList>;

/** The longest name a new workspace can have. */
export const WORKSPACE_NAME_MAX_LENGTH = 60;

/** Adding a workspace from the app. Its folder name comes from its name. */
export const NewWorkspace = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the workspace a name.")
    .max(WORKSPACE_NAME_MAX_LENGTH, `Keep the name to ${WORKSPACE_NAME_MAX_LENGTH} characters.`),
});
export type NewWorkspace = z.infer<typeof NewWorkspace>;

/** Changing a workspace from the app. */
export const WorkspaceChange = z.object({ colour: WorkspaceColour });
export type WorkspaceChange = z.infer<typeof WorkspaceChange>;

/**
 * Past this many characters (about 1,500 words) the workspace page warns that the context file
 * is long, since it goes with every message (docs/ai-conduct.md).
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

/**
 * Past this many characters (about 400 words) the home page warns that the owner context is long,
 * since it goes with every message in every workspace (ADR 0010).
 */
export const OWNER_CONTEXT_LONG_CHARACTERS = 2000;

/** The owner context (`OWNER.md`), read into its sections. Each line is one fact, plan, idea or preference. */
export const OwnerContext = z.object({
  /** Text above About me. */
  intro: z.string(),
  /** About me. */
  facts: z.array(z.string()),
  plans: z.array(z.string()),
  ideas: z.array(z.string()),
  /** How to answer me. */
  answers: z.array(z.string()),
  /** The whole file's length. */
  characters: z.number().int().nonnegative(),
});
export type OwnerContext = z.infer<typeof OwnerContext>;

export const OwnerContextDetail = z.object({
  /** Absent until the owner starts one. */
  ownerContext: OwnerContext.nullable(),
});
export type OwnerContextDetail = z.infer<typeof OwnerContextDetail>;

/** What of the owner context a workspace's models read: all of it, How to answer me, or nothing. */
export const OwnerContextShared = z.enum(["all", "answers", "none"]);
export type OwnerContextShared = z.infer<typeof OwnerContextShared>;

export const WorkspaceDetail = z.object({
  workspace: WorkspaceSummary,
  /** Absent when the workspace has no context file yet. */
  contextFile: ContextFile.nullable(),
  ownerContextShared: OwnerContextShared,
});
export type WorkspaceDetail = z.infer<typeof WorkspaceDetail>;
