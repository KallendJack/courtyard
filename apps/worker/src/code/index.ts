import { join } from "node:path";
import type { SessionId } from "@courtyard/contract";
import { isFolder } from "../files.ts";
import { git, gitFailureReason, gitOrNothing } from "../git.ts";
import { err, ok, type Result } from "../result.ts";

/**
 * Code sessions' git (ADR 0007): each session's own session branch, checked out in its own
 * worktree in the data folder, started from the repository's default branch as it is on its
 * remote. The owner's own checkout is never touched: only the repository's refs and worktree list
 * change.
 */

/** A session's branch and the folder it's checked out in. */
export type SessionBranch = { readonly branch: string; readonly worktree: string };

/** Why a session branch couldn't be started, for the owner. */
export type BranchRefusal =
  | { readonly kind: "repo-missing"; readonly repoPath: string }
  | { readonly kind: "not-git"; readonly repoPath: string }
  /** The repository has no `origin` remote, or it couldn't be reached: git's own words. */
  | { readonly kind: "remote"; readonly reason: string }
  | { readonly kind: "git"; readonly reason: string };

/** The remote a code workspace's repository is on: GitHub, by git's usual name for it. */
const REMOTE = "origin";
/** How long reaching the remote may take before it counts as unreachable. */
const REMOTE_TIMEOUT_MS = 60_000;
/** Where session branches' names start, so the owner can tell Courtyard's from their own. */
const BRANCH_PREFIX = "courtyard/";

/** The default branch on the remote, as the remote says (`main`), or why it couldn't be told. */
const defaultBranchOf = async (repoPath: string): Promise<Result<string, BranchRefusal>> => {
  try {
    const answer = await git(repoPath, ["ls-remote", "--symref", REMOTE, "HEAD"], {
      timeoutMs: REMOTE_TIMEOUT_MS,
    });
    const branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(answer)?.[1];
    return branch === undefined
      ? err({ kind: "remote", reason: "its remote has no default branch" })
      : ok(branch);
  } catch (error) {
    return err({ kind: "remote", reason: gitFailureReason(error) });
  }
};

export const createCode = (options: { dataDir: string }) => {
  const worktreeOf = (id: SessionId) => join(options.dataDir, "worktrees", id);

  return {
    /** The folder a session's branch is checked out in. */
    worktreeOf,

    /**
     * Starts a session's branch from the default branch on the repository's remote, freshly
     * fetched, and checks it out in the session's own worktree.
     */
    startBranch: async (start: {
      repoPath: string;
      sessionId: SessionId;
    }): Promise<Result<SessionBranch, BranchRefusal>> => {
      const { repoPath, sessionId } = start;
      const there = await isFolder(repoPath);
      if (!there.ok || !there.value) return err({ kind: "repo-missing", repoPath });
      const top = await gitOrNothing(repoPath, ["rev-parse", "--git-dir"]);
      if (top === undefined) return err({ kind: "not-git", repoPath });
      const main = await defaultBranchOf(repoPath);
      if (!main.ok) return main;
      const tracking = `refs/remotes/${REMOTE}/${main.value}`;
      try {
        await git(repoPath, ["fetch", "--quiet", REMOTE, `+refs/heads/${main.value}:${tracking}`], {
          timeoutMs: REMOTE_TIMEOUT_MS,
        });
      } catch (error) {
        return err({ kind: "remote", reason: gitFailureReason(error) });
      }
      const branch = `${BRANCH_PREFIX}${sessionId.slice(0, 8)}`;
      const worktree = worktreeOf(sessionId);
      try {
        await git(repoPath, [
          "worktree",
          "add",
          "--quiet",
          "--no-track",
          "-b",
          branch,
          worktree,
          tracking,
        ]);
      } catch (error) {
        return err({ kind: "git", reason: gitFailureReason(error) });
      }
      return ok({ branch, worktree });
    },

    /**
     * Clears a session's worktree and branch away, for a session that never started. Anything
     * left behind is the repository's to keep, so a failure here is only logged.
     */
    clearBranch: async (clear: { repoPath: string; sessionBranch: SessionBranch }) => {
      const { repoPath, sessionBranch } = clear;
      try {
        await git(repoPath, ["worktree", "remove", "--force", sessionBranch.worktree]);
        await git(repoPath, ["branch", "-D", sessionBranch.branch]);
      } catch (error) {
        console.error("A session branch couldn't be cleared away:", gitFailureReason(error));
      }
    },
  };
};

export type Code = ReturnType<typeof createCode>;
