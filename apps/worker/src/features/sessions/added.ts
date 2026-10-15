import type { AddedMessage, AddedMessages } from "../../providers/index.ts";

/**
 * A running turn's inbox for what the owner adds to it (#252): the worker reserves a place for
 * each message as it's sent, puts it in once it's recorded, and the turn's provider takes them
 * (`AddedMessages`). The provider's `done` waits for any message with a place reserved, so one
 * sent as the answer finishes still goes in; the turn being stopped, or its end, closes it at once.
 */
export type AddedInbox = {
  /** What the provider is given. */
  readonly messages: AddedMessages;
  /**
   * Reserves a place for one message the owner sent, before it's recorded: `false` when it takes
   * no more. Each place is then filled (`add`) or given up (`release`).
   */
  readonly reserve: () => boolean;
  /** Puts a reserved message in: `false` when the turn ended meanwhile, so it wasn't taken. */
  readonly add: (added: AddedMessage) => boolean;
  /** Gives up a reserved place, the message never recorded. */
  readonly release: () => void;
  /** Closes it, answering those the model never read, in the order they were sent. */
  readonly close: () => readonly AddedMessage[];
};

export const createAddedInbox = (signal: AbortSignal): AddedInbox => {
  const all: AddedMessage[] = [];
  const waiting: AddedMessage[] = [];
  const read = new Set<number>();
  let open = true;
  /** The provider has said it takes no more, once the places reserved are filled. */
  let doneAsked = false;
  let reserved = 0;
  /** The provider's calls to `next`, each waiting for the owner's next message. */
  const waiters: ((added: AddedMessage | undefined) => void)[] = [];

  const shut = () => {
    open = false;
    for (const waiter of waiters.splice(0)) waiter(undefined);
  };
  const shutIfDone = () => {
    if (doneAsked && reserved === 0) shut();
  };
  signal.addEventListener("abort", shut, { once: true });

  return {
    messages: {
      next: () => {
        const first = waiting.shift();
        if (first !== undefined) return Promise.resolve(first);
        if (!open) return Promise.resolve(undefined);
        return new Promise((resolve) => {
          waiters.push(resolve);
        });
      },
      waiting: () => waiting.splice(0),
      read: (added) => {
        read.add(added.seq);
      },
      done: () => {
        doneAsked = true;
        shutIfDone();
      },
    },
    reserve: () => {
      if (!open || doneAsked) return false;
      reserved += 1;
      return true;
    },
    add: (added) => {
      reserved -= 1;
      if (!open) return false;
      all.push(added);
      const waiter = waiters.shift();
      if (waiter === undefined) waiting.push(added);
      else waiter(added);
      shutIfDone();
      return true;
    },
    release: () => {
      reserved -= 1;
      shutIfDone();
    },
    close: () => {
      shut();
      signal.removeEventListener("abort", shut);
      return all.filter((added) => !read.has(added.seq));
    },
  };
};
