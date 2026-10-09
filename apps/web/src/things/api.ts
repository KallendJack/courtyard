import type { SessionId } from "@courtyard/contract";
import { z } from "zod";
import { sendJson } from "../worker.ts";

// Things' calls live with Things rather than in worker.ts, so their schemas stay off the first
// load.

/** Undoes one of a session's Thing saves, named by its event number (ADR 0020). */
export const undoThingSave = (sessionId: SessionId, save: number) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/things/${save}/undo`,
    body: {},
    schema: z.unknown(),
  });
