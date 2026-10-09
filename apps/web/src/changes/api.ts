import { type ChangeId, RecentChanges, Undone } from "@courtyard/contract";
import { type ContextPlace, fromWorker, sendJson } from "../worker.ts";

// Recent changes' calls live with it rather than in worker.ts, so their schemas stay off the
// first load.

/** A page of a workspace's or the owner context's Recent changes, after the change `after`. */
export const loadChanges = (about: ContextPlace, after?: ChangeId) => {
  const place =
    about.kind === "owner" ? "/owner-context" : `/workspaces/${encodeURIComponent(about.id)}`;
  return fromWorker(
    `${place}/changes${after === undefined ? "" : `?after=${after}`}`,
    RecentChanges,
  );
};

/** Undoes a change from Recent changes, or a document's delete from its workspace's page. */
export const undoChange = (id: ChangeId) =>
  sendJson({ path: `/changes/${id}/undo`, body: {}, schema: Undone });
