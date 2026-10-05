import { Health } from "@courtyard/contract";
import { useEffect, useRef, useState } from "react";

/** Whether the worker answered its last health check: not yet known, down, or up. */
export type Reachability = "checking" | "down" | "up";

const healthCheck = async (signal: AbortSignal) => {
  try {
    const response = await fetch("/api/health", { signal });
    return Health.safeParse(await response.json()).success;
  } catch {
    return false;
  }
};

/**
 * Checks the worker's health every `everyMs` while `watching`, one check at a time, and calls
 * `onBack` when it answers again after being down. A worker that was never down doesn't count as
 * coming back, so a page that's broken for another reason never reloads itself in a loop.
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
      const up = await healthCheck(stop.signal);
      if (stop.signal.aborted) return;
      setReachability(up ? "up" : "down");
      if (up && wasDown) onBack.current();
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
