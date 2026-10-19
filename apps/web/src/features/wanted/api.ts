import { type ThingSlug, WantedList, type WorkspaceId } from "@courtyard/contract";
import { fromWorker, sendJson } from "../../api/worker.ts";

// The wanted list's calls live with it rather than in worker.ts, so its schemas stay off the first
// load.

const wantedOf = (workspaceId: WorkspaceId) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/wanted`;

/**
 * A workspace's wanted list (#245): its Things wanted or to replace with their picks. Asking for it
 * is opening it, which checks prices over a week old again, quietly.
 */
export const loadWanted = (workspaceId: WorkspaceId) =>
  fromWorker(wantedOf(workspaceId), WantedList);

/** Find picks for a wanted Thing with none: found in the background, the list as it is then. */
export const findPicks = (workspaceId: WorkspaceId, slug: ThingSlug) =>
  sendJson({ path: `${wantedOf(workspaceId)}/${slug}/find`, body: {}, schema: WantedList });
