import type { SessionId } from "@courtyard/contract";

/** A build running: the session it's in, and its command. */
type Build = { readonly id: SessionId; readonly command: string };

/** A build waiting its turn, told how many are ahead of it as that changes. */
type Waiting = Build & {
  readonly start: (started: boolean) => void;
  readonly ahead: (ahead: number) => void;
  told: number;
};

/**
 * The builds queue (#281): the heavy checks code sessions run (`isBuild`), up to `atOnce` at a
 * time across the worker, so several sessions building together can't lock the machine up. A
 * build beyond that waits, first come first served, until one ends. It lives only in the worker's
 * memory, so a worker that restarts holds nothing.
 */
export const createBuildsQueue = (atOnce: number) => {
  const running: Build[] = [];
  const waiting: Waiting[] = [];

  /** Starts the builds waiting while there's room, and tells the rest how many are ahead. */
  const moveOn = () => {
    while (running.length < atOnce) {
      const next = waiting.shift();
      if (next === undefined) break;
      running.push({ id: next.id, command: next.command });
      next.start(true);
    }
    waiting.forEach((build, at) => {
      const ahead = running.length + at;
      if (ahead === build.told) return;
      build.told = ahead;
      build.ahead(ahead);
    });
  };

  return {
    /**
     * Starts a session's build: at once when there's room and nobody is waiting, or once the
     * builds ahead of it end, telling `ahead` how many there are whenever that changes. `true`
     * once it has started, `false` when it was stopped while waiting, leaving the queue.
     */
    start: (build: {
      id: SessionId;
      command: string;
      signal: AbortSignal;
      ahead: (ahead: number) => void;
    }): Promise<boolean> => {
      if (build.signal.aborted) return Promise.resolve(false);
      if (running.length < atOnce && waiting.length === 0) {
        running.push({ id: build.id, command: build.command });
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        const entry: Waiting = {
          id: build.id,
          command: build.command,
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

    /** Frees a build of a session's that has ended, by its command, starting the next waiting. */
    ended: (id: SessionId, command: string) => {
      const at = running.findIndex((build) => build.id === id && build.command === command);
      if (at === -1) return;
      running.splice(at, 1);
      moveOn();
    },

    /**
     * Frees every build a session holds and takes it out of the queue, once its turn has ended
     * (completed, stopped or failed), so no build outlives its turn.
     */
    leave: (id: SessionId) => {
      for (let at = running.length - 1; at >= 0; at -= 1) {
        if (running[at]?.id === id) running.splice(at, 1);
      }
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
