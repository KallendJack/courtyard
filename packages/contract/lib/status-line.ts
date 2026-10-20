import { z } from "zod";
import { SessionId } from "./session.ts";

// The status line under a workspace's name (#256): a tiny checklist of three items, ✓ just done ·
// ● now · ○ next. A planning workspace's is kept current by a short turn on a cheap model as each
// of its sessions' turns ends, and the owner can tick, edit or remove an item; a code workspace's
// is built from its data, with no model: its last merged pull request, its first running build and
// the first issue in Next up.

/** The longest an item's words can be: a few words, never a sentence. */
export const STATUS_ITEM_MAX_LENGTH = 40;

/** Where an item is on the line: ✓ just done, ● now, ○ next. */
export const StatusPlace = z.enum(["done", "now", "next"]);
export type StatusPlace = z.infer<typeof StatusPlace>;

/** An item's words, as the owner edits them. */
export const StatusItemText = z
  .string()
  .trim()
  .min(1, "Write a few words first.")
  .max(STATUS_ITEM_MAX_LENGTH, `Keep it to ${STATUS_ITEM_MAX_LENGTH} characters.`);

export const StatusItem = z.object({
  text: z.string().min(1).max(STATUS_ITEM_MAX_LENGTH),
  /** The session whose turn put it there, and when; left out for one the owner set or one built from data. */
  from: z.object({ session: SessionId, at: z.iso.datetime() }).optional(),
  /** The owner set its words (Edit): they stay until a session moves things on. */
  edited: z.literal(true).optional(),
});
export type StatusItem = z.infer<typeof StatusItem>;

/** A workspace's status line, as `GET /api/workspaces/:id/status-line` gives it. */
export const StatusLine = z.object({
  done: StatusItem.nullable(),
  now: StatusItem.nullable(),
  next: StatusItem.nullable(),
  /** Whether the owner can tick, edit or remove its items: a planning workspace's, not a code one's. */
  editable: z.boolean(),
});
export type StatusLine = z.infer<typeof StatusLine>;

/**
 * The owner's change to an item (#256): Done moves the line along at once (now becomes just done,
 * and next becomes now; next done becomes just done), Edit gives it new words, Remove takes it off.
 */
export const StatusLineChange = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("done"), place: z.enum(["now", "next"]) }),
  z.object({ kind: z.literal("edit"), place: StatusPlace, text: StatusItemText }),
  z.object({ kind: z.literal("remove"), place: StatusPlace }),
]);
export type StatusLineChange = z.infer<typeof StatusLineChange>;
