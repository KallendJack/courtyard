import { useState } from "react";

/**
 * Something the owner does that asks the worker (saving a name, starting a session). `action`
 * returns an error to show, or nothing once it's done. `run` says whether it worked; while it's
 * running `busy` is true, so its button shows it's working (#330), and `running` holds what it
 * was run with, so of several buttons on one action, the one tapped is the busy one.
 */
export const useAction = <A extends unknown[]>(
  action: (...args: A) => Promise<string | undefined>,
) => {
  const [running, setRunning] = useState<A>();
  const [error, setError] = useState<string>();

  const run = async (...args: A) => {
    setRunning(args);
    try {
      const problem = await action(...args);
      setError(problem);
      return problem === undefined;
    } finally {
      setRunning(undefined);
    }
  };

  return { run, busy: running !== undefined, running, error, setError };
};
