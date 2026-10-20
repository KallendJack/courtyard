import { z } from "zod";

// The status line under a code workspace's name (#256): a tiny checklist of three items, ✓ just
// done · ● now · ○ next, built from its data with no model: its last merged pull request, its first
// running build and the first issue in Next up. A planning workspace has none (#600).

/** The longest an item's words can be: a few words, never a sentence. */
export const STATUS_ITEM_MAX_LENGTH = 40;

export const StatusItem = z.object({ text: z.string().min(1).max(STATUS_ITEM_MAX_LENGTH) });
export type StatusItem = z.infer<typeof StatusItem>;

/** A code workspace's status line, as `GET /api/workspaces/:id/status-line` gives it. */
export const StatusLine = z.object({
  done: StatusItem.nullable(),
  now: StatusItem.nullable(),
  next: StatusItem.nullable(),
});
export type StatusLine = z.infer<typeof StatusLine>;
