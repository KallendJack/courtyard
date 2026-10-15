import type { SessionId } from "@courtyard/contract";

/** A turn waiting for a slot, told how many turns wait ahead of it as that changes. */
type Waiting = {
  readonly id: SessionId;
  readonly start: (slot: number | undefined) => void;
  readonly ahead: (ahead: number) => void;
};

/**
 * Code sessions running at once (spec #169, stories 5 and 6): up to `atOnce` turns in code
 * sessions run at a time across the worker, each holding a numbered slot no other running one
 * holds, which its commands are given so their checks never share test servers' ports. A turn
 * beyond that waits, first come first served, until one ends.
 */
export const createCodeSlots = (atOnce: number) => {
  /** Each running code session's slot, from 1. */
  const held = new Map<SessionId, number>();
  const waiting: Waiting[] = [];

  const free = () => {
    const taken = new Set(held.values());
    for (let slot = 1; slot <= atOnce; slot += 1) if (!taken.has(slot)) return slot;
    return undefined;
  };

  /** Tells the turns still waiting behind `from` that one fewer is ahead of each (#362). */
  const moveUp = (from: number) => {
    waiting.slice(from).forEach((entry, at) => {
      entry.ahead(from + at);
    });
  };

  return {
    /**
     * A slot for a session's turn: at once when one is free and nobody is waiting (`queued`
     * false), or once the turns ahead of it end, with how many wait ahead of it now (`ahead`),
     * telling `moved` each time that changes. `undefined` when it's stopped while waiting.
     */
    take: (take: { id: SessionId; signal: AbortSignal; moved: (ahead: number) => void }) => {
      const { id, signal } = take;
      const slot = free();
      if (signal.aborted) return { queued: false, ahead: 0, slot: Promise.resolve(undefined) };
      if (slot !== undefined && waiting.length === 0) {
        held.set(id, slot);
        return { queued: false, ahead: 0, slot: Promise.resolve(slot) };
      }
      const ahead = waiting.length;
      const started = new Promise<number | undefined>((resolve) => {
        const entry: Waiting = { id, start: resolve, ahead: take.moved };
        waiting.push(entry);
        signal.addEventListener(
          "abort",
          () => {
            const at = waiting.indexOf(entry);
            if (at === -1) return;
            waiting.splice(at, 1);
            resolve(undefined);
            moveUp(at);
          },
          { once: true },
        );
      });
      return { queued: true, ahead, slot: started };
    },

    /** Frees a session's slot once its turn has ended, starting the next turn waiting. */
    release: (id: SessionId) => {
      if (!held.delete(id)) return;
      const slot = free();
      if (waiting.length === 0 || slot === undefined) return;
      const next = waiting.shift();
      if (next === undefined) return;
      held.set(next.id, slot);
      next.start(slot);
      moveUp(0);
    },

    /** Whether a session's turn is waiting for a slot. */
    waits: (id: SessionId) => waiting.some((entry) => entry.id === id),

    /** How many code sessions are running. */
    running: () => held.size,
  };
};

export type CodeSlots = ReturnType<typeof createCodeSlots>;
