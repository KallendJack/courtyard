import { PlanningHome, type WorkspaceId } from "@courtyard/contract";
import { createKept } from "@courtyard/ui/layout/kept.tsx";
import { fromWorker } from "../../api/worker.ts";

// A planning workspace's Home's call (#208, #603), beside it so its schema stays off the first
// load.

/** Each planning workspace's Home as last heard, by its id, so a revisit shows it at once. */
export const KEPT_HOME = createKept<PlanningHome>();

/** A planning workspace's Home: its main subject and its projects. */
export const loadHome = (workspaceId: WorkspaceId) =>
  fromWorker(`/workspaces/${encodeURIComponent(workspaceId)}/home`, PlanningHome);

/** Home again, kept for the next visit: nothing when the worker didn't answer. */
export const loadKeptHome = async (workspaceId: WorkspaceId) => {
  const home = await loadHome(workspaceId);
  if (home.kind !== "loaded") return undefined;
  KEPT_HOME.set(workspaceId, home.data);
  return home.data;
};
