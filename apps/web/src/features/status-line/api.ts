import { StatusLine, type StatusLineChange, type WorkspaceId } from "@courtyard/contract";
import { fromWorker, sendJson } from "../../api/worker.ts";
import { createKept } from "../../components/layout/kept.tsx";

// The status line's calls (#256), beside it so their schemas stay off the first load.

const lineOf = (workspaceId: WorkspaceId) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/status-line`;

/** Each workspace's status line as last heard, by its id, so a revisit shows it at once. */
export const KEPT_STATUS_LINE = createKept<StatusLine>();

/** A workspace's status line. */
export const loadStatusLine = (workspaceId: WorkspaceId) =>
  fromWorker(lineOf(workspaceId), StatusLine);

/** The owner's Done, Edit or Remove: the line as it is then. */
export const changeStatusLine = (workspaceId: WorkspaceId, change: StatusLineChange) =>
  sendJson({ path: lineOf(workspaceId), method: "POST", body: change, schema: StatusLine });
