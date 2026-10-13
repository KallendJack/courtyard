import {
  type ModelRef,
  OpenPullRequestList,
  type ProviderList,
  type PullRequestFix,
  PullRequestFixed,
  type PullRequestMerging,
  PullRequestReview,
  type PullRequestSessionStart,
  type QuickQuestion,
  QuickQuestions,
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

/**
 * The first model that codes, which a session started from a pull request or Build (#298) works
 * with: the one a new session would start with, among those that code.
 */
export const codingModelIn = (providers: ProviderList["providers"]) => {
  for (const provider of providers) {
    const model = provider.available && provider.capabilities.codes && provider.models[0];
    if (model) return { ref: { provider: provider.id, model: model.id }, label: model.label };
  }
  return undefined;
};

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

/** A pull request by its workspace and number, whichever page shows it (#327). */
export type NumberedPullRequest = { readonly workspaceId: WorkspaceId; readonly number: number };

const questionsOf = (pull: NumberedPullRequest) =>
  `${pullRequestOf({ kind: "number", ...pull })}/questions`;

/** The quick questions asked about a pull request so far, and their answers (#327). */
export const loadQuickQuestions = (pull: NumberedPullRequest) =>
  fromWorker(questionsOf(pull), QuickQuestions);

/** Asks a quick question about a pull request: the conversation with its answer, once it comes. */
export const askQuickQuestion = (pull: NumberedPullRequest, question: QuickQuestion) =>
  sendJson({ path: questionsOf(pull), body: question, schema: QuickQuestions });

/**
 * Fix it in a session (#327): the quick questions carried over to the session on the pull
 * request's branch, or a new one there.
 */
export const fixInSession = (pull: NumberedPullRequest, fix: PullRequestFix) =>
  sendJson({
    path: `${pullRequestOf({ kind: "number", ...pull })}/fix`,
    body: fix,
    schema: PullRequestFixed,
  });

/** Every model on offer, each with its name in a word or two ("Sonnet 5.5"). */
const modelsIn = (providers: ProviderList["providers"]) =>
  providers.flatMap((provider) =>
    provider.available
      ? provider.models.map((model) => ({
          ref: { provider: provider.id, model: model.id },
          name: model.name,
          room: model.limit === undefined,
        }))
      : [],
  );

/**
 * The model quick questions ask (#327): the one a conversation started with, while it's on offer,
 * else the first on offer with room, else the first on offer.
 */
export const askingModelIn = (providers: ProviderList["providers"], started: ModelRef | null) => {
  const models = modelsIn(providers);
  const same = models.find(
    (model) => model.ref.provider === started?.provider && model.ref.model === started.model,
  );
  return same ?? models.find((model) => model.room) ?? models[0];
};
