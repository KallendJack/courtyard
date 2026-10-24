import { CodeSessionList, type TurnNow } from "@courtyard/contract";
import { createKept, useFresh, useKept } from "@courtyard/ui/layout/kept.tsx";
import { fromWorker } from "../../api/worker.ts";

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

/** How often a list of sessions asks again while one of them is working or needs the owner. */
const BUSY_EVERY_MS = 3000;

/**
 * How often a list of `sessions` asks again (#387): every few seconds while any is working or
 * needs the owner, so it keeps saying whose turn it is; otherwise as calm as any block.
 */
export const sessionsBusyEveryMs = (sessions: readonly { readonly now: TurnNow }[]) =>
  sessions.some((session) => session.now.kind !== "your-turn") ? BUSY_EVERY_MS : undefined;

/**
 * Calls `refresh` the shared way (`useFresh`), as often as `sessionsBusyEveryMs` says, while
 * `asking`.
 */
export const useFreshSessions = (
  sessions: readonly { readonly now: TurnNow }[],
  refresh: () => unknown,
  asking = true,
) => useFresh({ ask: refresh, asking, busyEveryMs: sessionsBusyEveryMs(sessions) });

/**
 * A workspace's sessions as last known, asked for again when `again` changes, and kept fresh the
 * shared way, faster while one is working or needs the owner (#387).
 */
export const useKeptSessions = (workspaceId: string, again?: unknown) =>
  useKept(KEPT_SESSIONS, {
    key: workspaceId,
    load: () => loadSessions(workspaceId),
    ...(again === undefined ? {} : { again }),
    busy: (known) => sessionsBusyEveryMs(known.sessions),
  });
