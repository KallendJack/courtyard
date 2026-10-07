import { z } from "zod";
import { ModelRef, PlacedLine } from "./session.ts";

/** A tidy the worker proposed and still holds, until it's saved or another replaces it. */
export const TidyId = z.uuid().brand<"TidyId">();
export type TidyId = z.infer<typeof TidyId>;

/** Asks for a tidy of a workspace's context file or the owner context, by this model. */
export const TidyRequest = z.object({ model: ModelRef });
export type TidyRequest = z.infer<typeof TidyRequest>;

/** What a proposed change does: merges lines into one, removes one, or shortens one. */
export const TidyChangeKind = z.enum(["merge", "remove", "shorten"]);
export type TidyChangeKind = z.infer<typeof TidyChangeKind>;

/**
 * One change a tidy proposes (docs/ai-conduct.md, Tidying). It takes `lines` out and, unless it
 * removes, puts `text` in their place, in the first line's section. It never adds anything new.
 */
export const TidyChange = z.object({
  kind: TidyChangeKind,
  lines: z.array(PlacedLine).min(1),
  /** The line it puts in, for a merge or a shorten. */
  text: z.string().optional(),
  /** Why, in a few words, for a removal: the owner sees it before ticking. */
  why: z.string().optional(),
  /** How many characters shorter the file is with this change on its own. */
  shortensBy: z.number().int(),
});
export type TidyChange = z.infer<typeof TidyChange>;

/** A tidy as proposed: its changes, each ticked until the owner unticks it, and the file's size now. */
export const TidyProposal = z.object({
  id: TidyId,
  changes: z.array(TidyChange),
  characters: z.number().int().nonnegative(),
});
export type TidyProposal = z.infer<typeof TidyProposal>;

/** Saves a proposed tidy: the changes the owner left ticked, by their place in its list. */
export const TidySave = z.object({ keep: z.array(z.number().int().nonnegative()) });
export type TidySave = z.infer<typeof TidySave>;
