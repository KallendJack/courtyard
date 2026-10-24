import { removeFolder } from "../../lib/files.ts";
import { type CommandEnv, git, gitFailureReason, gitOrNothing } from "../../lib/git.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import { type BranchRefusal, REMOTE, REMOTE_TIMEOUT_MS } from "./remote.ts";

/**
 * A quiet session's work kept on GitHub before its worktree is cleared (#605), and its branch
 * checked out again for its next turn.
 */

/** The branch on GitHub a session branch's work is kept on while its worktree is cleared. */
export const wipBranchOf = (branch: string) => `wip/${branch}`;

/** The commit that keeps what a cleared worktree had left uncommitted. */
const WIP_MESSAGE = "Work in progress, kept as its worktree was cleared after 3 quiet days";

/**
 * Keeps everything a session's worktree has that GitHub lacks: what it left uncommitted is
 * committed on its branch, without the repository's hooks, and the branch is pushed as
 * `wip/<branch>`. Its name, none when GitHub had it all, or git's reason it couldn't be kept.
 */
export const keepOnWip = async (keep: {
  worktree: string;
  branch: string;
  env: CommandEnv;
}): Promise<Result<string | undefined, string>> => {
  const { worktree, env } = keep;
  try {
    if ((await git(worktree, ["status", "--porcelain"])) !== "") {
      await git(worktree, ["add", "--all"], { env });
      await git(worktree, ["commit", "--quiet", "--no-verify", "-m", WIP_MESSAGE], { env });
    }
    const ahead = await git(worktree, [
      "rev-list",
      "--count",
      "HEAD",
      "--not",
      `--remotes=${REMOTE}`,
    ]);
    if (ahead.trim() === "0") return ok(undefined);
    const wip = wipBranchOf(keep.branch);
    await git(
      worktree,
      ["push", "--quiet", "--force", "--no-verify", REMOTE, `HEAD:refs/heads/${wip}`],
      { timeoutMs: REMOTE_TIMEOUT_MS, env },
    );
    return ok(wip);
  } catch (error) {
    return err(gitFailureReason(error));
  }
};

/**
 * Checks a cleared session's branch out again in its worktree: from its `wip` branch on GitHub,
 * else the branch as GitHub or the repository has it, else afresh from `tracking`, the default
 * branch freshly fetched (`fresh`), as it started. Or why it couldn't be.
 */
export const checkOutAgain = async (back: {
  repoPath: string;
  worktree: string;
  branch: string;
  wip: string | undefined;
  env: CommandEnv;
  fresh: () => Promise<Result<{ tracking: string }, BranchRefusal>>;
}): Promise<Result<null, BranchRefusal>> => {
  const { repoPath, worktree, branch, env } = back;
  // What a program held as it was cleared may still be there.
  if (!(await removeFolder(worktree))) {
    return err({ kind: "git", reason: `${worktree} is held by another program` });
  }
  const remote = { timeoutMs: REMOTE_TIMEOUT_MS, env };
  try {
    await git(repoPath, ["worktree", "prune"]);
    const onRemote = async (name: string) =>
      (await git(repoPath, ["ls-remote", "--heads", REMOTE, name], remote)).trim() !== "";
    const from =
      back.wip !== undefined && (await onRemote(back.wip))
        ? back.wip
        : (await onRemote(branch))
          ? branch
          : undefined;
    if (from !== undefined) {
      const refs = `+refs/heads/${from}:refs/heads/${branch}`;
      await git(repoPath, ["fetch", "--quiet", REMOTE, refs], remote);
    }
    if (from !== undefined || (await gitOrNothing(repoPath, ["branch", "--list", branch])) !== "") {
      await git(repoPath, ["worktree", "add", "--quiet", worktree, branch]);
      return ok(null);
    }
    const fresh = await back.fresh();
    if (!fresh.ok) return fresh;
    await git(repoPath, [
      "worktree",
      "add",
      "--quiet",
      "--no-track",
      "-b",
      branch,
      worktree,
      fresh.value.tracking,
    ]);
    return ok(null);
  } catch (error) {
    return err({ kind: "git", reason: gitFailureReason(error) });
  }
};
