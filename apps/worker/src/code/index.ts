import { join } from "node:path";
import { CODE_SESSIONS_AT_ONCE, type SessionId } from "@courtyard/contract";
import { isFolder } from "../files.ts";
import { git, gitFailureReason, gitOrNothing } from "../git.ts";
import { err, ok, type Result } from "../result.ts";
import { shownPath, staysInside } from "../workspace-files/index.ts";
import { type CommandRule, DEFAULT_ALLOWLIST, reachesOut, ruleFor, wordsOf } from "./allowlist.ts";
import { createCodeSlots } from "./slots.ts";

/**
 * Code sessions' git (ADR 0007): each session's own session branch, checked out in its own
 * worktree in the data folder, started from the repository's default branch as it is on its
 * remote. The owner's own checkout is never touched: only the repository's refs and worktree list
 * change.
 */

/**
 * What a code session's git and gh commands get on top of the worker's environment: Courtyard's
 * own GitHub sign-in, never the machine's (#99). An `undefined` is unset.
 */
export type CommandEnv = Readonly<Record<string, string | undefined>>;

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
const defaultBranchOf = async (
  repoPath: string,
  env: CommandEnv,
): Promise<Result<string, BranchRefusal>> => {
  try {
    const answer = await git(repoPath, ["ls-remote", "--symref", REMOTE, "HEAD"], {
      timeoutMs: REMOTE_TIMEOUT_MS,
      env,
    });
    const branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(answer)?.[1];
    return branch === undefined
      ? err({ kind: "remote", reason: "its remote has no default branch" })
      : ok(branch);
  } catch (error) {
    return err({ kind: "remote", reason: gitFailureReason(error) });
  }
};

/** Why a code session's edit or command didn't happen, for the prompts module to word. */
export type CodeRefusal =
  /** The owner stopped the turn: nothing more is done. */
  | { readonly kind: "stopped" }
  /** A command that chains, pipes, redirects or substitutes, so it could run something else. */
  | { readonly kind: "chained" }
  /** A command whose quotes don't close. */
  | { readonly kind: "unreadable" }
  /** A command for the session branch only, such as committing, while the worktree is off it. */
  | { readonly kind: "off-branch"; readonly branch: string }
  /** The owner denied the approval it needed (#171). */
  | { readonly kind: "denied"; readonly what: "command" | "edit" };

/**
 * A command only the owner can allow (#171): one off the command allowlist, or one naming a path
 * outside the worktree.
 */
export type CommandApproval = {
  readonly kind: "needs-approval";
  readonly reason: "off-allowlist" | "reaches-out";
};

/**
 * Whether a command may run in a session's worktree without asking: one command, on the command
 * allowlist, naming no path outside the worktree, and, for committing, with the worktree on the
 * session branch. One that could run only with the owner's approval says so.
 */
export const commandAllowed = async (
  session: {
    readonly worktree: string;
    readonly branch: string;
    /** Its pull request's number, once it has one (#172). */
    readonly pullRequest?: number | undefined;
  },
  command: string,
  allowlist: readonly CommandRule[] = DEFAULT_ALLOWLIST,
): Promise<Result<null, CodeRefusal | CommandApproval>> => {
  const words = wordsOf(command);
  if (!words.ok) return err({ kind: words.error });
  const rule = ruleFor(allowlist, words.value, {
    branch: session.branch,
    pullRequest: session.pullRequest,
  });
  if (rule === undefined) return err({ kind: "needs-approval", reason: "off-allowlist" });
  if (reachesOut(session.worktree, words.value.slice(rule.words.length))) {
    return err({ kind: "needs-approval", reason: "reaches-out" });
  }
  if (rule.onSessionBranch) {
    const on = await gitOrNothing(session.worktree, ["branch", "--show-current"]);
    if (on !== session.branch) return err({ kind: "off-branch", branch: session.branch });
  }
  return ok(null);
};

/** Git's own file in a worktree, which says where the repository is: never a model's to change. */
const GIT_FILE = ".git";

/**
 * Whether a model may edit the file at `path` (from the worktree, or absolute) in a session's
 * worktree: only inside it, once symlinks are followed, and never git's own file there. Its path as
 * the owner sees it in the activity, or `undefined` when it may not.
 */
export const editableIn = async (worktree: string, path: string) => {
  if (!(await staysInside(worktree, { paths: [path], globs: [] }))) return undefined;
  const shown = shownPath(worktree, path);
  const [first] = shown.split("/");
  return shown === "" || first === GIT_FILE ? undefined : shown;
};

/**
 * What a code session's commands get in their environment: its slot among the code sessions
 * running, 1 to `CODE_SESSIONS_AT_ONCE`, which no other running one has, for a repository's checks
 * to pick their test servers' ports from (this repository's Playwright config does).
 */
export const slotEnv = (slot: number) => ({ COURTYARD_SESSION_SLOT: String(slot) });

export const createCode = (options: {
  dataDir: string;
  /** The environment a session's commands get: Courtyard's GitHub sign-in (#99). */
  commandEnv: () => CommandEnv;
}) => {
  const worktreeOf = (id: SessionId) => join(options.dataDir, "worktrees", id);

  return {
    /** The folder a session's branch is checked out in. */
    worktreeOf,

    /** Which code sessions are running, and which wait for one to end. */
    slots: createCodeSlots(CODE_SESSIONS_AT_ONCE),

    /**
     * What a session's commands get on top of the environment they run in, so its git and gh, and
     * the worker's own reaching the repository's remote, use only Courtyard's GitHub sign-in.
     */
    commandEnv: options.commandEnv,

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
      const env = options.commandEnv();
      const main = await defaultBranchOf(repoPath, env);
      if (!main.ok) return main;
      const tracking = `refs/remotes/${REMOTE}/${main.value}`;
      try {
        await git(repoPath, ["fetch", "--quiet", REMOTE, `+refs/heads/${main.value}:${tracking}`], {
          timeoutMs: REMOTE_TIMEOUT_MS,
          env,
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
