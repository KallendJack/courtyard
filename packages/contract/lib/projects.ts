import { z } from "zod";
import { ChangeId } from "./change-id.ts";
import { BuildSlug } from "./fabrication/builds.ts";

// A planning workspace's projects (#603, ADR 0032): what the owner carries over days and sessions,
// such as turning the garage into an office, a Markdown file each in its `projects` folder: its
// name, goal and status in front matter, then its steps, its decisions and a dated history. Only
// the pages that show them load these.

/** A project's file name without `.md`: its name's letters and digits, words joined by dashes. */
export const ProjectSlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80)
  .brand<"ProjectSlug">();
export type ProjectSlug = z.infer<typeof ProjectSlug>;

/** Whether the owner is carrying a project on, or it's finished. */
export const ProjectStatus = z.enum(["active", "done"]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

/**
 * What a step asks of the owner (ADR 0032): one they can do themselves, one that needs a pro (work
 * on electrics, gas or a building's structure), or one decided.
 */
export const StepKind = z.enum(["you can do this", "needs a pro", "decided"]);
export type StepKind = z.infer<typeof StepKind>;

/** The longest a project's name, a step, its detail, or a decision's subject or option gets. */
export const PROJECT_FIELD_MAX_CHARACTERS = 120;

/** The longest a project's goal, a decision's pick or its why, or a history line gets. */
export const PROJECT_LINE_MAX_CHARACTERS = 250;

/** The most options a decision keeps. */
export const DECISION_OPTIONS_MAX = 6;

/** One line of free text, as each of a project's fields is. */
const oneLine = (max: number, what: string) =>
  z
    .string()
    .trim()
    .min(1, `Give the ${what}.`)
    .max(max, `Keep the ${what} to ${max} characters.`)
    .refine((text) => !/[\r\n]/.test(text), `Keep the ${what} to one line.`);

/**
 * One of a project's steps: what it asks of the owner, what it is in a few words, and its detail:
 * what it takes ("about 10 minutes, laser measurer"), or for one that needs a pro, who to get and
 * what to ask ("an electrician (Part P)").
 */
export const ProjectStep = z.object({
  kind: StepKind,
  text: oneLine(PROJECT_FIELD_MAX_CHARACTERS, "step").refine(
    (text) => !text.includes(" · "),
    "Keep the step's detail out of its words: give it as its detail.",
  ),
  detail: oneLine(PROJECT_FIELD_MAX_CHARACTERS, "step's detail").optional(),
  /** The Build the step makes (#697, ADR 0037), by its file's name: "Build the workbench". */
  build: BuildSlug.optional(),
});
export type ProjectStep = z.infer<typeof ProjectStep>;

/**
 * A decision made for a project, as buying a part is (ADR 0032): what it was about, the options
 * weighed, the pick and why.
 */
export const ProjectDecision = z.object({
  about: oneLine(PROJECT_FIELD_MAX_CHARACTERS, "decision's subject"),
  pick: oneLine(PROJECT_LINE_MAX_CHARACTERS, "pick"),
  why: oneLine(PROJECT_LINE_MAX_CHARACTERS, "reason why").optional(),
  options: z
    .array(oneLine(PROJECT_FIELD_MAX_CHARACTERS, "option").refine((text) => !text.includes(";")))
    .max(DECISION_OPTIONS_MAX, `Keep to ${DECISION_OPTIONS_MAX} options.`),
});
export type ProjectDecision = z.infer<typeof ProjectDecision>;

/** A project's fields as its file's front matter holds them. */
export const ProjectFields = z
  .object({
    name: oneLine(PROJECT_FIELD_MAX_CHARACTERS, "project's name"),
    goal: oneLine(PROJECT_LINE_MAX_CHARACTERS, "goal").optional(),
    status: ProjectStatus,
  })
  .strict();
export type ProjectFields = z.infer<typeof ProjectFields>;

/**
 * A project as its page and Home show it: its fields, its steps in order (its first step not
 * decided is what's next, `nextStepOf`), its decisions, and where its file is.
 */
export const Project = ProjectFields.extend({
  slug: ProjectSlug,
  /** Its path in the workspace's folder: `projects/<slug>.md`. */
  path: z.string(),
  steps: z.array(ProjectStep),
  decisions: z.array(ProjectDecision),
  updatedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof Project>;

/** What's next on a project: its first step that isn't decided, if any. */
export const nextStepOf = (project: Pick<Project, "steps">) =>
  project.steps.find((step) => step.kind !== "decided");

/**
 * What one project save did (#603), by the project's file's name and its name then: started it or
 * changed it, and what changed, in a few words each, for its note.
 */
export const ProjectSave = z.object({
  action: z.enum(["add", "change"]),
  project: z.object({ slug: ProjectSlug, name: z.string() }),
  changes: z.array(z.string()),
});
export type ProjectSave = z.infer<typeof ProjectSave>;

/**
 * A project's decision picked on an options block (#603), in a session that belongs to it: the
 * project as it is now, and the change that recorded it (`null` when it couldn't be kept), which
 * Undo names.
 */
export const ProjectDecided = z.object({ change: z.nullable(ChangeId), project: Project });
export type ProjectDecided = z.infer<typeof ProjectDecided>;

/**
 * A change to a project as Recent changes lists it: what it did (removed only by undoing its
 * start), the project's name, and its file's name while it's still there to open.
 */
export const ProjectChange = z.object({
  did: z.enum(["added", "changed", "removed"]),
  name: z.string(),
  slug: ProjectSlug.nullable(),
});
export type ProjectChange = z.infer<typeof ProjectChange>;
