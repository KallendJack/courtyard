import { z } from "zod";
import { SessionSummary } from "./session.ts";

/**
 * How many code sessions run at once across the worker (spec #169, story 5): a turn in a code
 * session beyond that waits until one of theirs ends.
 */
export const CODE_SESSIONS_AT_ONCE = 3;

/**
 * A workspace's sessions as a code workspace's page lists them: as `SessionList`, with whether
 * each is waiting for a code session to finish, and how many code sessions are running across
 * the worker, of `CODE_SESSIONS_AT_ONCE`.
 */
export const CodeSessionList = z.object({
  sessions: z.array(SessionSummary.extend({ queued: z.boolean() })),
  running: z.number().int().nonnegative(),
});
export type CodeSessionList = z.infer<typeof CodeSessionList>;
