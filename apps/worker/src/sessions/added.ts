import type { AddedMessage, AddedMessages } from "../providers/index.ts";

/**
 * A running turn's inbox for what the owner adds to it (#252): the worker puts each message in as
 * it's recorded, and the turn's provider takes them (`AddedMessages`). Once closed, by the
 * provider's `done`, the turn being stopped, or its end, it takes no more.
 */
export type AddedInbox = {
  /** What the provider is given. */
  readonly messages: AddedMessages;
  /** Whether it still takes messages. */
  readonly open: () => boolean;
  /** Puts one in, as the owner sent it: `false` when it takes no more. */
  readonly add: (added: AddedMessage) => boolean;
  /** Closes it, answering those the model never read, in the order they were sent. */
  readonly close: () => readonly AddedMessage[];
};

export const createAddedInbox = (signal: AbortSignal): AddedInbox => {
  const all: AddedMessage[] = [];
  const waiting: AddedMessage[] = [];
  const read = new Set<number>();
  let open = true;
  /** The provider's `next`, waiting for the owner's next message. */
  let wake: ((added: AddedMessage | undefined) => void) | undefined;

  const shut = () => {
    open = false;
    const waiter = wake;
    wake = undefined;
    waiter?.(undefined);
  };
  signal.addEventListener("abort", shut, { once: true });

  return {
    messages: {
      next: () => {
        const first = waiting.shift();
        if (first !== undefined) return Promise.resolve(first);
        if (!open) return Promise.resolve(undefined);
        return new Promise((resolve) => {
          wake = resolve;
        });
      },
      waiting: () => waiting.splice(0),
      read: (added) => {
        read.add(added.seq);
      },
      done: shut,
    },
    open: () => open,
    add: (added) => {
      if (!open) return false;
      all.push(added);
      const waiter = wake;
      wake = undefined;
      if (waiter === undefined) waiting.push(added);
      else waiter(added);
      return true;
    },
    close: () => {
      shut();
      signal.removeEventListener("abort", shut);
      return all.filter((added) => !read.has(added.seq));
    },
  };
};
