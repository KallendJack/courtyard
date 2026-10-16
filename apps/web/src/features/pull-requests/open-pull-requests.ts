import type { CodeSessionList, OpenPullRequestList, WorkspaceId } from "@courtyard/contract";
import { createKept, useKept } from "@/components/layout/kept";
import { loadOpenPullRequests } from "./api.ts";

// A code workspace's open pull requests, kept for the tab's lifetime: its PRs list and its Home's
// Needs you (#301), and its tile on Home (#102). No styles, so Home can ask without the list's.

type Listed = CodeSessionList["sessions"][number];

/**
 * What the sessions' pull requests are now, and whether each session with one is working on it,
 * so the list, with what each waits on the owner for (#334), is asked for again when one changes.
 */
const versionOf = (sessions: readonly Listed[]) =>
  JSON.stringify(
    sessions.map((session) => [
      session.id,
      session.pullRequest,
      session.pullRequest !== undefined && session.now.kind === "working",
    ]),
  );

/** Each workspace's open pull requests as last known, for the tab's lifetime. */
const KEPT_OPEN = createKept<OpenPullRequestList>();

/**
 * Every open pull request on a code workspace's repository, asked for again as its sessions' pull
 * requests change (and when `again` changes, after the page merged one, say); none while `asking`
 * is false.
 */
export const useOpenPullRequests = (
  workspaceId: WorkspaceId,
  sessions: readonly Listed[],
  asking = true,
  again = 0,
) => {
  const version = versionOf(sessions);
  // The last list known shows at once, asked for again quietly (nothing jumps in late).
  return useKept(KEPT_OPEN, {
    key: workspaceId,
    load: async () => {
      const loaded = await loadOpenPullRequests(workspaceId);
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
    again: `${version}:${again}`,
    asking,
  });
};
