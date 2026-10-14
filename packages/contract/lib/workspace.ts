import { z } from "zod";
import { GitHubRepoName } from "./github-repo-name.ts";
import { WorkspaceIcon, WorkspaceId, WorkspaceSummary } from "./workspace-summary.ts";

export {
  WorkspaceIcon,
  WorkspaceId,
  WorkspaceList,
  WorkspaceMode,
  WorkspaceSummary,
} from "./workspace-summary.ts";

/**
 * The owner's order for the workspaces (#321), as the rail or the sidebar left it once a tile was
 * dragged: every workspace by its id, planning ones first, then code ones, never mixed.
 */
export const WorkspaceOrder = z.object({
  order: z
    .array(WorkspaceId)
    .refine((ids) => new Set(ids).size === ids.length, "Name each workspace once."),
});
export type WorkspaceOrder = z.infer<typeof WorkspaceOrder>;

/** The longest name a new workspace can have. */
export const WORKSPACE_NAME_MAX_LENGTH = 60;

/** A workspace's name, as the owner gives it in the app. */
const WorkspaceName = z
  .string()
  .trim()
  .min(1, "Give the workspace a name.")
  .max(WORKSPACE_NAME_MAX_LENGTH, `Keep the name to ${WORKSPACE_NAME_MAX_LENGTH} characters.`);

/** Changing a workspace from the app: its name, its icon, or both. Its folder stays as it is. */
export const WorkspaceChange = z
  .object({ name: WorkspaceName.optional(), icon: z.optional(WorkspaceIcon) })
  .refine((change) => change.name !== undefined || change.icon !== undefined, {
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

/**
 * Adding a workspace from the app. Its folder name comes from its name; what it's for (What's it
 * for?), when the owner says, is its context file's intro line (docs/ai-conduct.md), or in a code
 * workspace, which has no context file, its `workspace.json`'s description (#301).
 */
export const NewWorkspace = z.object({
  name: WorkspaceName,
  intro: z
    .string()
    .trim()
    .max(
      CONTEXT_LINE_MAX_CHARACTERS,
      `Keep what it's for to ${CONTEXT_LINE_MAX_CHARACTERS} characters.`,
    )
    .refine((line) => !/[\r\n]/.test(line), "Keep what it's for to one line.")
    .optional(),
  /**
   * For a code workspace (#258): the GitHub repo it works on, picked from the owner's repos. The
   * worker gets it onto the worker machine first, unless it's there already.
   */
  repo: GitHubRepoName.optional(),
});
export type NewWorkspace = z.infer<typeof NewWorkspace>;

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
 * Past this many characters (about 400 words) Settings warns that the owner context is long,
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

/**
 * Whether a context file or the owner context has any lines yet: facts, plans, ideas or (in the
 * owner context) preferences. Only lines count: an untouched starter has none.
 */
export const hasLines = (read: {
  readonly facts: readonly string[];
  readonly plans: readonly string[];
  readonly ideas: readonly string[];
  readonly answers?: readonly string[];
}) => [read.facts, read.plans, read.ideas, read.answers ?? []].some((lines) => lines.length > 0);

export const OwnerContextDetail = z.object({
  /** Absent until the owner starts one. */
  ownerContext: OwnerContext.nullable(),
});
export type OwnerContextDetail = z.infer<typeof OwnerContextDetail>;

/** What of the owner context a workspace's models read: all of it, How to answer me, or nothing. */
export const OwnerContextShared = z.enum(["all", "answers", "none"]);
export type OwnerContextShared = z.infer<typeof OwnerContextShared>;

/** A plan that names the day it's due (#300), and that day, as `2026-10-18`. */
export const DuePlan = z.object({
  plan: z.string(),
  due: z.iso.date(),
});
export type DuePlan = z.infer<typeof DuePlan>;

export const WorkspaceDetail = z.object({
  workspace: WorkspaceSummary,
  /**
   * Absent when the workspace has no context file yet; always absent in a code workspace, which
   * has none (#301): its knowledge lives in its repository.
   */
  contextFile: ContextFile.nullable(),
  /**
   * A code workspace's one line, What it's for (#301), kept in its `workspace.json`; a planning
   * workspace's is its context file's intro.
   */
  description: z.string().optional(),
  ownerContextShared: OwnerContextShared,
  /**
   * A planning workspace's plans that name a day from today to 7 days on, soonest first, for its
   * Home's Next up (#300). Absent in a code workspace.
   */
  duePlans: z.array(DuePlan).optional(),
});
export type WorkspaceDetail = z.infer<typeof WorkspaceDetail>;
