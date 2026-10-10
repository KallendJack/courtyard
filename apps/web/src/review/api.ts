import { PullRequestReview, type SessionId } from "@courtyard/contract";
import { z } from "zod";
import { fromWorker, sendJson } from "../worker.ts";

// The review's calls live with the review rather than in worker.ts, so they stay off the first
// load (#160).

const pullRequestOf = (sessionId: SessionId) =>
  `/sessions/${encodeURIComponent(sessionId)}/pull-request`;

/** A code session's pull request as the owner reviews it: its files, diffs, checks and Merge. */
export const loadReview = (sessionId: SessionId) =>
  fromWorker(pullRequestOf(sessionId), PullRequestReview);

/** Merges, or closes without merging, a code session's pull request on GitHub. */
export const endPullRequest = (sessionId: SessionId, how: "merge" | "close") =>
  sendJson({ path: `${pullRequestOf(sessionId)}/${how}`, body: {}, schema: z.unknown() });
