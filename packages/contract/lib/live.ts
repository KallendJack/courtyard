import { z } from "zod";

/** A version of the live copy: its full commit, and how people read it (short commit, first line). */
export const LiveVersion = z.object({ commit: z.string(), title: z.string() });
export type LiveVersion = z.infer<typeof LiveVersion>;

/** How the last update went, as scripts/live/update.ps1 records it (ADR 0011). */
export const LiveUpdateResult = z.object({
  outcome: z.enum(["running", "updated", "unchanged", "refused", "failed"]),
  from: LiveVersion,
  to: LiveVersion,
  message: z.string(),
  startedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type LiveUpdateResult = z.infer<typeof LiveUpdateResult>;

/** Whether this worker can update itself from the app, and if so, what it runs and what's newer. */
export const LiveStatus = z.discriminatedUnion("kind", [
  /** Not a live copy: development, tests, or a worker set up by hand. */
  z.object({ kind: z.literal("off") }),
  z.object({
    kind: z.literal("live"),
    running: LiveVersion,
    /** Main's newest commit, when the live copy's remote could be reached. */
    newest: LiveVersion.nullable(),
    /** Whether main has moved on from what's running. */
    newerOnMain: z.boolean(),
    lastUpdate: LiveUpdateResult.nullable(),
  }),
]);
export type LiveStatus = z.infer<typeof LiveStatus>;
