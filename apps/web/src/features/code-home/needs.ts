import {
  type CodeSessionList,
  type LeadMerge,
  type LeadStatus,
  type MattSetup,
  type OpenPullRequest,
  setupLines,
} from "@courtyard/contract";
import { describeWhen } from "../../lib/when.ts";

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
  /**
   * A session waiting on the owner until they answer (#541): the question it asked (in its
   * `question`), a builder's turn failed, or a builder stopped with no pull request.
   */
  | { readonly kind: "asked" | "turn-failed" | "stopped"; readonly session: Listed }
  /** A Lead's builder stalled (#474): its slot is free, and its session kept to look at. */
  | { readonly kind: "stalled"; readonly session: Listed }
  | { readonly kind: "approval"; readonly session: Listed }
  /** Its last turn, cut off by a restart, waits for Continue (#186). */
  | { readonly kind: "cut-off"; readonly session: Listed }
  | { readonly kind: "failed"; readonly pull: OpenPullRequest; readonly count: number }
  | { readonly kind: "reply"; readonly session: Listed }
  /** Its session, when one opened it: a Lead's builder says so (#347). */
  | { readonly kind: "merge"; readonly pull: OpenPullRequest; readonly session?: Listed }
  /**
   * The Lead's builders' pull requests ready to merge, in the build order's order, as one row with
   * Merge in order (#423), and how Merge in order stands, when it's merging or stopped.
   */
  | {
      readonly kind: "merge-in-order";
      readonly pulls: readonly OpenPullRequest[];
      readonly merge: LeadMerge | undefined;
    }
  | { readonly kind: "conflict"; readonly pull: OpenPullRequest; readonly session?: Listed }
  | { readonly kind: "setup"; readonly missing: number };

/**
 * What waits on the owner, as the worker says, in the order the grill set (#301): sessions
 * waiting until the owner answers, by question, failed turn and stop (#541), stalled builders
 * (#474), approvals, turns cut off by a restart (#186), failing checks, new replies, pull
 * requests ready to merge,
 * conflicts, then Matt's setup. The Lead's builders' pull requests it says are ready (#347) are
 * one row with Merge in order (#423), as the Lead's chat offers it, saying how it stands while
 * it's merging or stopped.
 */
export const needsOf = (given: {
  sessions: readonly Listed[];
  pulls: readonly OpenPullRequest[];
  setup: MattSetup;
  /** The workspace's Lead (#347), once known. */
  lead?: LeadStatus | undefined;
}): Need[] => {
  const sessionOf = ({ from }: OpenPullRequest) =>
    from.kind === "session"
      ? given.sessions.find((session) => session.id === from.sessionId)
      : undefined;
  const sessionsWaiting = (on: Listed["waiting"]) =>
    given.sessions.filter((session) => session.waiting === on);
  const pullsWaiting = (on: OpenPullRequest["waiting"]) =>
    given.pulls.filter((pull) => pull.waiting === on);
  const held: Need[] = (["asked", "turn-failed", "stopped"] as const).flatMap((kind) =>
    sessionsWaiting(kind).map((session) => ({ kind, session })),
  );
  const stalled: Need[] = sessionsWaiting("stalled").map((session) => ({
    kind: "stalled",
    session,
  }));
  const approvals: Need[] = sessionsWaiting("approval").map((session) => ({
    kind: "approval",
    session,
  }));
  const cutOff: Need[] = sessionsWaiting("cut-off").map((session) => ({
    kind: "cut-off",
    session,
  }));
  const failed: Need[] = pullsWaiting("failed").map((pull) => ({
    kind: "failed",
    pull,
    count: pull.pullRequest.checks.kind === "failed" ? pull.pullRequest.checks.failed.length : 0,
  }));
  const replies: Need[] = sessionsWaiting("reply").map((session) => ({ kind: "reply", session }));
  const ready = (given.lead?.ready ?? []).flatMap((each) => {
    const pull = given.pulls.find(
      (open) => open.waiting === "merge" && open.pullRequest.number === each.pullRequest,
    );
    return pull === undefined ? [] : [pull];
  });
  const merge = given.lead?.merge;
  const inOrder = ready.length > 0;
  const merges: Need[] = [
    ...(inOrder ? [{ kind: "merge-in-order" as const, pulls: ready, merge }] : []),
    ...pullsWaiting("merge")
      .filter((pull) => !inOrder || !ready.includes(pull))
      .map((pull): Need => {
        const session = sessionOf(pull);
        return session === undefined ? { kind: "merge", pull } : { kind: "merge", pull, session };
      }),
  ];
  const conflicts: Need[] = pullsWaiting("conflict").map((pull) => {
    const session = sessionOf(pull);
    return session === undefined ? { kind: "conflict", pull } : { kind: "conflict", pull, session };
  });
  const setup: Need[] =
    given.setup.state === "offered"
      ? [{ kind: "setup", missing: setupLines(given.setup.card) }]
      : [];
  return [
    ...held,
    ...stalled,
    ...approvals,
    ...cutOff,
    ...failed,
    ...replies,
    ...merges,
    ...conflicts,
    ...setup,
  ];
};

/**
 * A session waiting on the owner: until they answer (#541), a builder stalled, an approval, a turn
 * cut off, or a new reply.
 */
export type SessionNeed = Extract<Need, { readonly session: Listed }>;

const SESSION_NEEDS: ReadonlySet<Need["kind"]> = new Set<SessionNeed["kind"]>([
  "asked",
  "turn-failed",
  "stopped",
  "stalled",
  "approval",
  "cut-off",
  "reply",
]);

const isSessionNeed = (need: Need): need is SessionNeed => SESSION_NEEDS.has(need.kind);

/** The newest session waiting on the owner, which a workspace's tile names (#345). */
export const newestSessionNeed = (needs: readonly Need[]) =>
  needs.reduce<SessionNeed | undefined>(
    (newest, need) =>
      isSessionNeed(need) &&
      (newest === undefined || need.session.updatedAt > newest.session.updatedAt)
        ? need
        : newest,
    undefined,
  );

/** Whether a session waits on the owner until they answer (#541): asked, failed or stopped. */
export const waitsUntilAnswered = (session: { readonly waiting: Listed["waiting"] }) =>
  session.waiting === "asked" || session.waiting === "turn-failed" || session.waiting === "stopped";

/**
 * What a session waits on the owner for until they answer (#541), in a few words, with " · seen"
 * once they've read it: "Asks: which search to use? · seen", "Failed", "Stopped, no PR";
 * `undefined` for one that doesn't.
 */
export const heldWords = (session: Listed) => {
  const seen = session.seen === true ? " · seen" : "";
  switch (session.waiting) {
    case "asked":
      return `Asks: ${session.question?.text ?? "a question"}${seen}`;
    case "turn-failed":
      return `Failed${seen}`;
    case "stopped":
      return `Stopped, no PR${seen}`;
    default:
      return undefined;
  }
};

/** Sessions waiting on the owner first, as the worker says (#345), each part in its own order. */
export const waitingFirst = <T extends { readonly waiting: Listed["waiting"] }>(
  sessions: readonly T[],
) => [
  ...sessions.filter((session) => session.waiting !== "nothing"),
  ...sessions.filter((session) => session.waiting === "nothing"),
];
