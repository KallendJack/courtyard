import { normalize } from "node:path";
import { type CommandEnv, git, gitFailureReason, gitOrNothing } from "../../lib/git.ts";
import { err, ok, type Result } from "../../lib/result.ts";

/** Why a session branch couldn't be started, for the owner. */
export type BranchRefusal =
  | { readonly kind: "repo-missing"; readonly repoPath: string }
  | { readonly kind: "not-git"; readonly repoPath: string }
  /** The repository has no `origin` remote, or it couldn't be reached: git's own words. */
  | { readonly kind: "remote"; readonly reason: string }
  /** A pull request's branch the repository has already is checked out in `worktree` (#326). */
  | { readonly kind: "branch-in-use"; readonly branch: string; readonly worktree: string }
  /** A pull request's branch the repository has already has commits its remote lacks (#326). */
  | { readonly kind: "branch-ahead"; readonly branch: string }
  | { readonly kind: "git"; readonly reason: string };

/** The remote a code workspace's repository is on: GitHub, by git's usual name for it. */
export const REMOTE = "origin";
/** How long reaching the remote may take before it counts as unreachable. */
export const REMOTE_TIMEOUT_MS = 60_000;

/** The default branch on the remote, as the remote says (`main`), or why it couldn't be told. */
export const defaultBranchOf = async (
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

/**
 * Whether a branch the repository has already is free for a session to use (#326): checked out in
 * no worktree, and with no commits `tracking`, its remote branch freshly fetched, lacks.
 */
export const unusedBranch = async (
  repoPath: string,
  ref: { branch: string; tracking: string },
): Promise<Result<null, BranchRefusal>> => {
  const { branch, tracking } = ref;
  try {
    const listed = await git(repoPath, ["worktree", "list", "--porcelain"]);
    for (const entry of listed.split(/\r?\n\r?\n/)) {
      const lines = entry.split(/\r?\n/);
      if (!lines.includes(`branch refs/heads/${branch}`)) continue;
      const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
      return err({ kind: "branch-in-use", branch, worktree: normalize(path ?? repoPath) });
    }
    const ahead = await git(repoPath, ["rev-list", "--count", `${tracking}..refs/heads/${branch}`]);
    return ahead.trim() === "0" ? ok(null) : err({ kind: "branch-ahead", branch });
  } catch (error) {
    return err({ kind: "git", reason: gitFailureReason(error) });
  }
};

/** A repository on GitHub as `owner/name`, from its remote's address in any of git's forms. */
const GITHUB_REMOTE =
  /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

/**
 * The repository a code workspace's remote is on GitHub, as `owner/name`, or `undefined` when it
 * isn't on GitHub. Read as configured, before any `insteadOf` takes it elsewhere.
 */
export const gitHubRepoOf = async (repoPath: string) => {
  const address = await gitOrNothing(repoPath, ["config", "--get", `remote.${REMOTE}.url`]);
  return address === undefined ? undefined : GITHUB_REMOTE.exec(address)?.[1];
};
