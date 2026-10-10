import { z } from "zod";

// A code session's pull request (#172): the session opens it with gh, and the worker follows its
// state and checks on GitHub, recording each change in the session's events. The owner reviews it
// in Courtyard (#160): its changed files and their diffs, then Merge or Close.

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

/** How much a pull request changes: lines added and removed, and files changed (#160). */
export const PullRequestChanges = z.object({
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
});
export type PullRequestChanges = z.infer<typeof PullRequestChanges>;

/** A session's pull request, as GitHub has it. */
export const PullRequest = z.object({
  number: z.number().int().positive(),
  url: z.url({ protocol: /^https$/ }),
  /** Open; or merged or closed, anywhere, so the session takes no more messages. */
  state: z.enum(["open", "merged", "closed"]),
  /** The commit its checks ran on: the session branch's latest, as pushed. */
  head: z.string(),
  checks: PullRequestChecks,
  changes: PullRequestChanges,
});
export type PullRequest = z.infer<typeof PullRequest>;

/** Whether a pull request has been merged or closed, which ends its session. */
export const pullRequestEnded = (
  pullRequest: PullRequest | undefined,
): pullRequest is PullRequest & { state: "merged" | "closed" } =>
  pullRequest !== undefined && pullRequest.state !== "open";

/** One check on a pull request's latest commit, by name, and how it's going. */
export const PullRequestCheck = z.object({
  name: z.string(),
  /** `other` for one that ended neither passing nor failing: skipped, cancelled. */
  outcome: z.enum(["running", "passed", "failed", "other"]),
});
export type PullRequestCheck = z.infer<typeof PullRequestCheck>;

/** A file a pull request changes, with its diff. */
export const ChangedFile = z.object({
  /** Where it is now, from the repository's top: `apps/web/src/main.tsx`. */
  path: z.string().min(1),
  status: z.enum(["added", "removed", "modified", "renamed"]),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  /**
   * Its diff, as git's unified diff hunks (each from its `@@` line), or `null` when GitHub has
   * none to show: a binary file, one too large, or one only renamed.
   */
  patch: z.string().nullable(),
});
export type ChangedFile = z.infer<typeof ChangedFile>;

/** Whether Merge can merge the pull request now, or why not, in the owner's words. */
export const MergeReadiness = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready") }),
  z.object({ kind: z.literal("refused"), reason: z.string() }),
]);
export type MergeReadiness = z.infer<typeof MergeReadiness>;

/** A session's pull request as the owner reviews it (#160): what it changes, and Merge. */
export const PullRequestReview = z.object({
  pullRequest: PullRequest,
  /** The session branch, and the branch it merges into. */
  branch: z.string(),
  base: z.string(),
  checks: z.array(PullRequestCheck),
  files: z.array(ChangedFile),
  merge: MergeReadiness,
});
export type PullRequestReview = z.infer<typeof PullRequestReview>;

/**
 * Merging a session's pull request: the latest commit the owner reviewed, so a pull request that
 * has moved on since is never merged unseen.
 */
export const PullRequestMerging = z.object({ head: z.string().min(1) });
export type PullRequestMerging = z.infer<typeof PullRequestMerging>;
