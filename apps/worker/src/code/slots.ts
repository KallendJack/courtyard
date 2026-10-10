import type { SessionId } from "@courtyard/contract";

/**
 * Code sessions running at once (spec #169, stories 5 and 6): up to `atOnce` turns in code
 * sessions run at a time across the worker, each holding a numbered slot no other running one
 * holds, which its commands are given so their checks never share test servers' ports. A turn
 * beyond that waits, first come first served, until one ends.
 */
export const createCodeSlots = (atOnce: number) => {
  /** Each running code session's slot, from 1. */
  const held = new Map<SessionId, number>();
  const waiting: { readonly id: SessionId; readonly start: (slot: number) => void }[] = [];

  const free = () => {
    const taken = new Set(held.values());
    for (let slot = 1; slot <= atOnce; slot += 1) if (!taken.has(slot)) return slot;
    return undefined;
  };

  return {
    /**
     * A slot for a session's turn: at once when one is free and nobody is waiting (`queued`
     * false), or once the turns ahead of it end. `undefined` when it's stopped while waiting.
     */
    take: (id: SessionId, signal: AbortSignal) => {
      const slot = free();
      if (signal.aborted) return { queued: false, slot: Promise.resolve(undefined) };
      if (slot !== undefined && waiting.length === 0) {
        held.set(id, slot);
        return { queued: false, slot: Promise.resolve(slot) };
      }
      const started = new Promise<number | undefined>((resolve) => {
        const entry = { id, start: resolve };
        waiting.push(entry);
        signal.addEventListener(
          "abort",
          () => {
            const at = waiting.indexOf(entry);
            if (at === -1) return;
            waiting.splice(at, 1);
            resolve(undefined);
          },
          { once: true },
        );
      });
      return { queued: true, slot: started };
    },

    /** Frees a session's slot once its turn has ended, starting the next turn waiting. */
    release: (id: SessionId) => {
      if (!held.delete(id)) return;
      const next = waiting.shift();
      const slot = free();
      if (next === undefined || slot === undefined) return;
      held.set(next.id, slot);
      next.start(slot);
    },

    /** Whether a session's turn is waiting for a slot. */
    waits: (id: SessionId) => waiting.some((entry) => entry.id === id),

    /** How many code sessions are running. */
    running: () => held.size,
  };
};

export type CodeSlots = ReturnType<typeof createCodeSlots>;
