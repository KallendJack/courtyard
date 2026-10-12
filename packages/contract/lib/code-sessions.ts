import { z } from "zod";
import { PullRequest } from "./pull-request.ts";
import { ListedSession } from "./session-state.ts";

/**
 * How many code sessions run at once across the worker (spec #169, story 5): a turn in a code
 * session beyond that waits until one of theirs ends. Six (#364): a session spends most of a turn
 * thinking and editing, which costs the machine little, while its heavy checks take turns in the
 * builds queue, so the cap is for the owner's usage, not the machine.
 */
export const CODE_SESSIONS_AT_ONCE = 6;

/**
 * A workspace's sessions as a code workspace's page lists them: as `SessionList`, with whether
 * each is waiting for a code session to finish, each code session's branch and its pull request
 * as last seen (the PRs tab, #240), and how many code sessions are running across the worker, of
 * `CODE_SESSIONS_AT_ONCE`.
 */
export const CodeSessionList = z.object({
  sessions: z.array(
    ListedSession.extend({
      queued: z.boolean(),
      branch: z.string().optional(),
      pullRequest: PullRequest.optional(),
    }),
  ),
  running: z.number().int().nonnegative(),
});
export type CodeSessionList = z.infer<typeof CodeSessionList>;
