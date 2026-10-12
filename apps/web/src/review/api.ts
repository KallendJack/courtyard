import {
  OpenPullRequestList,
  type PullRequestMerging,
  PullRequestReview,
  type PullRequestSessionStart,
  type SessionId,
  SessionSummary,
  type WorkspaceId,
} from "@courtyard/contract";
import { z } from "zod";
import { fromWorker, sendJson } from "../worker.ts";

// The review's calls live with the review rather than in worker.ts, so they stay off the first
// load (#160).

/**
 * Which pull request a PR page shows (#278): a session's own, through its session, or one on the
 * workspace's repository that no session opened, by its number.
 */
export type ReviewOf =
  | { readonly kind: "session"; readonly sessionId: SessionId }
  | { readonly kind: "number"; readonly workspaceId: WorkspaceId; readonly number: number };

const pullRequestOf = (of: ReviewOf) =>
  of.kind === "session"
    ? `/sessions/${encodeURIComponent(of.sessionId)}/pull-request`
    : `/workspaces/${encodeURIComponent(of.workspaceId)}/pull-requests/${of.number}`;

/** A pull request as the owner reviews it: its files, diffs, checks and Merge. */
export const loadReview = (of: ReviewOf) => fromWorker(pullRequestOf(of), PullRequestReview);

/**
 * Merges a pull request on GitHub, only while its latest commit is `head`, the one the owner
 * reviewed; or closes it without merging.
 */
export const endPullRequest = (
  of: ReviewOf,
  how: { readonly kind: "merge"; readonly head: string } | { readonly kind: "close" },
) =>
  sendJson({
    path: `${pullRequestOf(of)}/${how.kind}`,
    body: how.kind === "merge" ? ({ head: how.head } satisfies PullRequestMerging) : {},
    schema: z.unknown(),
  });

/** Every open pull request on a code workspace's repository, whoever opened it (#278). */
export const loadOpenPullRequests = (workspaceId: WorkspaceId) =>
  fromWorker(`/workspaces/${encodeURIComponent(workspaceId)}/pull-requests`, OpenPullRequestList);

/** Bring up to date (#278): the session is sent the message to merge its base in. */
export const bringUpToDate = (sessionId: SessionId) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/pull-request/bring-up-to-date`,
    body: {},
    schema: z.unknown(),
  });

/** A session on the branch of a pull request no session opened (#278). */
export const startOnPullRequest = (
  of: { readonly workspaceId: WorkspaceId; readonly number: number },
  start: PullRequestSessionStart,
) =>
  sendJson({
    path: `${pullRequestOf({ kind: "number", ...of })}/sessions`,
    body: start,
    schema: SessionSummary,
  });
