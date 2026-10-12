import type { SessionId, SessionSeen } from "@courtyard/contract";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { sendJson } from "../worker.ts";

/**
 * Tells the worker the owner has seen the session up to event `upTo` (#334): what the page shows,
 * once no turn runs and while the page is in view. The worker decides what that clears (a new
 * reply, on every device); the page only says what it showed.
 */
export const useSeen = (sessionId: SessionId, upTo: number, running: boolean) => {
  const told = useRef(0);
  useEffect(() => {
    if (running || upTo === 0) return;
    const tell = () => {
      if (document.visibilityState !== "visible" || told.current >= upTo) return;
      told.current = upTo;
      void sendJson({
        path: `/sessions/${encodeURIComponent(sessionId)}/seen`,
        body: { upTo } satisfies SessionSeen,
        schema: z.unknown(),
      });
    };
    tell();
    // Shown while the page was hidden, it's seen once the owner comes back to it.
    document.addEventListener("visibilitychange", tell);
    return () => document.removeEventListener("visibilitychange", tell);
  }, [sessionId, upTo, running]);
};
