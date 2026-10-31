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
 * 0041). A Lead builder's branch behind its base is brought up to date first, as GitHub's Update
 * branch does: its base merged in, in the session's worktree, and pushed, so its checks run again;
 * a conflict goes to the session. A failure in tests the pull request doesn't touch is re-run once.
 * Anything else, a second failure, or anything the worker can't tell, goes to the session.
 */

/** Where what was tried for each session's pull request is kept, in the data folder. */
const FILE = "failed-checks.json";

/** How long a try is waited for before the session is asked anyway: GitHub may never start it. */
const TRY_WAITS_MS = 10 * 60 * 1000;

/** The most sessions whose tries are kept, the latest, so the file stays small. */
const KEPT_AT_MOST = 100;

/** What was tried on a session's pull request's latest commit. */
const Tried = z.object({
  head: z.string(),
  how: z.enum(["updated", "rerun"]),
  /** The failed jobs a re-run replaces, by id. */
  replaces: z.array(z.number()),
  /** The merge commit an update pushed, which is never brought up to date again itself. */
  pushed: z.string().optional(),
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
  github: Pick<GitHub, "commitJobs" | "rerunFailedJobs" | "checkRunFailures" | "commandEnv">;
  code: Pick<Code, "onGitHub" | "reviewOf" | "freshDefault" | "worktreeOf">;
  /**
   * Runs `step` while no turn or task runs in the session, and none starts until it's done;
   * `undefined`, without running it, while one does.
   */
  whileIdle: <T>(id: SessionId, step: () => Promise<T>) => Promise<T | undefined>;
  now: () => number;
}) => {
  const { github, code } = options;
  const keptFile = join(options.dataDir, FILE);

  /** Each session's latest try, or `undefined` when the file can't be read. */
  const readKept = async () => {
    const kept = await readJsonFile(keptFile, Kept);
    return kept.ok ? (kept.value?.sessions ?? {}) : undefined;
  };

  /** Keeps a session's latest try, and only the latest sessions'; whether it was kept. */
  const keep = async (session: SessionId, tried: Tried) => {
    const sessions = { ...(await readKept()), [session]: tried };
    const latest = Object.entries(sessions)
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, KEPT_AT_MOST);
    const written = await writeJsonFile(keptFile, { sessions: Object.fromEntries(latest) });
    if (!written.ok) console.error(`Session ${session}: what was tried on its checks wasn't kept`);
    return written.ok;
  };

  /**
   * Brings the session's branch up to date with its base, as GitHub's Update branch does: merged
   * in its worktree and pushed, only while no turn or task runs there and it's clean, on its
   * branch and at the commit the pull request is on. Never forced: a branch that moved on GitHub
   * meanwhile refuses it. `conflict` when it can't merge cleanly (the merge undone); the commit
   * pushed; or `undefined` when it isn't behind or can't be tried.
   */
  const update = async (look: {
    id: SessionId;
    repoPath: string;
    branch: string;
    head: string;
  }): Promise<"conflict" | { pushed: string } | undefined> => {
    const worktree = code.worktreeOf(look.id);
    const fresh = await code.freshDefault(look.repoPath);
    if (!fresh.ok) return undefined;
    const { tracking } = fresh.value;
    return options.whileIdle(look.id, async () => {
      const on = await gitOrNothing(worktree, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      const at = await gitOrNothing(worktree, ["rev-parse", "HEAD"]);
      const dirty = await gitOrNothing(worktree, ["status", "--porcelain"]);
      if (on !== look.branch || at !== look.head || dirty !== "") return undefined;
      const behind = await gitOrNothing(worktree, ["rev-list", "--count", `HEAD..${tracking}`]);
      if (behind === undefined || Number(behind) === 0) return undefined;
      try {
        await git(worktree, ["merge", "--quiet", "--no-ff", "--no-edit", "--no-verify", tracking], {
          config: AS_COURTYARD,
        });
      } catch {
        const conflicted = await gitOrNothing(worktree, ["diff", "--name-only", "--diff-filter=U"]);
        await gitOrNothing(worktree, ["merge", "--abort"]);
        return conflicted === undefined || conflicted === "" ? undefined : ("conflict" as const);
      }
      const merged = await gitOrNothing(worktree, ["rev-parse", "HEAD"]);
      try {
        if (merged === undefined) throw new Error("The merge commit can't be named.");
        await git(
          worktree,
          ["push", "--quiet", "--no-verify", REMOTE, `${merged}:refs/heads/${look.branch}`],
          {
            timeoutMs: REMOTE_TIMEOUT_MS,
            env: await github.commandEnv(),
          },
        );
        return { pushed: merged };
      } catch {
        // Not pushed: the branch goes back to the pull request's commit, as GitHub has it.
        await gitOrNothing(worktree, ["reset", "--quiet", "--keep", look.head]);
        return undefined;
      }
    });
  };

  /**
   * Whether every failed job names only tests, all of them, none in a file the pull request
   * changes on `head`. `false` whenever that can't be told.
   */
  const untouched = async (
    look: { repo: string; repoPath: string; branch: string; head: string },
    failed: readonly { id: number }[],
  ) => {
    const review = await code.reviewOf({ repoPath: look.repoPath, branch: look.branch });
    if (!review.ok || review.value === undefined) return false;
    const { files, pullRequest } = review.value;
    // Every file it changes on the commit that failed, or it can't be told.
    if (pullRequest.head !== look.head || files.length < pullRequest.changes.files) return false;
    for (const job of failed) {
      const named = await github.checkRunFailures({ repo: look.repo, id: job.id });
      if (!named.ok || !named.value.complete || named.value.named.length === 0) return false;
      for (const failure of named.value.named) {
        const test = testFileOf(failure);
        if (test === undefined || files.some((file) => isFile(file.path, test))) return false;
      }
    }
    return true;
  };

  return {
    /**
     * What the worker does itself about a pull request's failed checks before its session is
     * asked, and what's next. Once per commit each: an update (`mayUpdate`), then a re-run.
     */
    tryAgain: async (look: {
      id: SessionId;
      repoPath: string;
      branch: string;
      pullRequest: PullRequest;
      /** Its branch may be brought up to date: a Lead builder's own (#740). */
      mayUpdate: boolean;
    }): Promise<AfterFailing> => {
      const { head } = look.pullRequest;
      const sessions = await readKept();
      if (sessions === undefined) {
        // What was tried can't be told, so nothing is tried again, and the file starts afresh.
        console.error(`${FILE} couldn't be read, so it starts afresh`);
        await writeJsonFile(keptFile, { sessions: {} });
        return "fix";
      }
      const last = sessions[look.id];
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
      // The commit an update pushed fails on its own: it isn't brought up to date again.
      if (tried === undefined && look.mayUpdate && last?.pushed !== head) {
        const updated = await update({ ...look, head });
        if (updated === "conflict") return "conflict";
        if (updated !== undefined) {
          const { pushed } = updated;
          await keep(look.id, { head, how: "updated", replaces: [], pushed, at: options.now() });
          return "wait";
        }
      }
      if (failed.length === 0) return "fix";
      if (!(await untouched({ ...look, repo: repo.value, head }, failed))) return "fix";
      const replaces = failed.map((job) => job.id);
      // Kept before it's asked, so one commit's jobs are never re-run twice.
      if (!(await keep(look.id, { head, how: "rerun", replaces, at: options.now() }))) return "fix";
      const rerun = await github.rerunFailedJobs({ repo: repo.value, commit: head });
      return rerun.ok ? "wait" : "fix";
    },
  };
};

export type FailedChecks = ReturnType<typeof createFailedChecks>;
