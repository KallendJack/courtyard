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

/** A workspace's name, as the owner gives it in the app. */
const WorkspaceName = z
  .string()
  .trim()
  .min(1, "Give the workspace a name.")
  .max(WORKSPACE_NAME_MAX_LENGTH, `Keep the name to ${WORKSPACE_NAME_MAX_LENGTH} characters.`);

/** Adding a workspace from the app. Its folder name comes from its name. */
export const NewWorkspace = z.object({ name: WorkspaceName });
export type NewWorkspace = z.infer<typeof NewWorkspace>;

/** Changing a workspace from the app: its name, its colour, or both. Its folder stays as it is. */
export const WorkspaceChange = z
  .object({ name: WorkspaceName.optional(), colour: WorkspaceColour.optional() })
  .refine((change) => change.name !== undefined || change.colour !== undefined, {
    message: "Say what to change.",
  });
export type WorkspaceChange = z.infer<typeof WorkspaceChange>;

/**
 * Past this many characters (about 1,500 words) the workspace page warns that the context file
 * is long, since it goes with every message (docs/ai-conduct.md).
 */
export const CONTEXT_FILE_LONG_CHARACTERS = 8000;

/** A line longer than this is more than one fact (docs/ai-conduct.md, Context lines). */
export const CONTEXT_LINE_MAX_CHARACTERS = 250;

/** The three sections of a context file that hold its lines. */
export const ContextSection = z.enum(["facts", "plans", "ideas"]);
export type ContextSection = z.infer<typeof ContextSection>;

/** Each section's name, as its heading and the app write it. */
export const CONTEXT_SECTION_NAMES: Record<ContextSection, string> = {
  facts: "Facts",
  plans: "Plans",
  ideas: "Ideas",
};

/**
 * The sections of the owner context that hold lines: About me's Facts, Plans and Ideas, and How
 * to answer me (`answers`), one preference per line (ADR 0010).
 */
export const OwnerSection = z.enum(["facts", "plans", "ideas", "answers"]);
export type OwnerSection = z.infer<typeof OwnerSection>;

/** One line of a context file, as the owner writes it in the app. */
export const ContextLine = z
  .string()
  .trim()
  .min(1, "Write the line first.")
  .max(
    CONTEXT_LINE_MAX_CHARACTERS,
    `Keep the line to ${CONTEXT_LINE_MAX_CHARACTERS} characters: longer is more than one fact.`,
  )
  .refine((line) => !/[\r\n]/.test(line), "Keep it to one line.");

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
