import {
  type BuildIssue,
  NextUp,
  type PaperConnecting,
  PaperFileList,
  SessionSummary,
  WorkspaceConnections,
  type WorkspaceId,
} from "@courtyard/contract";
import { fromWorker, sendJson } from "../worker.ts";

// A code workspace's Home's calls (#301, #308) live with it, so they stay off the first load.

const workspacePath = (workspaceId: WorkspaceId) =>
  `/workspaces/${encodeURIComponent(workspaceId)}`;

/** The ready issues nobody has claimed, in milestone order (#301). */
export const loadNextUp = (workspaceId: WorkspaceId) =>
  fromWorker(`${workspacePath(workspaceId)}/next-up`, NextUp);

/** Build (#298): a new code session builds the issue, which the worker claims on GitHub. */
export const buildIssue = (workspaceId: WorkspaceId, number: number, build: BuildIssue) =>
  sendJson({
    path: `${workspacePath(workspaceId)}/next-up/${number}/build`,
    body: build,
    schema: SessionSummary,
  });

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
