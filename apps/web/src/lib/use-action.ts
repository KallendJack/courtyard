import { useState } from "react";

/**
 * Something the owner does that asks the worker (saving a name, starting a session). `action`
 * returns an error to show, or nothing once it's done. `run` says whether it worked; while it's
 * running `busy` is true, so its button can wait.
 */
export const useAction = <A extends unknown[]>(
  action: (...args: A) => Promise<string | undefined>,
) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (...args: A) => {
    setBusy(true);
    try {
      const problem = await action(...args);
      setError(problem);
      return problem === undefined;
    } finally {
      setBusy(false);
    }
  };

  return { run, busy, error, setError };
};
