import { basename, dirname, join } from "node:path";
import type { WorktreeKeptWhy } from "@courtyard/contract";
import { listFolder, removeFolder } from "../../lib/files.ts";
import { type CommandEnv, git, gitFailureReason, gitOrNothing } from "../../lib/git.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import { helperBranchStem, isHelperBranchOf } from "./branches.ts";
import { type BranchRefusal, REMOTE, REMOTE_TIMEOUT_MS } from "./remote.ts";

/**
 * A quiet session's work kept on GitHub before its worktree is cleared (#605), and its branch
 * checked out again for its next turn.
 */

/** The branch on GitHub a session branch's work is kept on while its worktree is cleared. */
export const wipBranchOf = (branch: string) => `wip/${branch}`;

/** The commit that keeps what a cleared worktree had left uncommitted. */
const WIP_MESSAGE = "Work in progress, kept as its worktree was cleared after 3 quiet days";

/** A new file's name when it may hold a secret, which a `wip` branch would push to GitHub. */
const SECRET_LOOKING = /^(\.env.*|.*\.pem|.*\.key|id_rsa.*)$/i;

/** The files a worktree's status (`--porcelain -z`) lists as new to git: untracked or just added. */
const newFilesIn = (status: string) =>
  status.split("\0").flatMap((entry) => {
    const path = /^(?:\?\?|A.) (.+)$/s.exec(entry)?.[1];
    return path === undefined ? [] : [path];
  });

/**
 * Why a quiet worktree stays, as no `wip` branch could keep all it has: it's on another branch
 * than its own, it has new files that look like secrets, or a helper (#395) has work the branch
 * lacks, committed on its own branch (a merge back that clashed) or left in its worktree.
 */
const whyItStays = async (keep: {
  worktree: string;
  branch: string;
}): Promise<WorktreeKeptWhy | undefined> => {
  const { worktree, branch } = keep;
  if ((await git(worktree, ["branch", "--show-current"])) !== branch) return "other-branch";
  const status = await git(worktree, ["status", "--porcelain", "-z", "--untracked-files=all"]);
  if (newFilesIn(status).some((path) => SECRET_LOOKING.test(basename(path)))) {
    return "secret-files";
  }
  const helpers = await git(worktree, [
    "branch",
    "--list",
    "--format=%(refname:short)",
    `${helperBranchStem(branch)}*`,
  ]);
  for (const helper of helpers.split(/\r?\n/).filter((name) => isHelperBranchOf(branch, name))) {
    const ahead = await git(worktree, ["rev-list", "--count", helper, "--not", "HEAD"]);
    if (ahead !== "0") return "helper-work";
  }
  const beside = dirname(worktree);
  const folders = await listFolder(beside);
  if (!folders.ok) return "helper-work";
  for (const name of folders.value) {
    if (!name.startsWith(`${basename(worktree)}-helper-`)) continue;
    // A folder git can't read may still hold a helper's files, so it counts as work too.
    const left = await gitOrNothing(join(beside, name), ["status", "--porcelain"]);
    if (left !== "") return "helper-work";
  }
  return undefined;
};

/** What became of a quiet worktree's work: kept, so the worktree can go, or why it stays. */
export type Keeping =
  | { readonly kind: "kept"; readonly wip: string | undefined }
  | { readonly kind: "stays"; readonly why: WorktreeKeptWhy };

/**
 * Keeps everything a session's worktree has that GitHub lacks: what it left uncommitted is
 * committed on its branch, without the repository's hooks, and the branch is pushed as
 * `wip/<branch>`. Its name, none when GitHub had it all, why the worktree stays (`whyItStays`),
 * or git's reason it couldn't be kept. What GitHub has is fetched first, never read from refs
 * that may be stale, so a remote that can't be reached keeps the worktree as well.
 */
export const keepOnWip = async (keep: {
  worktree: string;
  branch: string;
  env: CommandEnv;
}): Promise<Result<Keeping, string>> => {
  const { worktree, env } = keep;
  const remote = { timeoutMs: REMOTE_TIMEOUT_MS, env };
  try {
    const why = await whyItStays(keep);
    if (why !== undefined) return ok({ kind: "stays", why });
    const refs = `+refs/heads/*:refs/remotes/${REMOTE}/*`;
    await git(worktree, ["fetch", "--quiet", "--prune", REMOTE, refs], remote);
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
    if (ahead === "0") return ok({ kind: "kept", wip: undefined });
    const wip = wipBranchOf(keep.branch);
    await git(
      worktree,
      ["push", "--quiet", "--force", "--no-verify", REMOTE, `HEAD:refs/heads/${wip}`],
      remote,
    );
    return ok({ kind: "kept", wip });
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
