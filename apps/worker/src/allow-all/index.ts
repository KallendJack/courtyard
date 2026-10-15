import {
  ALLOW_ALL_MOST_HOURS,
  type AllowAllLasts,
  type AllowingAll,
  type SessionEvent,
} from "@courtyard/contract";

/**
 * Allow all for this task (#428): whether a code session is allowing all, decided here from its
 * events, so it survives a restart and every screen reads the same. It's on from the owner's tap
 * (or the Lead's start) until the end time stored then, the owner's Turn off, the session ending,
 * or, for "until this task is done", its pull request opening.
 */

const HOUR_MS = 60 * 60 * 1000;

/** How many hours each length lasts at most: "until this task is done" too. */
const HOURS: Readonly<Record<AllowAllLasts, number>> = {
  "1h": 1,
  "4h": 4,
  "12h": 12,
  task: ALLOW_ALL_MOST_HOURS,
};

/** When Allow all turned on at `now` for `lasts` ends at the latest, as an event stores it. */
export const allowAllUntil = (lasts: AllowAllLasts, now: number) =>
  new Date(now + HOURS[lasts] * HOUR_MS).toISOString();

/** When the Lead's builders allow all until (#428): `ALLOW_ALL_MOST_HOURS` from `now`. */
export const buildersAllowAllUntil = (now: number) => allowAllUntil("task", now);

/**
 * A session's Allow all as its events come, one at a time: its pull request as last recorded, and,
 * while it's turned on, until when, whether until the task is done, and the pull request it had
 * then (a new one opening is the task done).
 */
export type AllowAll = {
  readonly pullRequest: { readonly number: number; readonly open: boolean } | undefined;
  readonly on:
    | {
        readonly until: string;
        readonly task: boolean;
        readonly pullRequest: number | undefined;
      }
    | undefined;
};

export const NO_ALLOW_ALL: AllowAll = { pullRequest: undefined, on: undefined };

export const allowAllAfter = (was: AllowAll, event: SessionEvent): AllowAll => {
  switch (event.type) {
    case "allow-all-started":
      return {
        ...was,
        on: { until: event.until, task: event.task, pullRequest: was.pullRequest?.number },
      };
    case "allow-all-ended":
      return { ...was, on: undefined };
    case "pull-request": {
      const { number, state } = event.pullRequest;
      const pullRequest = { number, open: state === "open" };
      // The session ends with its pull request; the task is done once one opens.
      const done = !pullRequest.open || (was.on?.task === true && was.on.pullRequest !== number);
      return { pullRequest, on: done ? undefined : was.on };
    }
    default:
      return was;
  }
};

/** Whether a session is allowing all at `now`, and as its strip shows it, or `undefined`. */
export const allowingAllAt = (state: AllowAll, now: number): AllowingAll | undefined => {
  const { on } = state;
  if (on === undefined || Date.parse(on.until) <= now) return undefined;
  return { until: on.until, task: on.task };
};
