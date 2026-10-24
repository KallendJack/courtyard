import { useEffect } from "react";

/**
 * Keeps the screen awake while `wanted` (#206): while the owner talks to Courtyard, and while an
 * answer comes. The browser lets go of it when Courtyard goes out of sight, so it's asked for again
 * when Courtyard comes back. Where the browser has no wake lock, or says no, the screen sleeps as
 * it would.
 */
export function useWakeLock(wanted: boolean) {
  useEffect(() => {
    if (!wanted || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | undefined;
    let over = false;
    const take = () => {
      if (document.visibilityState !== "visible" || (lock !== undefined && !lock.released)) return;
      navigator.wakeLock.request("screen").then(
        (taken) => {
          if (over) void taken.release().catch(() => {});
          else lock = taken;
        },
        () => {},
      );
    };
    take();
    document.addEventListener("visibilitychange", take);
    return () => {
      over = true;
      document.removeEventListener("visibilitychange", take);
      void lock?.release().catch(() => {});
    };
  }, [wanted]);
}
