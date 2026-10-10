import { z } from "zod";

// A code session's pull request (#172): the session opens it with gh, and the worker follows its
// state and checks on GitHub, recording each change in the session's events.

/** Where a pull request's checks stand, on its latest commit. */
export const PullRequestChecks = z.discriminatedUnion("kind", [
  /** None have run, or the repository has none. */
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("running") }),
  z.object({ kind: z.literal("passed") }),
  /** At least one failed, by name; others may still be running. */
  z.object({ kind: z.literal("failed"), failed: z.array(z.string()).min(1) }),
]);
export type PullRequestChecks = z.infer<typeof PullRequestChecks>;

/** A session's pull request, as GitHub has it. */
export const PullRequest = z.object({
  number: z.number().int().positive(),
  url: z.url({ protocol: /^https$/ }),
  /** Open; or merged or closed, anywhere, so the session takes no more messages. */
  state: z.enum(["open", "merged", "closed"]),
  /** The commit its checks ran on: the session branch's latest, as pushed. */
  head: z.string(),
  checks: PullRequestChecks,
});
export type PullRequest = z.infer<typeof PullRequest>;

/** Whether a pull request has been merged or closed, which ends its session. */
export const pullRequestEnded = (pullRequest: PullRequest | undefined) =>
  pullRequest !== undefined && pullRequest.state !== "open";
