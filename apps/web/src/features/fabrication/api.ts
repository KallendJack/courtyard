import { type SessionId, Undone } from "@courtyard/contract";
import { sendJson } from "../../api/worker.ts";

// A planning workspace's Builds' and sizes' calls (#697, #708), beside them so they stay off the
// first load. The Fabrication app (#698) reads them through Fabrication's own API.

/** Undoes one of a session's Build (#697) or size (#708) saves, named by its event number. */
const undoFileSave = (files: "builds" | "sizes") => (sessionId: SessionId, save: number) =>
  sendJson({
    path: `/sessions/${encodeURIComponent(sessionId)}/${files}/${save}/undo`,
    body: {},
    schema: Undone,
  });

export const undoBuildSave = undoFileSave("builds");
export const undoSizeSave = undoFileSave("sizes");
