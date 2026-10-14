import type { CodeSessionList, MattSetup, OpenPullRequest } from "@courtyard/contract";
import { describeWhen } from "../when.ts";

// What waits on the owner in a workspace (#301, #334), as the worker decided it for each of its
// sessions and pull requests (`waiting`): a code workspace's Needs you, and each workspace's tile
// on Home (#102). The one place the web app reads it; nothing here works it out (AGENTS.md). No
// React, no styles, so Home can load it without the Needs you block's pieces.

type Listed = CodeSessionList["sessions"][number];

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
  /** Its session, when one opened it: a Lead's builder says so (#347). */
  | { readonly kind: "merge"; readonly pull: OpenPullRequest; readonly session?: Listed }
  | { readonly kind: "conflict"; readonly pull: OpenPullRequest; readonly session?: Listed }
  | { readonly kind: "setup"; readonly missing: number };

/**
 * What waits on the owner, as the worker says, in the order the grill set (#301): approvals,
 * failing checks, new replies, pull requests ready to merge, conflicts, then Matt's setup.
 */
export const needsOf = (given: {
  sessions: readonly Listed[];
  pulls: readonly OpenPullRequest[];
  setup: MattSetup;
}): Need[] => {
  const sessionOf = ({ from }: OpenPullRequest) =>
    from.kind === "session"
      ? given.sessions.find((session) => session.id === from.sessionId)
      : undefined;
  const sessionsWaiting = (on: Listed["waiting"]) =>
    given.sessions.filter((session) => session.waiting === on);
  const pullsWaiting = (on: OpenPullRequest["waiting"]) =>
    given.pulls.filter((pull) => pull.waiting === on);
  const approvals: Need[] = sessionsWaiting("approval").map((session) => ({
    kind: "approval",
    session,
  }));
  const failed: Need[] = pullsWaiting("failed").map((pull) => ({
    kind: "failed",
    pull,
    count: pull.pullRequest.checks.kind === "failed" ? pull.pullRequest.checks.failed.length : 0,
  }));
  const replies: Need[] = sessionsWaiting("reply").map((session) => ({ kind: "reply", session }));
  const merges: Need[] = pullsWaiting("merge").map((pull) => {
    const session = sessionOf(pull);
    return session === undefined ? { kind: "merge", pull } : { kind: "merge", pull, session };
  });
  const conflicts: Need[] = pullsWaiting("conflict").map((pull) => {
    const session = sessionOf(pull);
    return session === undefined ? { kind: "conflict", pull } : { kind: "conflict", pull, session };
  });
  const setup: Need[] =
    given.setup.state === "offered" ? [{ kind: "setup", missing: given.setup.missing.length }] : [];
  return [...approvals, ...failed, ...replies, ...merges, ...conflicts, ...setup];
};

/** A session waiting on the owner: an approval or a new reply. */
export type SessionNeed = Extract<Need, { kind: "approval" | "reply" }>;

/** The newest session waiting on the owner, which a workspace's tile names (#345). */
export const newestSessionNeed = (needs: readonly Need[]) =>
  needs.reduce<SessionNeed | undefined>(
    (newest, need) =>
      (need.kind === "approval" || need.kind === "reply") &&
      (newest === undefined || need.session.updatedAt > newest.session.updatedAt)
        ? need
        : newest,
    undefined,
  );

/** Sessions waiting on the owner first, as the worker says (#345), each part in its own order. */
export const waitingFirst = <T extends { readonly waiting: Listed["waiting"] }>(
  sessions: readonly T[],
) => [
  ...sessions.filter((session) => session.waiting !== "nothing"),
  ...sessions.filter((session) => session.waiting === "nothing"),
];
