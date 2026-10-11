import { Health } from "@courtyard/contract";
import { useEffect, useRef, useState } from "react";
import { untilAnswered } from "./worker.ts";

/** Whether the worker answered its last health check: not yet known, down, or up. */
export type Reachability = "checking" | "down" | "up";

/**
 * Checks the worker's health every `everyMs` while `watching`, one check at a time, waiting for a
 * worker that's slow to answer (#228), and calls `onBack` when it answers again after it didn't:
 * in an earlier check, or on an earlier try of this one. A worker that always answered doesn't
 * count as coming back, so a page that's broken for another reason never reloads itself in a loop.
 */
export const useWorkerWatch = (watch: {
  watching: boolean;
  everyMs: number;
  onBack: () => void;
}): Reachability => {
  const [reachability, setReachability] = useState<Reachability>("checking");
  const onBack = useRef(watch.onBack);
  onBack.current = watch.onBack;

  useEffect(() => {
    if (!watch.watching) return;
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasDown = false;

    const check = async () => {
      let tries = 0;
      const response = await untilAnswered(() => {
        tries += 1;
        return fetch("/api/health", { signal: stop.signal });
      }, stop.signal);
      const up = Health.safeParse(await response?.json().catch(() => null)).success;
      if (stop.signal.aborted) return;
      setReachability(up ? "up" : "down");
      if (up && (wasDown || tries > 1)) onBack.current();
      wasDown = !up;
      timer = setTimeout(check, watch.everyMs);
    };
    void check();

    return () => {
      stop.abort();
      clearTimeout(timer);
    };
  }, [watch.watching, watch.everyMs]);

  return reachability;
};
