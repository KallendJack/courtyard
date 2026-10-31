import type { PullRequest, SessionEvent, SessionId } from "@courtyard/contract";

/**
 * Following code sessions' pull requests (#172): whether one changed, whether its checks failed
 * again, and when to try again to clear a worktree that wouldn't go.
 */

/** Whether a pull request is as it was last recorded, so nothing about it changed. */
export const samePullRequest = (now: PullRequest, was: PullRequest | undefined) =>
  was !== undefined &&
  now.number === was.number &&
  now.title === was.title &&
  now.url === was.url &&
  now.state === was.state &&
  now.head === was.head &&
  // One recorded before conflicts were (#278) didn't conflict.
  (now.conflicts ?? false) === (was.conflicts ?? false) &&
  // One recorded before drafts were (#653) wasn't one.
  (now.draft ?? false) === (was.draft ?? false) &&
  JSON.stringify(now.changes) === JSON.stringify(was.changes) &&
  JSON.stringify(now.checks) === JSON.stringify(was.checks);

/**
 * Whether an open pull request's checks failed again on a commit its session already had a fixing
 * turn for, having run again since (a re-run, #356): no second fixing turn starts for it.
 */
export const failedAgain = (seen: {
  events: readonly SessionEvent[];
  was: PullRequest | undefined;
  now: PullRequest;
}) => {
  const { was, now } = seen;
  return (
    now.state === "open" &&
    now.checks.kind === "failed" &&
    was?.head === now.head &&
    was.checks.kind !== "failed" &&
    askedToFix(seen.events, now.head, ["checksFailed"])
  );
};

/**
 * Whether the session was already asked to fix commit `head`: its failed checks (#172), or its
 * conflict with its base (#382), or either.
 */
export const askedToFix = (
  events: readonly SessionEvent[],
  head: string,
  about: readonly ("checksFailed" | "conflicted")[] = ["checksFailed", "conflicted"],
) =>
  events.some(
    (event) => event.type === "owner-message" && about.some((each) => event[each]?.head === head),
  );

/** The first wait before trying again to clear a worktree that wouldn't go, and the longest. */
const RETRY_FIRST_MS = 60_000;
const RETRY_MOST_MS = 6 * 60 * 60 * 1000;

/**
 * When to try clearing each worktree that wouldn't go again (#605): a program holding it keeps it
 * on Windows, so each try waits twice as long as the last, up to 6 hours, rather than failing
 * every time a job runs.
 */
export const createClearingRetries = (now: () => number) => {
  const tries = new Map<SessionId, { at: number; wait: number }>();
  return {
    /** Whether to try now: the first time, or once the wait since its last try has passed. */
    due: (id: SessionId) => {
      const tried = tries.get(id);
      return tried === undefined || now() >= tried.at + tried.wait;
    },
    /** Whether it's the first try, which alone deletes its branch on GitHub. */
    first: (id: SessionId) => !tries.has(id),
    /** How a try went: done, or not, so the next waits longer. */
    tried: (id: SessionId, done: boolean) => {
      if (done) {
        tries.delete(id);
        return;
      }
      const wait = Math.min((tries.get(id)?.wait ?? RETRY_FIRST_MS / 2) * 2, RETRY_MOST_MS);
      tries.set(id, { at: now(), wait });
    },
  };
};
