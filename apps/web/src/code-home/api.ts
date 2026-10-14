import {
  type BuildIssue,
  type LeadRun,
  LeadStatus,
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

/** The workspace's Lead (#347): where it stands, its builders, what's next and what's ready. */
export const loadLead = (workspaceId: WorkspaceId) =>
  fromWorker(`${workspacePath(workspaceId)}/lead`, LeadStatus);

/** Run the build order (#347): the Lead starts on this model, or wakes. */
export const runLead = (workspaceId: WorkspaceId, model: LeadRun) =>
  sendJson({ path: `${workspacePath(workspaceId)}/lead/run`, body: model, schema: LeadStatus });

/** Pause the Lead (#347): its builders carry on, and nothing new starts. */
export const pauseLead = (workspaceId: WorkspaceId) =>
  sendJson({ path: `${workspacePath(workspaceId)}/lead/pause`, body: {}, schema: LeadStatus });

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
