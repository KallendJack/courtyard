import {
  type BuildIssue,
  NextUp,
  type PaperConnecting,
  PaperFileList,
  SessionSummary,
  WorkspaceConnections,
  type WorkspaceId,
  WorkspaceMain,
} from "@courtyard/contract";
import { fromWorker, sendJson } from "../worker.ts";

// A code workspace's Home's calls (#301, #308) live with it, so they stay off the first load.

const workspacePath = (workspaceId: WorkspaceId) =>
  `/workspaces/${encodeURIComponent(workspaceId)}`;

/**
 * The ready issues nobody has claimed, and those on a Build order line that need grilling first,
 * in milestone order (#301, #363).
 */
export const loadNextUp = (workspaceId: WorkspaceId) =>
  fromWorker(`${workspacePath(workspaceId)}/next-up`, NextUp);

/**
 * Build (#298): a new code session builds the issue, which the worker claims on GitHub; or Grill
 * (#363): a new code session grills one that isn't ready yet.
 */
export const startOnIssue = (start: {
  workspaceId: WorkspaceId;
  number: number;
  does: "build" | "grill";
  model: BuildIssue;
}) =>
  sendJson({
    path: `${workspacePath(start.workspaceId)}/next-up/${start.number}/${start.does}`,
    body: start.model,
    schema: SessionSummary,
  });

/** The workspace's main: its newest commit and that commit's build (#301's Main row). */
export const loadMain = (workspaceId: WorkspaceId) =>
  fromWorker(`${workspacePath(workspaceId)}/main`, WorkspaceMain);

/** The workspace's connections: GitHub and its Paper file (#308). */
export const loadConnections = (workspaceId: WorkspaceId) =>
  fromWorker(`${workspacePath(workspaceId)}/connections`, WorkspaceConnections);

/** The owner's Paper files, to pick the workspace's one from (#308). */
export const loadPaperFiles = (workspaceId: WorkspaceId) =>
  fromWorker(`${workspacePath(workspaceId)}/connections/paper/files`, PaperFileList);

/** Connects the workspace's one Paper file: one picked, or a new one made (#308). */
export const connectPaper = (workspaceId: WorkspaceId, connecting: PaperConnecting) =>
  sendJson({
    path: `${workspacePath(workspaceId)}/connections/paper`,
    body: connecting,
    schema: WorkspaceConnections,
  });
