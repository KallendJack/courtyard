import {
  type CodeSessionList,
  type OpenPullRequest,
  type PullRequestFrom,
  type PullRequestReview,
  type PullRequestSessionStart,
  pullRequestEnded,
  type SessionSummary,
  type WorkspaceId,
} from "@courtyard/contract";
import type { Code } from "../code/index.ts";
import type { FoundPullRequest } from "../github/index.ts";
import { bringUpToDateMessage } from "../prompts/index.ts";
import { err, ok, type Result } from "../result.ts";
import type { SessionError, Sessions } from "../sessions/index.ts";
import { pullRequestWaiting } from "../waiting/index.ts";
import { getWorkspace, type WorkspaceError } from "../workspaces/index.ts";

/**
 * A code workspace's pull requests, whoever opened them (#278): every open one on its repository,
 * each with the session that opened it or who did; reviewed, merged and closed by its number; a
 * session started on the branch of one no session opened; and Bring up to date. A session's own
 * pull request is acted on through its session, so it ends as one merged on GitHub does.
 */

/** Why a workspace's pull request couldn't be listed, shown or acted on. */
export type PullRequestsProblem =
  | { readonly kind: "workspace"; readonly error: WorkspaceError }
  /** It isn't a code workspace, so it has no pull requests. */
  | { readonly kind: "not-code" }
  /** No pull request on its repository has that number. */
  | { readonly kind: "no-such-pull-request" }
  /** A session is on it already, so the owner asks that one. */
  | { readonly kind: "has-session" }
  /** It comes from a fork, so its branch can't be worked on here. */
  | { readonly kind: "fork" }
  | { readonly kind: "session"; readonly error: SessionError };

/** Words a Claude Code helper's PR skill signs a description with. */
const CLAUDE_CODE_SIGNED = /Generated with \[Claude Code\]/;

type Listed = CodeSessionList["sessions"][number];

/** The session working on `branch`, if any: one whose own pull request, if it has one, is `number`. */
const sessionOn = (sessions: readonly Listed[], branch: string, number?: number) =>
  sessions.find(
    (session) =>
      session.branch === branch &&
      (session.pullRequest === undefined ||
        number === undefined ||
        session.pullRequest.number === number),
  );

/** Who opened a pull request: the session on its branch, a Claude Code helper, or its author. */
const fromOf = (sessions: readonly Listed[], found: FoundPullRequest): PullRequestFrom => {
  const session = sessionOn(sessions, found.branch, found.number);
  if (session !== undefined) {
    return { kind: "session", sessionId: session.id, title: session.title };
  }
  return CLAUDE_CODE_SIGNED.test(found.body)
    ? { kind: "claude-code" }
    : { kind: "github", login: found.author };
};

const sessionProblem = (error: SessionError): PullRequestsProblem => ({ kind: "session", error });

export const createPullRequests = (options: {
  contextDir: string;
  code: Code;
  sessions: Sessions;
}) => {
  const { code, sessions } = options;

  /** A code workspace's id, repository and sessions, or why it has no pull requests. */
  const codeWorkspace = async (
    rawId: string,
  ): Promise<
    Result<
      { workspaceId: WorkspaceId; repoPath: string; sessions: readonly Listed[] },
      PullRequestsProblem
    >
  > => {
    const workspace = await getWorkspace(options.contextDir, rawId);
    if (!workspace.ok) return err({ kind: "workspace", error: workspace.error });
    const { repoPath, summary } = workspace.value;
    if (summary.mode !== "code" || repoPath === null) return err({ kind: "not-code" });
    const listed = await sessions.list(summary.id);
    if (!listed.ok) return err(sessionProblem(listed.error));
    return ok({ workspaceId: summary.id, repoPath, sessions: listed.value });
  };

  /** Pull request `number` on a code workspace's repository, with the session on it if any. */
  const numbered = async (
    rawId: string,
    number: number,
  ): Promise<
    Result<
      {
        workspaceId: WorkspaceId;
        repoPath: string;
        found: FoundPullRequest;
        session: Listed | undefined;
      },
      PullRequestsProblem
    >
  > => {
    const workspace = await codeWorkspace(rawId);
    if (!workspace.ok) return workspace;
    const { repoPath, workspaceId } = workspace.value;
    const found = await code.pullRequestNumbered({ repoPath, number });
    if (!found.ok) return err(sessionProblem({ kind: "github", problem: found.error }));
    if (found.value === undefined) return err({ kind: "no-such-pull-request" });
    const session = sessionOn(workspace.value.sessions, found.value.branch, number);
    return ok({ workspaceId, repoPath, found: found.value, session });
  };

  return {
    /**
     * Every open pull request on a code workspace's repository, latest first, whoever opened it.
     * While GitHub can't be asked (signed out, say), its sessions' open ones as last seen.
     */
    list: async (rawId: string): Promise<Result<OpenPullRequest[], PullRequestsProblem>> => {
      const workspace = await codeWorkspace(rawId);
      if (!workspace.ok) return workspace;
      const { repoPath, sessions: listed } = workspace.value;
      const open = await code.openPullRequests({ repoPath });
      if (open.ok) {
        return ok(
          open.value.map(({ found, pullRequest }) => ({
            pullRequest,
            branch: found.branch,
            base: found.base,
            from: fromOf(listed, found),
            waiting: pullRequestWaiting(pullRequest, sessionOn(listed, found.branch, found.number)),
          })),
        );
      }
      return ok(
        listed
          .flatMap((session): OpenPullRequest[] =>
            session.pullRequest?.state === "open" && session.branch !== undefined
              ? [
                  {
                    pullRequest: session.pullRequest,
                    branch: session.branch,
                    from: { kind: "session", sessionId: session.id, title: session.title },
                    waiting: pullRequestWaiting(session.pullRequest, session),
                  },
                ]
              : [],
          )
          .sort((a, b) => b.pullRequest.number - a.pullRequest.number),
      );
    },

    /** Pull request `number` as the owner reviews it, whoever opened it. */
    review: async (
      rawId: string,
      number: number,
    ): Promise<Result<PullRequestReview, PullRequestsProblem>> => {
      const workspace = await codeWorkspace(rawId);
      if (!workspace.ok) return workspace;
      const review = await code.reviewNumbered({ repoPath: workspace.value.repoPath, number });
      if (!review.ok) return err(sessionProblem({ kind: "github", problem: review.error }));
      return review.value === undefined ? err({ kind: "no-such-pull-request" }) : ok(review.value);
    },

    /**
     * Merges pull request `number`, only while its latest commit is `reviewed`; through its
     * session when one is on it, so the session ends as one merged on GitHub does.
     */
    merge: async (
      rawId: string,
      number: number,
      reviewed: string,
    ): Promise<Result<null, PullRequestsProblem>> => {
      const pull = await numbered(rawId, number);
      if (!pull.ok) return pull;
      const { session, repoPath } = pull.value;
      if (session !== undefined) {
        const merged = await sessions.mergePullRequest(session.id, reviewed);
        return merged.ok ? merged : err(sessionProblem(merged.error));
      }
      const review = await code.reviewNumbered({ repoPath, number });
      if (!review.ok) return err(sessionProblem({ kind: "github", problem: review.error }));
      if (review.value === undefined) return err({ kind: "no-such-pull-request" });
      const refused = (reason: string) =>
        err(sessionProblem({ kind: "pull-request-refused", reason }));
      if (review.value.pullRequest.head !== reviewed) {
        return refused("The pull request changed since you looked. Review it again.");
      }
      if (review.value.merge.kind === "refused") return refused(review.value.merge.reason);
      const merged = await code.merge({ repoPath, number, head: reviewed });
      return merged.ok ? merged : err(sessionProblem({ kind: "github", problem: merged.error }));
    },

    /** Closes pull request `number` without merging it; through its session when one is on it. */
    close: async (rawId: string, number: number): Promise<Result<null, PullRequestsProblem>> => {
      const pull = await numbered(rawId, number);
      if (!pull.ok) return pull;
      const { session, repoPath, found } = pull.value;
      if (session !== undefined) {
        const closed = await sessions.closePullRequest(session.id);
        return closed.ok ? closed : err(sessionProblem(closed.error));
      }
      if (found.state !== "open") {
        return err(
          sessionProblem({ kind: "pull-request-refused", reason: `It's ${found.state} already.` }),
        );
      }
      const closed = await code.close({ repoPath, number });
      return closed.ok ? closed : err(sessionProblem({ kind: "github", problem: closed.error }));
    },

    /**
     * Starts a session on the branch of pull request `number`, which no session is on: with the
     * owner's question, or to bring it up to date with its base, freshly fetched.
     */
    startSession: async (
      rawId: string,
      number: number,
      start: PullRequestSessionStart,
    ): Promise<Result<SessionSummary, PullRequestsProblem>> => {
      const pull = await numbered(rawId, number);
      if (!pull.ok) return pull;
      const { session, found, repoPath, workspaceId } = pull.value;
      if (session !== undefined && !pullRequestEnded(session.pullRequest)) {
        return err({ kind: "has-session" });
      }
      if (found.state !== "open") {
        return err(sessionProblem({ kind: "pull-request-ended", state: found.state }));
      }
      if (found.fork) return err({ kind: "fork" });
      const effort = start.effort === undefined ? {} : { effort: start.effort };
      let first: { text: string; title?: string };
      if (start.kind === "ask") {
        first = { text: start.text };
      } else {
        const fresh = await code.freshDefault(repoPath);
        if (!fresh.ok) return err(sessionProblem({ kind: "branch-refused", refusal: fresh.error }));
        first = {
          text: bringUpToDateMessage({ number, base: fresh.value.branch }),
          title: `Bring #${number} up to date`,
        };
      }
      const created = await sessions.create({
        workspaceId,
        message: { text: first.text, model: start.model, ...effort },
        onBranch: found.branch,
        ...(first.title === undefined ? {} : { title: first.title }),
      });
      return created.ok ? created : err(sessionProblem(created.error));
    },
  };
};

export type PullRequests = ReturnType<typeof createPullRequests>;
