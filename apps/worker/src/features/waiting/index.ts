import type {
  CodeSessionList,
  NeedsYou,
  NeedYou,
  PullRequest,
  PullRequestWaiting,
  SessionEvent,
  SessionWaiting,
  TurnNow,
  WorkspaceSummary,
} from "@courtyard/contract";

/**
 * What waits on the owner (#334; AGENTS.md), decided here once for every list, screen and device:
 * a session's approval or new reply, and an open pull request's failing checks, merge or conflict.
 * The web app shows what these say and never works it out itself.
 */

/** How long a session's answer counts as a new reply, waiting on the owner (#301). */
const NEW_REPLY_MS = 24 * 60 * 60 * 1000;

/** A session's latest answer: the event that ended its turn, completed or failed, by number and time. */
export type Answer = { readonly seq: number; readonly at: string };

/**
 * The answer an event is, when it ends its turn completed or failed; a stopped turn is the
 * owner's own doing, so it's no reply.
 */
export const answerOf = (event: SessionEvent): Answer | undefined =>
  event.type === "turn-completed" || event.type === "turn-failed"
    ? { seq: event.seq, at: event.at }
    : undefined;

/**
 * A session's latest answer as its events come, one at a time: `answer`, and whether its turn
 * now is a code workspace's Lead reporting (#347), started by the owner's tap on Run the build
 * order or by the worker when a builder's pull request merged: its answer is a report on Home's
 * Running row, not a reply the owner waits for.
 */
export type Answered = {
  readonly answer: Answer | undefined;
  readonly reporting: boolean;
  /** Its latest answer is a turn cut off by a restart (#186), which waits for Continue. */
  readonly cutOff: boolean;
};

export const answeredAfter = (was: Answered, event: SessionEvent): Answered => {
  if (event.type === "owner-message") {
    return {
      ...was,
      reporting: event.merged !== undefined || event.runsBuildOrder === true,
      cutOff: false,
    };
  }
  const answer = was.reporting ? undefined : answerOf(event);
  if (answer === undefined) return was;
  const cutOff = event.type === "turn-failed" && event.reason.kind === "interrupted";
  return { ...was, answer, cutOff };
};

/**
 * What a session waits on the owner for: the approval its turn waits on; else its last turn, cut
 * off by a restart under a day ago (#186), until Continue or a new message, seen or not; else its
 * latest answer, while the owner hasn't seen it (`seen`, the event number its page last showed up
 * to, on any device), it's under a day old, no turn runs or waits for a slot, and it has no pull
 * request (whose own rows say what waits); else nothing.
 */
export const sessionWaiting = (session: {
  now: TurnNow;
  queued: boolean;
  pullRequest: PullRequest | undefined;
  answer: Answer | undefined;
  cutOff: boolean;
  seen: number;
  clock: number;
}): SessionWaiting => {
  if (session.now.kind === "needs-you") return "approval";
  const { answer } = session;
  const recent = answer !== undefined && session.clock - Date.parse(answer.at) < NEW_REPLY_MS;
  const free = session.now.kind === "your-turn" && !session.queued;
  if (free && recent && session.cutOff) return "cut-off";
  const newReply =
    free &&
    recent &&
    session.pullRequest === undefined &&
    answer !== undefined &&
    answer.seq > session.seen;
  return newReply ? "reply" : "nothing";
};

/** Needs you's order (#301): approvals, turns cut off, failing checks, replies, merges, conflicts. */
const NEEDS_ORDER: readonly NeedYou["kind"][] = [
  "approval",
  "cut-off",
  "failed",
  "reply",
  "merge",
  "conflict",
];

/**
 * Everything waiting on the owner in every workspace (#492), from each one's listed sessions: what
 * each session waits for, and what its pull request does, in Needs you's order, the newest first
 * in each. A pull request no session opened is its code workspace's own Needs you's to show.
 */
export const needsYouOf = (
  listed: readonly {
    readonly workspace: WorkspaceSummary;
    readonly sessions: CodeSessionList["sessions"];
  }[],
): NeedsYou => {
  const needs = listed.flatMap(({ workspace, sessions }) =>
    sessions.flatMap((session): NeedYou[] => {
      const where = {
        workspace: { id: workspace.id, name: workspace.name },
        session: { id: session.id, title: session.title },
      };
      const since = session.now.kind === "needs-you" ? session.now.since : session.updatedAt;
      const own: NeedYou[] =
        session.waiting === "nothing" ? [] : [{ kind: session.waiting, ...where, since }];
      const { pullRequest } = session;
      const pull = pullRequest === undefined ? "nothing" : pullRequestWaiting(pullRequest, session);
      if (pullRequest === undefined || pull === "nothing") return own;
      return [
        ...own,
        {
          kind: pull,
          ...where,
          since: session.updatedAt,
          pullRequest: {
            number: pullRequest.number,
            ...(pullRequest.title === undefined ? {} : { title: pullRequest.title }),
          },
        },
      ];
    }),
  );
  return {
    needs: needs.sort(
      (a, b) =>
        NEEDS_ORDER.indexOf(a.kind) - NEEDS_ORDER.indexOf(b.kind) ||
        Date.parse(b.since) - Date.parse(a.since),
    ),
    busy: listed.some(({ sessions }) =>
      sessions.some((session) => session.now.kind !== "your-turn"),
    ),
  };
};

/**
 * What an open pull request waits on the owner for: its conflict with its base, unless its
 * session is bringing it up to date (#382); its failing checks, unless its session is working on
 * them (#172); a merge once its checks pass; else nothing (its checks still running, say).
 */
export const pullRequestWaiting = (
  pullRequest: PullRequest,
  session: { readonly now: TurnNow } | undefined,
): PullRequestWaiting => {
  if (pullRequest.state !== "open") return "nothing";
  if (pullRequest.conflicts === true) {
    return session?.now.kind === "working" ? "nothing" : "conflict";
  }
  if (pullRequest.checks.kind === "failed") {
    return session?.now.kind === "working" ? "nothing" : "failed";
  }
  return pullRequest.checks.kind === "passed" ? "merge" : "nothing";
};
