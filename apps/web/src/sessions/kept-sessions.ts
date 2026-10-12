import { CodeSessionList } from "@courtyard/contract";
import { createKept, useKept } from "@/components/kept";
import { fromWorker } from "../worker.ts";

/**
 * Each workspace's sessions as last known, for the tab's lifetime (nothing jumps in late): what
 * its tile on Home and on the rail say waits on the owner (#345). Mark all read puts the list it
 * leaves here, so every tile clears at once.
 */
export const KEPT_SESSIONS = createKept<CodeSessionList>();

/** A workspace's sessions, as the worker lists them, or nothing to keep when it can't say. */
export const loadSessions = async (workspaceId: string) => {
  const loaded = await fromWorker(
    `/workspaces/${encodeURIComponent(workspaceId)}/sessions`,
    CodeSessionList,
  );
  return loaded.kind === "loaded" ? loaded.data : undefined;
};

/** A workspace's sessions as last known, asked for again when `again` changes. */
export const useKeptSessions = (workspaceId: string, again?: unknown) =>
  useKept(KEPT_SESSIONS, {
    key: workspaceId,
    load: () => loadSessions(workspaceId),
    ...(again === undefined ? {} : { again }),
  });
