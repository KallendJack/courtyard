import { type PullRequestMerging, PullRequestReview, type SessionId } from "@courtyard/contract";
import { z } from "zod";
import { fromWorker, sendJson } from "../worker.ts";

// The review's calls live with the review rather than in worker.ts, so they stay off the first
// load (#160).

const pullRequestOf = (sessionId: SessionId) =>
  `/sessions/${encodeURIComponent(sessionId)}/pull-request`;

/** A code session's pull request as the owner reviews it: its files, diffs, checks and Merge. */
export const loadReview = (sessionId: SessionId) =>
  fromWorker(pullRequestOf(sessionId), PullRequestReview);

/**
 * Merges a code session's pull request on GitHub, only while its latest commit is `head`, the one
 * the owner reviewed; or closes it without merging.
 */
export const endPullRequest = (
  sessionId: SessionId,
  how: { readonly kind: "merge"; readonly head: string } | { readonly kind: "close" },
) =>
  sendJson({
    path: `${pullRequestOf(sessionId)}/${how.kind}`,
    body: how.kind === "merge" ? ({ head: how.head } satisfies PullRequestMerging) : {},
    schema: z.unknown(),
  });
