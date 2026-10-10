import { isAbsolute, join } from "node:path";
import { CODE_SESSIONS_AT_ONCE, type PullRequestReview, type SessionId } from "@courtyard/contract";
import { isFolder, removeFolder } from "../files.ts";
import { type CommandEnv, git, gitFailureReason, gitOrNothing } from "../git.ts";
import type { GitHub, GitHubProblem } from "../github/index.ts";
import { err, ok, type Result } from "../result.ts";
import { shownPath, staysInside } from "../workspace-files/index.ts";
import { type CommandRule, reachesOut, ruleFor, wordsOf } from "./allowlist.ts";
import { createCodeSlots } from "./slots.ts";

export { allowlistFor, type CommandRule } from "./allowlist.ts";

/**
 * Code sessions' git (ADR 0007): each session's own session branch, checked out in its own
 * worktree in the data folder, started from the repository's default branch as it is on its
 * remote. The owner's own checkout is never touched: only the repository's refs and worktree list
 * change.
 */

/** Why a session's pull request couldn't be reviewed, merged or closed (#160). */
export type PullRequestProblem =
  | GitHubProblem
  /** The code workspace's remote isn't on GitHub. */
  | { readonly kind: "not-on-github" };

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
  | { readonly kind: "denied"; readonly what: "command" | "edit" | "tool" };

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
    /** Its code workspace's command allowlist (`allowlistFor`). */
    readonly allowlist: readonly CommandRule[];
  },
  command: string,
): Promise<Result<null, CodeRefusal | CommandApproval>> => {
  const words = wordsOf(command);
  if (!words.ok) return err({ kind: words.error });
  const rule = ruleFor(session.allowlist, words.value, {
    branch: session.branch,
    pullRequest: session.pullRequest,
  });
  if (rule === undefined) return err({ kind: "needs-approval", reason: "off-allowlist" });
  if (reachesOut(session.worktree, rule, words.value)) {
    return err({ kind: "needs-approval", reason: "reaches-out" });
  }
  if (rule.onSessionBranch) {
    const on = await gitOrNothing(session.worktree, ["branch", "--show-current"]);
    if (on !== session.branch) return err({ kind: "off-branch", branch: session.branch });
  }
  return ok(null);
};

/**
 * Folders that decide what a repository's allowed commands run, wherever they are in it: git's own
 * (`.git`, a file in a worktree, saying where the repository is), git hooks' usual homes, and
 * Claude Code's project settings and hooks.
 */
const SETUP_FOLDERS = new Set([".git", ".githooks", ".husky", ".lefthook", ".claude"]);
/** Files that do, by name: package scripts and the package managers' own settings. */
const SETUP_FILES = new Set([
  "package.json",
  "package.json5",
  "package.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pnpmfile.cjs",
  ".pnpmfile.mjs",
]);

/**
 * A path's part as Windows reads it: case aside, without trailing dots and spaces, or a stream
 * after a colon (`.GIT.` and `package.json::$DATA` are `.git` and `package.json` there).
 */
const asWindowsReads = (part: string) =>
  (part.split(":")[0] ?? "").replace(/[. ]+$/, "").toLowerCase();

/**
 * Whether a path in a worktree (as the owner sees it, from the worktree) is a file that decides
 * what its allowed commands run: one of `SETUP_FILES`, lefthook's settings, anything in one of
 * `SETUP_FOLDERS` or in the repository's own git hooks folder (`hooks`, from the worktree), or a
 * name Windows could shorten one of those to (`GIT~1`).
 */
const isSetup = (shown: string, hooks: string | undefined) => {
  const parts = shown.split("/").map(asWindowsReads);
  const name = parts.at(-1) ?? "";
  const hooksParts = hooks?.split("/").map(asWindowsReads);
  return (
    SETUP_FILES.has(name) ||
    /^\.?lefthook/.test(name) ||
    parts.some((part) => SETUP_FOLDERS.has(part) || /~\d/.test(part)) ||
    hooksParts?.every((part, at) => parts[at] === part) === true
  );
};

/** Where an edit a model asks for in a session's worktree would land. */
export type EditPlace =
  /** Inside the worktree: it applies without asking. By its path as the owner sees it. */
  | { readonly kind: "inside"; readonly shown: string }
  /** Inside, but on a file that decides what its allowed commands run: it needs an approval. */
  | { readonly kind: "setup"; readonly shown: string }
  /** Outside the worktree, once symlinks are followed: it needs an approval. */
  | { readonly kind: "outside" };

/**
 * Where an edit of the file at `path` (from the worktree, or absolute) lands in a session's
 * worktree: inside it, on a file that decides what its allowed commands run (`isSetup`, which
 * includes the folder the repository's `core.hooksPath` names), or outside it.
 */
export const editPlaceIn = async (worktree: string, path: string): Promise<EditPlace> => {
  if (!(await staysInside(worktree, { paths: [path], globs: [] }))) return { kind: "outside" };
  const shown = shownPath(worktree, path);
  if (shown === "") return { kind: "outside" };
  const hooksPath = await gitOrNothing(worktree, ["config", "--get", "core.hooksPath"]);
  const hooks =
    hooksPath === undefined || hooksPath === "" ? undefined : shownPath(worktree, hooksPath);
  const inHooks = hooks !== undefined && !hooks.startsWith("..") && !isAbsolute(hooks);
  return isSetup(shown, inHooks ? hooks : undefined)
    ? { kind: "setup", shown }
    : { kind: "inside", shown };
};

/**
 * What a code session's commands get in their environment: its slot among the code sessions
 * running, 1 to `CODE_SESSIONS_AT_ONCE`, which no other running one has, for a repository's checks
 * to pick their test servers' ports from (this repository's Playwright config does).
 */
export const slotEnv = (slot: number) => ({ COURTYARD_SESSION_SLOT: String(slot) });

/** A repository on GitHub as `owner/name`, from its remote's address in any of git's forms. */
const GITHUB_REMOTE =
  /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

/**
 * The repository a code workspace's remote is on GitHub, as `owner/name`, or `undefined` when it
 * isn't on GitHub. Read as configured, before any `insteadOf` takes it elsewhere.
 */
const gitHubRepoOf = async (repoPath: string) => {
  const address = await gitOrNothing(repoPath, ["config", "--get", `remote.${REMOTE}.url`]);
  return address === undefined ? undefined : GITHUB_REMOTE.exec(address)?.[1];
};

export const createCode = (options: {
  dataDir: string;
  /** The environment a session's commands get: Courtyard's GitHub sign-in (#99). */
  commandEnv: () => Promise<CommandEnv>;
  /** A session branch's pull request on GitHub: followed (#172), reviewed, merged, closed (#160). */
  pullRequests: Pick<GitHub, "pullRequest" | "review" | "merge" | "close" | "deleteBranch">;
}) => {
  const { pullRequests } = options;
  /** The repository a code workspace's remote is on GitHub, or why there's none to ask. */
  const onGitHub = async (repoPath: string): Promise<Result<string, PullRequestProblem>> => {
    const repo = await gitHubRepoOf(repoPath);
    return repo === undefined ? err({ kind: "not-on-github" }) : ok(repo);
  };
  const worktreeOf = (id: SessionId) => join(options.dataDir, "worktrees", id);

  /**
   * The repository's default branch on its remote, freshly fetched: its name, and the ref it's
   * fetched to; or why it can't be.
   */
  const freshDefault = async (
    repoPath: string,
  ): Promise<Result<{ branch: string; tracking: string }, BranchRefusal>> => {
    const there = await isFolder(repoPath);
    if (!there.ok || !there.value) return err({ kind: "repo-missing", repoPath });
    const top = await gitOrNothing(repoPath, ["rev-parse", "--git-dir"]);
    if (top === undefined) return err({ kind: "not-git", repoPath });
    const env = await options.commandEnv();
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
    return ok({ branch: main.value, tracking });
  };

  return {
    /** The folder a session's branch is checked out in. */
    worktreeOf,

    /** The repository's default branch on its remote, freshly fetched (the setup check, #181). */
    freshDefault,

    /** The repository a code workspace's remote is on GitHub, as `owner/name`, or why there's none. */
    onGitHub,

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
      const fresh = await freshDefault(repoPath);
      if (!fresh.ok) return fresh;
      const { tracking } = fresh.value;
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
     * The session branch's pull request on GitHub, as it is now (#172): `undefined` when it has
     * none, the repository isn't on GitHub, or GitHub can't be asked just now.
     */
    pullRequestOf: async (find: { repoPath: string; branch: string }) => {
      const repo = await gitHubRepoOf(find.repoPath);
      if (repo === undefined) return undefined;
      const found = await pullRequests.pullRequest({ repo, branch: find.branch });
      return found.ok ? found.value : undefined;
    },

    /**
     * The session branch's pull request as the owner reviews it (#160): `undefined` when it has
     * none yet.
     */
    reviewOf: async (find: {
      repoPath: string;
      branch: string;
    }): Promise<Result<PullRequestReview | undefined, PullRequestProblem>> => {
      const repo = await onGitHub(find.repoPath);
      if (!repo.ok) return repo;
      return pullRequests.review({ repo: repo.value, branch: find.branch });
    },

    /** Merges the session's pull request on GitHub, only while its latest commit is `head`. */
    merge: async (pull: {
      repoPath: string;
      number: number;
      head: string;
    }): Promise<Result<null, PullRequestProblem>> => {
      const repo = await onGitHub(pull.repoPath);
      if (!repo.ok) return repo;
      return pullRequests.merge({ repo: repo.value, number: pull.number, head: pull.head });
    },

    /** Closes the session's pull request on GitHub without merging it. */
    close: async (pull: {
      repoPath: string;
      number: number;
    }): Promise<Result<null, PullRequestProblem>> => {
      const repo = await onGitHub(pull.repoPath);
      if (!repo.ok) return repo;
      return pullRequests.close({ repo: repo.value, number: pull.number });
    },

    /**
     * Clears a session's worktree and branch away, for a session that never started, or one whose
     * pull request was merged or closed (#172): then, `pushed`, its branch on GitHub too (story
     * 40), only ever one of Courtyard's own (`courtyard/…`). Anything left behind is the
     * repository's to keep, so a failure here is only logged.
     */
    clearBranch: async (clear: {
      repoPath: string;
      sessionBranch: SessionBranch;
      pushed: boolean;
    }) => {
      const { repoPath, sessionBranch } = clear;
      // The folder goes first, by Node, then git forgets it: `git worktree remove` can't delete a
      // package install nested past Windows' path limit, and once it has half-removed a worktree
      // it refuses to touch it again ("is not a working tree").
      if (!(await removeFolder(sessionBranch.worktree))) {
        console.error("A session's worktree couldn't be cleared away:", sessionBranch.worktree);
      }
      try {
        await git(repoPath, ["worktree", "prune"]);
        const there = await git(repoPath, ["branch", "--list", sessionBranch.branch]);
        if (there.trim() !== "") await git(repoPath, ["branch", "-D", sessionBranch.branch]);
      } catch (error) {
        console.error("A session branch couldn't be cleared away:", gitFailureReason(error));
      }
      if (!clear.pushed || !sessionBranch.branch.startsWith(BRANCH_PREFIX)) return;
      const repo = await gitHubRepoOf(repoPath);
      if (repo === undefined) return;
      const deleted = await pullRequests.deleteBranch({ repo, branch: sessionBranch.branch });
      // GitHub may have deleted it already, on merging.
      if (!deleted.ok)
        console.error("A session branch on GitHub couldn't be deleted:", deleted.error);
    },
  };
};

export type Code = ReturnType<typeof createCode>;
