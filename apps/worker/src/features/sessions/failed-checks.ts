import { join } from "node:path";
import type { PullRequest, SessionId } from "@courtyard/contract";
import { z } from "zod";
import type { GitHub } from "../../integrations/github/index.ts";
import { readJsonFile, writeJsonFile } from "../../lib/files.ts";
import { AS_COURTYARD, git, gitOrNothing } from "../../lib/git.ts";
import type { Code } from "../code/index.ts";
import { REMOTE, REMOTE_TIMEOUT_MS } from "../code/remote.ts";

/**
 * A pull request's failed checks, tried again by the worker before any fixing turn (#740, ADR
 * 0041). A branch behind its base is brought up to date first, as GitHub's Update branch does: its
 * base merged in, in the session's worktree, and pushed, so its checks run again; a conflict goes
 * to the session. A failure in tests the pull request doesn't touch is re-run once. Anything else,
 * or a second failure, goes to the session.
 */

/** Where what was tried for each session's pull request is kept, in the data folder. */
const FILE = "failed-checks.json";

/** How long a try is waited for before the session is asked anyway: GitHub may never start it. */
const TRY_WAITS_MS = 10 * 60 * 1000;

/** What was tried on a session's pull request's latest commit. */
const Tried = z.object({
  head: z.string(),
  how: z.enum(["updated", "rerun"]),
  /** The failed jobs a re-run replaces, by id. */
  replaces: z.array(z.number()),
  at: z.number(),
});
type Tried = z.infer<typeof Tried>;
const Kept = z.object({ sessions: z.record(z.string(), Tried) });

/**
 * What's next for a pull request whose checks failed: nothing while the worker's try runs, the
 * session to bring it up to date (`conflict`), or to fix it (`fix`), told when it's failed again
 * after a re-run (`fix-again`).
 */
export type AfterFailing = "wait" | "conflict" | "fix" | "fix-again";

/** The test file a failure names ("[chromium] › e2e/live.spec.ts:12:3 › …"), if it names one. */
const testFileOf = (failure: string) =>
  /(?:^|[\s/[(])([\w.@-]+(?:\/[\w.@-]+)*\.(?:spec|test)\.[cm]?[jt]sx?)\b/.exec(failure)?.[1];

/** Whether a pull request's changed file is that test file, which may be named from its package. */
const isFile = (changed: string, test: string) =>
  changed === test || changed.endsWith(`/${test}`) || test.endsWith(`/${changed}`);

export const createFailedChecks = (options: {
  dataDir: string;
  github: Pick<GitHub, "commitJobs" | "rerunFailedJobs" | "checkRunFailure" | "commandEnv">;
  code: Pick<Code, "onGitHub" | "reviewOf" | "freshDefault" | "worktreeOf">;
  now: () => number;
}) => {
  const { github, code } = options;
  const keptFile = join(options.dataDir, FILE);

  const keep = async (session: SessionId, tried: Tried) => {
    const kept = await readJsonFile(keptFile, Kept);
    const sessions = kept.ok ? (kept.value?.sessions ?? {}) : {};
    const written = await writeJsonFile(keptFile, { sessions: { ...sessions, [session]: tried } });
    if (!written.ok) console.error(`Session ${session}: what was tried on its checks wasn't kept`);
  };

  /**
   * Brings the session's branch up to date with its base, as GitHub's Update branch does: merged
   * in its worktree and pushed, only while it's clean and at the commit the pull request is on.
   * `conflict` when it can't merge cleanly; `undefined` when it isn't behind or can't be tried.
   */
  const update = async (look: {
    id: SessionId;
    repoPath: string;
    branch: string;
    head: string;
  }) => {
    const worktree = code.worktreeOf(look.id);
    const at = await gitOrNothing(worktree, ["rev-parse", "HEAD"]);
    const dirty = await gitOrNothing(worktree, ["status", "--porcelain"]);
    if (at !== look.head || dirty !== "") return undefined;
    const fresh = await code.freshDefault(look.repoPath);
    if (!fresh.ok) return undefined;
    const behind = await gitOrNothing(worktree, [
      "rev-list",
      "--count",
      `HEAD..${fresh.value.tracking}`,
    ]);
    if (behind === undefined || Number(behind) === 0) return undefined;
    try {
      await git(worktree, ["merge", "--quiet", "--no-edit", "--no-verify", fresh.value.tracking], {
        config: AS_COURTYARD,
      });
    } catch {
      const conflicted = await gitOrNothing(worktree, ["diff", "--name-only", "--diff-filter=U"]);
      await gitOrNothing(worktree, ["merge", "--abort"]);
      return conflicted === undefined || conflicted === "" ? undefined : ("conflict" as const);
    }
    try {
      await git(
        worktree,
        ["push", "--quiet", "--no-verify", REMOTE, `HEAD:refs/heads/${look.branch}`],
        {
          timeoutMs: REMOTE_TIMEOUT_MS,
          env: await github.commandEnv(),
        },
      );
      return "updated" as const;
    } catch {
      // Not pushed: the branch is left as the pull request has it.
      await gitOrNothing(worktree, ["reset", "--quiet", "--hard", look.head]);
      return undefined;
    }
  };

  /** Whether every failed job names a test, and none of them is a file the pull request changes. */
  const untouched = async (
    look: { repo: string; repoPath: string; branch: string },
    failed: readonly { id: number }[],
  ) => {
    const review = await code.reviewOf({ repoPath: look.repoPath, branch: look.branch });
    if (!review.ok || review.value === undefined) return false;
    const changed = review.value.files.map((file) => file.path);
    for (const job of failed) {
      const named = await github.checkRunFailure({ repo: look.repo, id: job.id });
      const test = named.ok && named.value !== null ? testFileOf(named.value) : undefined;
      if (test === undefined || changed.some((path) => isFile(path, test))) return false;
    }
    return true;
  };

  return {
    /**
     * What the worker does itself about a pull request's failed checks before its session is
     * asked, and what's next. Once per commit each: an update, then a re-run.
     */
    tryAgain: async (look: {
      id: SessionId;
      repoPath: string;
      branch: string;
      pullRequest: PullRequest;
    }): Promise<AfterFailing> => {
      const { head } = look.pullRequest;
      const kept = await readJsonFile(keptFile, Kept);
      const last = kept.ok ? kept.value?.sessions[look.id] : undefined;
      const tried = last?.head === head ? last : undefined;
      const waiting = tried !== undefined && options.now() - tried.at < TRY_WAITS_MS;
      const repo = await code.onGitHub(look.repoPath);
      const jobs = repo.ok
        ? await github.commitJobs({ repo: repo.value, commit: head })
        : undefined;
      // GitHub can't say which jobs failed, so there's nothing to re-run.
      if (!repo.ok || jobs?.ok !== true || jobs.value === undefined) return "fix";
      if (jobs.value.some((job) => job.outcome === "running")) return "wait";
      const failed = jobs.value.filter((job) => job.outcome === "failed");
      if (tried?.how === "rerun") {
        // GitHub hasn't started the new try yet (or never did), else this is its second failure.
        const replaced = failed.some((job) => tried.replaces.includes(job.id));
        if (replaced) return waiting ? "wait" : "fix";
        return "fix-again";
      }
      // Pushed: the pull request moves on to the new commit once GitHub has it.
      if (tried?.how === "updated" && waiting) return "wait";
      if (tried === undefined) {
        const updated = await update({ ...look, head });
        if (updated === "conflict") return "conflict";
        if (updated === "updated") {
          await keep(look.id, { head, how: "updated", replaces: [], at: options.now() });
          return "wait";
        }
      }
      if (failed.length === 0) return "fix";
      if (!(await untouched({ ...look, repo: repo.value }, failed))) return "fix";
      const rerun = await github.rerunFailedJobs({ repo: repo.value, commit: head });
      if (!rerun.ok) return "fix";
      const replaces = failed.map((job) => job.id);
      await keep(look.id, { head, how: "rerun", replaces, at: options.now() });
      return "wait";
    },
  };
};

export type FailedChecks = ReturnType<typeof createFailedChecks>;
