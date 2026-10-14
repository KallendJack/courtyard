import type {
  PullRequest,
  PullRequestWaiting,
  SessionEvent,
  SessionWaiting,
  TurnNow,
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
 * What a session waits on the owner for: the approval its turn waits on; else its latest answer,
 * while the owner hasn't seen it (`seen`, the event number its page last showed up to, on any
 * device), it's under a day old, no turn runs or waits for a slot, and it has no pull request
 * (whose own rows say what waits); else nothing.
 */
export const sessionWaiting = (session: {
  now: TurnNow;
  queued: boolean;
  pullRequest: PullRequest | undefined;
  answer: Answer | undefined;
  seen: number;
  clock: number;
}): SessionWaiting => {
  if (session.now.kind === "needs-you") return "approval";
  const { answer } = session;
  const newReply =
    session.now.kind === "your-turn" &&
    !session.queued &&
    session.pullRequest === undefined &&
    answer !== undefined &&
    answer.seq > session.seen &&
    session.clock - Date.parse(answer.at) < NEW_REPLY_MS;
  return newReply ? "reply" : "nothing";
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
