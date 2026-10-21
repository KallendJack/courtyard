import { z } from "zod";
import { Effort, MAX_MESSAGE_LENGTH, ModelRef, SessionId } from "./session.ts";

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
  /** Its title on GitHub (#240); left out in ones recorded before. */
  title: z.string().optional(),
  url: z.url({ protocol: /^https$/ }),
  /** Open; or merged or closed, anywhere, so the session takes no more messages. */
  state: z.enum(["open", "merged", "closed"]),
  /** The commit its checks ran on: the session branch's latest, as pushed. */
  head: z.string(),
  checks: PullRequestChecks,
  changes: PullRequestChanges,
  /**
   * It conflicts with its base (#278), so its checks may not run until it's brought up to date;
   * left out in ones recorded before.
   */
  conflicts: z.boolean().optional(),
  /**
   * A draft on GitHub (#653): parked by whoever opened it, so it waits on the owner for nothing;
   * left out in ones recorded before.
   */
  draft: z.boolean().optional(),
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
  /**
   * Its description as the session wrote it, in Markdown (#240): with the house's PR skill, a
   * Summary, Evidence and Merge Danger. Empty when it has none.
   */
  body: z.string(),
  files: z.array(ChangedFile),
  merge: MergeReadiness,
  /** When it was merged (#278), once it has been. */
  mergedAt: z.iso.datetime({ offset: true }).optional(),
});
export type PullRequestReview = z.infer<typeof PullRequestReview>;

/**
 * Who opened a pull request (#278): one of the workspace's sessions, which keeps its link to it; a
 * Claude Code helper, which signs its descriptions; Dependabot, with a version bump (#496); or
 * someone on GitHub, by their login.
 */
export const PullRequestFrom = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("session"), sessionId: SessionId, title: z.string() }),
  z.object({ kind: z.literal("claude-code") }),
  z.object({ kind: z.literal("dependabot") }),
  z.object({ kind: z.literal("github"), login: z.string() }),
]);
export type PullRequestFrom = z.infer<typeof PullRequestFrom>;

/**
 * What an open pull request waits on the owner for (#334; AGENTS.md), decided once, by the worker:
 * its failing checks (unless its session is fixing them), a merge once its checks pass, its
 * conflict with its base; or nothing.
 */
export const PullRequestWaiting = z.enum(["failed", "merge", "conflict", "nothing"]);
export type PullRequestWaiting = z.infer<typeof PullRequestWaiting>;

/**
 * Where a Dependabot bump with a failing check stands as the worker looks after it (#496): its
 * failed checks re-running; the Lead fixing it, from the issue the worker filed; or still failing
 * after that fix, which hands it to the owner.
 */
export const BumpStanding = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rerunning") }),
  z.object({ kind: z.literal("fixing"), issue: z.number().int().positive() }),
  z.object({ kind: z.literal("stuck"), issue: z.number().int().positive() }),
]);
export type BumpStanding = z.infer<typeof BumpStanding>;

/** One of a repository's open pull requests, whoever opened it (#278), and what it waits on. */
export const OpenPullRequest = z.object({
  pullRequest: PullRequest,
  /** The branch it merges from. */
  branch: z.string(),
  /** The branch it merges into, once GitHub has said. */
  base: z.string().optional(),
  from: PullRequestFrom,
  waiting: PullRequestWaiting,
  /** A Dependabot bump's failing check, while the worker looks after it (#496). */
  bump: BumpStanding.optional(),
});
export type OpenPullRequest = z.infer<typeof OpenPullRequest>;

/** Every open pull request on a code workspace's repository, latest first (#278). */
export const OpenPullRequestList = z.object({ pullRequests: z.array(OpenPullRequest) });
export type OpenPullRequestList = z.infer<typeof OpenPullRequestList>;

/**
 * Starting a session on a pull request that has none (#278), on its branch, to bring it up to
 * date with its base. Fix it in a session starts one too (`PullRequestFix`, #327).
 */
export const PullRequestSessionStart = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bring-up-to-date"), model: ModelRef, effort: Effort.optional() }),
]);
export type PullRequestSessionStart = z.infer<typeof PullRequestSessionStart>;

/** The most a quick question's answer points at in the diff (#327). */
export const QUICK_LINES_MAX = 3;

/** A line in a pull request's diff an answer points at: its file, and the line in it as changed. */
export const QuickLine = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
});
export type QuickLine = z.infer<typeof QuickLine>;

/** One quick question about a pull request, and its answer (#327). */
export const QuickAnswer = z.object({
  question: z.string(),
  /** In Markdown. */
  answer: z.string(),
  /** Lines in the diff it points at, each one the diff shows. */
  lines: z.array(QuickLine).max(QUICK_LINES_MAX),
});
export type QuickAnswer = z.infer<typeof QuickAnswer>;

/**
 * Quick questions about a pull request (#327): a small read-only conversation, outside any
 * session, in which a model reads the pull request and changes nothing. Kept by the worker while
 * it runs; `model` is the one it was asked with, `null` before anything was asked.
 */
export const QuickQuestions = z.object({
  model: ModelRef.nullable(),
  asked: z.array(QuickAnswer),
});
export type QuickQuestions = z.infer<typeof QuickQuestions>;

/** A quick question to ask about a pull request, and the model to ask. */
export const QuickQuestion = z.object({
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  model: ModelRef,
});
export type QuickQuestion = z.infer<typeof QuickQuestion>;

/**
 * Fix it in a session (#327): the quick questions carried over to a session on the pull
 * request's branch, the one on it already or a new one, on this model.
 */
export const PullRequestFix = z.object({ model: ModelRef, effort: Effort.optional() });
export type PullRequestFix = z.infer<typeof PullRequestFix>;

/** The session Fix it in a session went to, and whether it started it. */
export const PullRequestFixed = z.object({ sessionId: SessionId, started: z.boolean() });
export type PullRequestFixed = z.infer<typeof PullRequestFixed>;

/**
 * Merging a session's pull request: the latest commit the owner reviewed, so a pull request that
 * has moved on since is never merged unseen.
 */
export const PullRequestMerging = z.object({ head: z.string().min(1) });
export type PullRequestMerging = z.infer<typeof PullRequestMerging>;
