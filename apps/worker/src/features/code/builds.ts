import { type BuildsLock, HELD_ENV, type Place, takePlace } from "@courtyard/builds";
import type { SessionId } from "@courtyard/contract";

/**
 * What a code session's commands run with: its builds only run once the queue has given them a
 * place in the machine's builds lock (#306), so the repo's own scripts they run (`pnpm verify`)
 * don't wait for one again.
 */
export const BUILD_HELD_ENV = HELD_ENV;

/** A build with its turn in the queue: the session it's in, and its command. */
type Build = {
  readonly id: SessionId;
  readonly command: string;
  /** Its place in the machine's lock, once taken. */
  place: Place | null;
  /** Ends its wait for a place, when it leaves the queue before it has one. */
  readonly cancel: AbortController;
};

/** A build waiting its turn, told how many are ahead of it as that changes. */
type Waiting = {
  readonly id: SessionId;
  readonly command: string;
  readonly signal: AbortSignal;
  readonly start: (started: boolean) => void;
  readonly ahead: (ahead: number) => void;
  told: number;
};

/**
 * The builds queue (#281): the heavy checks code sessions run (`isBuild`), up to `atOnce` at a
 * time, so several sessions building together can't lock the machine up. A build beyond that
 * waits, first come first served between sessions, until one ends. The build at the front then
 * takes a place in the machine's builds lock (#306), which the repo's own scripts take too, so it
 * also waits while builds started outside Courtyard (a helper's `pnpm verify`) hold every place.
 * The order lives only in the worker's memory; a place a worker that stopped left behind is
 * cleared by the next build that waits for it.
 */
export const createBuildsQueue = (lock: BuildsLock) => {
  const running: Build[] = [];
  const waiting: Waiting[] = [];

  /** Takes a place in the machine's lock for a build at the front, then starts it. */
  const claim = async (next: Waiting, build: Build) => {
    const signal = AbortSignal.any([next.signal, build.cancel.signal]);
    const place = await takePlace(lock, {
      label: `Courtyard session ${next.id}`,
      signal,
      waiting: (holders) => {
        if (holders.length === next.told) return;
        next.told = holders.length;
        next.ahead(holders.length);
      },
    });
    if (place === null || !running.includes(build)) {
      place?.free();
      const at = running.indexOf(build);
      if (at !== -1) running.splice(at, 1);
      next.start(false);
      moveOn();
      return;
    }
    build.place = place;
    next.start(true);
  };

  /**
   * Starts the builds waiting while there's room, and tells the rest how many are ahead. A
   * session runs one at a time, whatever the room (#117): its helpers share its folder and slot,
   * so a build of its own waits for the one it has running.
   */
  const moveOn = () => {
    while (running.length < lock.atOnce) {
      const at = waiting.findIndex((build) => !running.some((each) => each.id === build.id));
      const next = at === -1 ? undefined : waiting.splice(at, 1)[0];
      if (next === undefined) break;
      const build: Build = {
        id: next.id,
        command: next.command,
        place: null,
        cancel: new AbortController(),
      };
      running.push(build);
      void claim(next, build);
    }
    waiting.forEach((build, at) => {
      const ahead = running.length + at;
      if (ahead === build.told) return;
      build.told = ahead;
      build.ahead(ahead);
    });
  };

  /** Takes a build out of the queue, freeing its place or ending its wait for one. */
  const free = (build: Build) => {
    const at = running.indexOf(build);
    if (at !== -1) running.splice(at, 1);
    build.place?.free();
    build.cancel.abort();
  };

  return {
    /**
     * Starts a session's build once nobody is ahead of it and it has a place in the machine's
     * lock, telling `ahead` how many builds are ahead whenever that changes while it waits.
     * `true` once it has started, `false` when it was stopped while waiting, leaving the queue.
     */
    start: (build: {
      id: SessionId;
      command: string;
      signal: AbortSignal;
      ahead: (ahead: number) => void;
    }): Promise<boolean> => {
      if (build.signal.aborted) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        const entry: Waiting = {
          id: build.id,
          command: build.command,
          signal: build.signal,
          start: resolve,
          ahead: build.ahead,
          told: 0,
        };
        waiting.push(entry);
        build.signal.addEventListener(
          "abort",
          () => {
            const at = waiting.indexOf(entry);
            if (at === -1) return;
            waiting.splice(at, 1);
            resolve(false);
            moveOn();
          },
          { once: true },
        );
        moveOn();
      });
    },

    /**
     * Frees a build of a session's that has ended, by its command, starting the next waiting.
     * Only one that has started: a build still taking its place can't have ended, so an end heard
     * twice (or of a call of the same command that never ran) never lets it go (#575).
     */
    ended: (id: SessionId, command: string) => {
      const build = running.find(
        (build) => build.id === id && build.command === command && build.place !== null,
      );
      if (build === undefined) return;
      free(build);
      moveOn();
    },

    /**
     * Frees every build a session holds and takes it out of the queue, once its turn has ended
     * (completed, stopped or failed), so no build outlives its turn.
     */
    leave: (id: SessionId) => {
      for (const build of running.filter((build) => build.id === id)) free(build);
      for (let at = waiting.length - 1; at >= 0; at -= 1) {
        const build = waiting[at];
        if (build?.id !== id) continue;
        waiting.splice(at, 1);
        build.start(false);
      }
      moveOn();
    },
  };
};

export type BuildsQueue = ReturnType<typeof createBuildsQueue>;
