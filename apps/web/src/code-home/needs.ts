import {
  type CodeSessionList,
  type MattSetup,
  type OpenPullRequest,
  pullRequestEnded,
} from "@courtyard/contract";
import { describeWhen } from "../when.ts";

// What waits on the owner in a workspace (#301), worked out from its sessions and pull requests:
// a code workspace's Needs you, and each workspace's tile on Home (#102). No React, no styles, so
// Home can load it without the Needs you block's pieces.

type Listed = CodeSessionList["sessions"][number];

/** How long a session's answer counts as a new reply, waiting on the owner. */
const NEW_REPLY_MS = 24 * 60 * 60 * 1000;

/** How long ago something was, in a few words: "just now", "2 min ago", "3 h ago", "Yesterday". */
export const agoWords = (iso: string, now = Date.now()) => {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return describeWhen(iso);
};

/** One thing waiting on the owner (AGENTS.md): each a row of Needs you. */
export type Need =
  | { readonly kind: "approval"; readonly session: Listed }
  | { readonly kind: "failed"; readonly pull: OpenPullRequest; readonly count: number }
  | { readonly kind: "reply"; readonly session: Listed }
  | { readonly kind: "merge"; readonly pull: OpenPullRequest }
  | { readonly kind: "conflict"; readonly pull: OpenPullRequest; readonly session?: Listed }
  | { readonly kind: "setup"; readonly missing: number };

/**
 * What waits on the owner, in the order the grill set (#301): approvals, failing checks, new
 * replies, pull requests ready to merge, conflicts, then Matt's setup.
 */
export const needsOf = (given: {
  sessions: readonly Listed[];
  pulls: readonly OpenPullRequest[];
  setup: MattSetup;
  now?: number;
}): Need[] => {
  const now = given.now ?? Date.now();
  const sessionOf = ({ from }: OpenPullRequest) =>
    from.kind === "session"
      ? given.sessions.find((session) => session.id === from.sessionId)
      : undefined;
  const open = given.pulls.filter((pull) => pull.pullRequest.state === "open");
  const approvals: Need[] = given.sessions
    .filter((session) => session.now.kind === "needs-you")
    .map((session) => ({ kind: "approval", session }));
  const failed: Need[] = open.flatMap((pull) => {
    const { checks, conflicts } = pull.pullRequest;
    // A session fixing its own failed checks is running, not waiting on the owner (#172).
    if (checks.kind !== "failed" || conflicts === true) return [];
    if (sessionOf(pull)?.now.kind === "working") return [];
    return [{ kind: "failed", pull, count: checks.failed.length }];
  });
  const replies: Need[] = given.sessions
    .filter(
      (session) =>
        session.now.kind === "your-turn" &&
        !session.queued &&
        session.pullRequest === undefined &&
        !pullRequestEnded(session.pullRequest) &&
        now - Date.parse(session.updatedAt) < NEW_REPLY_MS,
    )
    .map((session) => ({ kind: "reply", session }));
  const merges: Need[] = open
    .filter(
      (pull) => pull.pullRequest.checks.kind === "passed" && pull.pullRequest.conflicts !== true,
    )
    .map((pull) => ({ kind: "merge", pull }));
  const conflicts: Need[] = open
    .filter((pull) => pull.pullRequest.conflicts === true)
    .map((pull) => {
      const session = sessionOf(pull);
      return session === undefined
        ? { kind: "conflict", pull }
        : { kind: "conflict", pull, session };
    });
  const setup: Need[] =
    given.setup.state === "offered" ? [{ kind: "setup", missing: given.setup.missing.length }] : [];
  return [...approvals, ...failed, ...replies, ...merges, ...conflicts, ...setup];
};
