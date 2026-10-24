import { type SessionId, Undone } from "@courtyard/contract";
import { sendJson } from "../../api/worker.ts";

// A planning workspace's Builds' calls (#697), beside them so they stay off the first load. The
// Fabrication app (#698) reads Builds through Fabrication's own API.

/** Undoes one of a session's Build saves, named by its event number (#697). */
export const undoBuildSave = (sessionId: SessionId, save: number) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/builds/${save}/undo`,
    body: {},
    schema: Undone,
  });
