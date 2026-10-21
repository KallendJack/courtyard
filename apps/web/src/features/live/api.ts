import {
  LiveStatus,
  type LiveUpdateRequest,
  LiveUpdateStarted,
  type WhatsNewSeen,
} from "@courtyard/contract";
import { z } from "zod";
import { fromWorker, sendJson } from "../../api/worker.ts";

// The live copy's calls live with its pieces rather than in worker.ts, so they and their schemas
// stay off the first load (#249).

/** Whether this worker can update itself from the app, what's newer, and main's build. */
export const loadLive = () => fromWorker("/live", LiveStatus);

/**
 * Update (#186): starts updating the live copy, the worker restarting partway through; or, while
 * main's build runs or a session is mid-turn, waits, and the worker runs it once both are clear.
 * `now` runs it at once.
 */
export const startLiveUpdate = (now = false) =>
  sendJson({
    path: "/live/update",
    body: (now ? { now } : {}) satisfies LiveUpdateRequest,
    schema: LiveUpdateStarted,
  });

/** A what's-new line tapped (#604): said, and gone. */
export const markWhatsNewSeen = (pullRequest: number) =>
  sendJson({
    path: "/live/whats-new/seen",
    body: { pullRequest } satisfies WhatsNewSeen,
    schema: z.unknown(),
  });

/** Cancel (#186): the Update waiting no longer waits. */
export const cancelLiveUpdate = () =>
  sendJson({ path: "/live/update", method: "DELETE", body: {}, schema: z.unknown() });
