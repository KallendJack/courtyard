import {
  pullRequestIn,
  type SessionEvent,
  type SessionId,
  type WorkspaceId,
  worktreeClearedIn,
} from "@courtyard/contract";
import { exists } from "../../lib/files.ts";
import { ok, type Result } from "../../lib/result.ts";
import type { BranchRefusal, Code, SessionBranch } from "../code/index.ts";
import { createClearingRetries } from "./following.ts";

/**
 * A code session's worktree clears itself after 3 quiet days with no pull request (#605): what
 * GitHub lacks is pushed to its `wip/` branch first, and its next turn checks the branch out
 * again. One mid-turn, waiting on the owner, with a task running, or on a branch it didn't make
 * (#326) is kept.
 */

/** How long a code session with no pull request is quiet before its worktree is cleared. */
export const QUIET_WORKTREE_MS = 3 * 24 * 60 * 60 * 1000;

/** A code session as clearing its worktree needs it. */
export type QuietSession = {
  readonly id: SessionId;
  readonly workspaceId: WorkspaceId;
  readonly updatedAt: string;
  readonly branch?: string | undefined;
  readonly keepsBranch?: true | undefined;
};

export const createQuietWorktrees = (options: {
  now: () => number;
  code: Pick<Code, "clearQuiet" | "checkOutAgain" | "worktreeOf" | "lastCommitAt">;
  /** Every session's own file, in every workspace. */
  sessions: () => Promise<Result<readonly QuietSession[], unknown>>;
  events: (id: SessionId) => Promise<Result<SessionEvent[], unknown>>;
  /** Its code workspace's repository, or `undefined` for a planning workspace. */
  repoOf: (workspaceId: WorkspaceId) => Promise<string | undefined>;
  /**
   * Whether it must keep its worktree now: a turn running or waiting for a place, a task
   * running, or it waits on the owner (a Lead's builder stuck).
   */
  busy: (id: SessionId) => Promise<boolean>;
  record: (
    id: SessionId,
    event: { type: "worktree-cleared"; wip?: string } | { type: "worktree-restored" },
  ) => Promise<Result<unknown, unknown>>;
}) => {
  const { code } = options;
  /** Each session being looked at now, which a turn starting in it waits for. */
  const looking = new Map<SessionId, Promise<void>>();
  const retries = createClearingRetries(options.now);

  /** When the session was last at work: a turn, an event, or a commit on its branch. */
  const lastAt = async (session: QuietSession, events: readonly SessionEvent[]) =>
    Math.max(
      Date.parse(session.updatedAt),
      Date.parse(events.at(-1)?.at ?? session.updatedAt),
      (await code.lastCommitAt(code.worktreeOf(session.id))) ?? 0,
    );

  const clearIfQuiet = async (session: QuietSession & { branch: string }) => {
    if (session.keepsBranch === true || !retries.due(session.id)) return;
    const events = await options.events(session.id);
    if (!events.ok || pullRequestIn(events.value) !== undefined) return;
    if (worktreeClearedIn(events.value) !== undefined) return;
    const worktree = code.worktreeOf(session.id);
    const there = await exists(worktree);
    if (!there.ok || !there.value) return;
    if (options.now() - (await lastAt(session, events.value)) < QUIET_WORKTREE_MS) return;
    const repoPath = await options.repoOf(session.workspaceId);
    if (repoPath === undefined || (await options.busy(session.id))) return;
    const sessionBranch: SessionBranch = { branch: session.branch, worktree };
    // Its work is safe once kept, so it counts as cleared even if its folder is held a while.
    const kept = await code.clearQuiet({ repoPath, sessionBranch });
    retries.tried(session.id, kept.ok);
    if (!kept.ok) {
      console.error(
        `Session ${session.id}: its quiet worktree's work couldn't be kept:`,
        kept.error,
      );
      return;
    }
    const wip = kept.value;
    await options.record(session.id, {
      type: "worktree-cleared",
      ...(wip === undefined ? {} : { wip }),
    });
  };

  return {
    /** For the worker's repeating jobs: clears each quiet code session's worktree, one at a time. */
    clearQuiet: async () => {
      const all = await options.sessions();
      if (!all.ok) return;
      for (const session of all.value) {
        const { branch } = session;
        if (branch === undefined) continue;
        const look = clearIfQuiet({ ...session, branch }).catch((error: unknown) =>
          console.error(`Session ${session.id}: its quiet worktree couldn't be cleared`, error),
        );
        looking.set(session.id, look);
        await look;
        looking.delete(session.id);
      }
    },

    /**
     * Before a turn in a code session: its branch checked out again if its worktree was cleared,
     * once any look at it under way now has finished. Or why it couldn't be.
     */
    restore: async (session: {
      id: SessionId;
      workspaceId: WorkspaceId;
      branch: string;
    }): Promise<Result<null, BranchRefusal>> => {
      await looking.get(session.id);
      const events = await options.events(session.id);
      const cleared = events.ok ? worktreeClearedIn(events.value) : undefined;
      const repoPath = await options.repoOf(session.workspaceId);
      if (cleared === undefined || repoPath === undefined) return ok(null);
      const back = await code.checkOutAgain({
        repoPath,
        sessionId: session.id,
        branch: session.branch,
        wip: cleared.wip,
      });
      if (back.ok) await options.record(session.id, { type: "worktree-restored" });
      return back;
    },
  };
};
