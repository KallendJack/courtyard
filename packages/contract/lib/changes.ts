import { z } from "zod";
import { ChangeId, PlacedLine, SessionId } from "./session.ts";

/** The kinds of change Recent changes lists: a model's save, the owner's undo or edit, a hand edit. */
export const RecentChangeKind = z.enum(["save", "undo", "edit", "hand-edit"]);
export type RecentChangeKind = z.infer<typeof RecentChangeKind>;

/**
 * Whether Recent changes offers Undo: for a save whose session still has it, or a hand edit
 * (`available`); not for a save already undone (`undone`); not for anything else (`none`).
 */
export const RecentChangeUndo = z.enum(["available", "undone", "none"]);
export type RecentChangeUndo = z.infer<typeof RecentChangeUndo>;

/**
 * One change to a workspace's context file or the owner context (ADR 0013): the lines it took out
 * and put in there, newest first. A reworded line is one out and one in.
 */
export const RecentChange = z.object({
  id: ChangeId,
  kind: RecentChangeKind,
  at: z.iso.datetime({ offset: true }),
  /** The session it came from, for a save and what the owner did with it. */
  session: SessionId.optional(),
  removed: z.array(PlacedLine),
  added: z.array(PlacedLine),
  undo: RecentChangeUndo,
});
export type RecentChange = z.infer<typeof RecentChange>;

/** How many changes a page of Recent changes holds. */
export const RECENT_CHANGES_PAGE = 30;

/** A page of Recent changes, and where the next one starts (`null` at the oldest). */
export const RecentChanges = z.object({
  changes: z.array(RecentChange),
  more: ChangeId.nullable(),
});
export type RecentChanges = z.infer<typeof RecentChanges>;
