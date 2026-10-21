import { z } from "zod";
import { DOCUMENT_MAX_CHARACTERS, DocumentSlug } from "./documents.ts";
import {
  PROJECT_FIELD_MAX_CHARACTERS,
  PROJECT_LINE_MAX_CHARACTERS,
  ProjectSlug,
  ProjectStep,
} from "./projects.ts";
import { ThingSlug, ThingUpcoming } from "./things.ts";

// The move review (#603, ADR 0032): once, a planning workspace's guides, Plans and Ideas lines and
// wanted Things are proposed moves into what it keeps now (projects, parts' upcoming ones,
// one-screen reference and the archive), each ticked by the owner, each moved as one change with
// Undo. Nothing moves unticked.

/** One line of a move's words. */
const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((text) => !/[\r\n]/.test(text));

/** The most moves a review proposes. */
export const MOVES_MAX = 8;

/** The most steps a move gives a project. */
export const MOVE_STEPS_MAX = 30;

/**
 * One move a review proposes: what it says (what moves where, and what it becomes), then what it
 * does, all as one change: a project it starts or adds steps to, documents it writes whole (one
 * made to fit a screen), documents it archives, parts it gives an upcoming one, and what it takes
 * away (a guide that became a project, a wanted Thing now upcoming, a line now a step).
 */
export const Move = z.object({
  /** What moves where, in a few words: "MTB journey guide → a project". */
  title: oneLine(PROJECT_FIELD_MAX_CHARACTERS),
  /** What it becomes, in a line: "Skills as its steps, next up as Next". */
  about: oneLine(PROJECT_LINE_MAX_CHARACTERS),
  /** A project it starts (by name, with its goal), or one it adds steps to (by its file's name). */
  project: z
    .object({
      slug: ProjectSlug.optional(),
      name: oneLine(PROJECT_FIELD_MAX_CHARACTERS).optional(),
      goal: oneLine(PROJECT_LINE_MAX_CHARACTERS).optional(),
      steps: z.array(ProjectStep).max(MOVE_STEPS_MAX),
    })
    .refine((project) => project.slug !== undefined || project.name !== undefined)
    .optional(),
  documents: z.array(
    z.object({ slug: DocumentSlug, text: z.string().trim().min(1).max(DOCUMENT_MAX_CHARACTERS) }),
  ),
  archive: z.array(DocumentSlug),
  upcoming: z.array(ThingUpcoming.extend({ part: ThingSlug })),
  remove: z.object({
    documents: z.array(DocumentSlug),
    things: z.array(ThingSlug),
    /** Lines of the context file's Plans or Ideas, word for word. */
    lines: z.array(oneLine(1000)),
  }),
});
export type Move = z.infer<typeof Move>;

/** A move as Home shows it, ticked: its number in the review and its words. */
export const MoveShown = z.object({
  id: z.number().int().nonnegative(),
  title: z.string(),
  about: z.string(),
});
export type MoveShown = z.infer<typeof MoveShown>;

/** A workspace's move review waiting on the owner, as Home shows it, each move ticked to begin with. */
export const MoveReview = z.object({ moves: z.array(MoveShown).min(1) });
export type MoveReview = z.infer<typeof MoveReview>;

/** The owner's ticks: the moves to make, by number; none leaves everything as it is. */
export const MoveTicks = z.object({ moves: z.array(z.number().int().nonnegative()) });
export type MoveTicks = z.infer<typeof MoveTicks>;

/**
 * What the ticked moves came to: each one made, by its words, and each one that couldn't be (a
 * document changed since, say), with why, which the review then shows again.
 */
export const MovesMade = z.object({
  moved: z.array(z.object({ title: z.string() })),
  left: z.array(z.object({ title: z.string(), problem: z.string() })),
});
export type MovesMade = z.infer<typeof MovesMade>;
