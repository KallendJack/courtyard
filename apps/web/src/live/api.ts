import { LiveStatus } from "@courtyard/contract";
import { z } from "zod";
import { fromWorker, sendJson } from "../worker.ts";

// The live copy's calls live with its pieces rather than in worker.ts, so they and their schemas
// stay off the first load (#249).

/** Whether this worker can update itself from the app, what's newer, and main's build. */
export const loadLive = () => fromWorker("/live", LiveStatus);

/** Starts updating the live copy; the worker restarts partway through. */
export const startLiveUpdate = () =>
  sendJson({ path: "/live/update", body: {}, schema: z.unknown() });
