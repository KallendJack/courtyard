import { basename, dirname, isAbsolute, join } from "node:path";
import type { BuildsLock } from "@courtyard/builds";
import {
  type AlwaysAllow,
  type ApprovalAsk,
  CODE_SESSIONS_AT_ONCE,
  type PullRequestReview,
  type SessionId,
  wordsOf,
} from "@courtyard/contract";
import { shownPath, staysInside } from "../../auth/workspace-files/index.ts";
import type {
  FoundPullRequest,
  GitHub,
  GitHubProblem,
  OpenFound,
} from "../../integrations/github/index.ts";
import { exists, isFolder, listFolder, removeFolder } from "../../lib/files.ts";
import { type CommandEnv, git, gitFailureReason, gitIgnores, gitOrNothing } from "../../lib/git.ts";
import { createOneAtATime } from "../../lib/one-at-a-time.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import {
  allowsAll,
  alwaysOffer,
  type CommandRule,
  checksEverything,
  type IssueGap,
  isBuild,
  issueGapsIn,
  isTaskOnly,
  reachesOut,
  ruleFor,
  runsFromOf,
} from "./allowlist.ts";
import { BRANCH_PREFIX, helperBranchStem, isHelperBranchOf } from "./branches.ts";
import { createBuildsQueue } from "./builds.ts";
import {
  type BranchRefusal,
  defaultBranchOf,
  gitHubRepoOf,
  REMOTE,
  REMOTE_TIMEOUT_MS,
  unusedBranch,
} from "./remote.ts";
import { createCodeSlots } from "./slots.ts";
import { checkOutAgain, keepOnWip } from "./wip.ts";

export {
  allowlistFor,
  allowsOf,
  alwaysRule,
  type CommandRule,
  type IssueGap,
  isBuild,
  namedAs,
} from "./allowlist.ts";
export { BUILD_HELD_ENV } from "./builds.ts";
export type { BranchRefusal } from "./remote.ts";

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
export type SessionBranch = {
  readonly branch: string;
  readonly worktree: string;
  /** The branch was in the repository before the session (#326): clearing the session leaves it. */
  readonly kept?: true;
};

/**
 * A helper's own branch (#395) and the folder it's checked out in: branched from its session's
 * branch, in a folder beside the session's worktree, so its folder gives it test ports of its own.
 */
export type HelperBranch = { readonly branch: string; readonly worktree: string };

/** How a helper's branch merging back into its session branch went (#395). */
export type MergeBack = "merged" | "clash";

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
  /** The dev or start script, run in the foreground: it runs only as a task (#182). */
  | { readonly kind: "task-only" }
  /** A Lead's builder's heavy check asked to run as a task: it runs in the turn (#589). */
  | { readonly kind: "check-in-turn" }
  /** A Lead's builder's check of a whole suite, which CI runs (#589). */
  | { readonly kind: "ci-runs-it" }
  /** The owner denied the approval it needed (#171). */
  | { readonly kind: "denied"; readonly what: "command" | "edit" | "tool" }
  /** `gh issue create` filing an issue without a milestone, a category or one triage label (#324). */
  | { readonly kind: "unfiled"; readonly gaps: readonly [IssueGap, ...IssueGap[]] };

/**
 * A command only the owner can allow (#171): one off the command allowlist, one naming a path
 * outside the worktree, or one running code from a folder git ignores (#219).
 */
export type CommandApproval = {
  readonly kind: "needs-approval";
  readonly reason: Extract<ApprovalAsk, { kind: "command" }>["reason"];
  /** What Allow always would allow (#185), when it may be offered: never for one reaching out. */
  readonly always?: AlwaysAllow;
  /** Allow all for this task would cover it (#428): it runs without asking while that's on. */
  readonly all?: true;
};

/**
 * Whether a command may run in a session's worktree without asking: one command, on the command
 * allowlist, naming no path outside the worktree, and, for committing, with the worktree on the
 * session branch. One that could run only with the owner's approval says so. An issue filed
 * without what every issue has is refused before anyone is asked (#324).
 */
export const commandAllowed = async (
  session: {
    readonly worktree: string;
    readonly branch: string;
    /** Its pull request's number, once it has one (#172). */
    readonly pullRequest?: number | undefined;
    /** Its code workspace's command allowlist (`allowlistFor`). */
    readonly allowlist: readonly CommandRule[];
    /** The command is to run as a task (#182), so the dev and start scripts may. */
    readonly asTask?: boolean;
    /**
     * It's a Lead's builder (#589): it runs its heavy checks in the turn, and none of a whole
     * suite, which CI runs.
     */
    readonly builder?: boolean;
  },
  command: string,
): Promise<Result<null, CodeRefusal | CommandApproval>> => {
  const words = wordsOf(command);
  if (!words.ok) return err({ kind: words.error });
  if (session.builder === true && isBuild(command)) {
    if (session.asTask === true) return err({ kind: "check-in-turn" });
    if (checksEverything(command)) return err({ kind: "ci-runs-it" });
  }
  const [gap, ...gaps] = issueGapsIn(words.value);
  if (gap !== undefined) return err({ kind: "unfiled", gaps: [gap, ...gaps] });
  const work = { branch: session.branch, pullRequest: session.pullRequest };
  if (session.asTask !== true && isTaskOnly(session.allowlist, words.value, work))
    return err({ kind: "task-only" });
  const rule = ruleFor(session.allowlist, words.value, work);
  if (rule === undefined) {
    const always = alwaysOffer(words.value);
    return err({
      kind: "needs-approval",
      reason: "off-allowlist",
      ...(always === undefined ? {} : { always }),
      ...(allowsAll(session.worktree, words.value) ? { all: true } : {}),
    });
  }
  if (reachesOut(session.worktree, rule, words.value)) {
    return err({ kind: "needs-approval", reason: "reaches-out" });
  }
  // Code a download can bring is run only with the owner's OK (#219), and so is code where git
  // can't say.
  for (const from of runsFromOf(session.allowlist, words.value, work)) {
    if ((await gitIgnores(session.worktree, from)) !== false) {
      return err({ kind: "needs-approval", reason: "ignored-folder" });
    }
  }
  if (rule.unpacksInto !== undefined) {
    const folder = rule.unpacksInto(words.value.slice(rule.words.length));
    if (folder === undefined || !(await unpacksSafely(session.worktree, folder))) {
      return err({ kind: "needs-approval", reason: "off-allowlist" });
    }
  }
  if (rule.onSessionBranch) {
    const on = await gitOrNothing(session.worktree, ["branch", "--show-current"]);
    if (on !== session.branch) return err({ kind: "off-branch", branch: session.branch });
  }
  return ok(null);
};

/**
 * Folders that decide what a repository's allowed commands run, wherever they are in it: git's own
 * (`.git`, a file in a worktree, saying where the repository is), git hooks' usual homes, Claude
 * Code's project settings and hooks, and `.github` (CI workflows and actions, which run with the
 * repository's secrets).
 */
const SETUP_FOLDERS = new Set([".git", ".githooks", ".husky", ".lefthook", ".claude", ".github"]);
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

/**
 * Setup folders and files Allow all for this task (#428) never edits without asking: git's own
 * (which says where the repository is, outside the worktree), `.github` (workflows that run with
 * the repository's secrets), Claude Code's settings (which decide what the model itself may do),
 * and the package managers' settings, which hold registry tokens.
 */
const ALL_ASKING_SETUP = new Set([
  ".git",
  ".github",
  ".claude",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
]);

/**
 * Whether Allow all for this task covers an edit to a setup file (`isSetup`): package scripts and
 * git hooks ("package.json, hooks and the like"), never one in `ALL_ASKING_SETUP` or a name
 * Windows could shorten one of those to.
 */
const allowsAllSetup = (shown: string) =>
  !shown
    .split("/")
    .map(asWindowsReads)
    .some((part) => ALL_ASKING_SETUP.has(part) || /~\d/.test(part));

/** Where an edit a model asks for in a session's worktree would land. */
export type EditPlace =
  /** Inside the worktree: it applies without asking. By its path as the owner sees it. */
  | { readonly kind: "inside"; readonly shown: string }
  /**
   * Inside, but on a file that decides what its allowed commands run: it needs an approval, unless
   * the session allows all and that covers it (`all`, #428).
   */
  | { readonly kind: "setup"; readonly shown: string; readonly all: boolean }
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
    ? { kind: "setup", shown, all: allowsAllSetup(shown) }
    : { kind: "inside", shown };
};

/**
 * Whether a command may unpack files into a folder of the worktree without asking (`gh run
 * download -D`, #202): one git ignores, that's neither the worktree itself nor a file that decides
 * what allowed commands run (`editPlaceIn`). Anywhere else, what it unpacks could replace one of
 * those without the approval an edit to it needs.
 */
const unpacksSafely = async (worktree: string, folder: string) => {
  const place = await editPlaceIn(worktree, folder);
  if (place.kind !== "inside") return false;
  // With a trailing slash, git reads it as a folder even before the download makes it.
  return (await gitIgnores(worktree, `${place.shown}/`)) === true;
};

/**
 * What a code session's commands get in their environment: its slot among the code sessions
 * running, 1 to `CODE_SESSIONS_AT_ONCE`, which no other running one has, for a repository's checks
 * to pick their test servers' ports from (this repository's Playwright config does), and the
 * worktree that slot is for (#395): a helper on a branch of its own runs in another folder, under
 * the same slot when its provider shares one environment with the session (Claude Code), and
 * picks its ports from its folder instead.
 */
export const slotEnv = (held: { slot: number; worktree: string }) => ({
  COURTYARD_SESSION_SLOT: String(held.slot),
  COURTYARD_SESSION_WORKTREE: held.worktree,
});

export const createCode = (options: {
  dataDir: string;
  /** The environment a session's commands get: Courtyard's GitHub sign-in (#99). */
  commandEnv: () => Promise<CommandEnv>;
  /**
   * A session branch's pull request on GitHub: followed (#172), reviewed, merged, closed (#160);
   * and every open one on the repository, each by its number (#278).
   */
  pullRequests: Pick<
    GitHub,
    | "pullRequest"
    | "review"
    | "merge"
    | "close"
    | "deleteBranch"
    | "openPullRequests"
    | "reviewNumbered"
    | "pullRequestNumbered"
  >;
  /** The machine's builds lock (#306), which code sessions' heavy checks take turns in (#281). */
  buildsLock: BuildsLock;
  /** Told after a pull request is merged from the app, so what's kept of main is asked afresh (#387). */
  onMerged?: () => void;
}) => {
  const { pullRequests } = options;
  /** The repository a code workspace's remote is on GitHub, or why there's none to ask. */
  const onGitHub = async (repoPath: string): Promise<Result<string, PullRequestProblem>> => {
    const repo = await gitHubRepoOf(repoPath);
    return repo === undefined ? err({ kind: "not-on-github" }) : ok(repo);
  };
  const worktreeOf = (id: SessionId) => join(options.dataDir, "worktrees", id);

  /** Each repository's default branch, as its remote said it once (#423). */
  const defaultBranches = new Map<string, string>();

  /**
   * The files a session's worktree changes (#423), from the repository: committed since it left
   * the default branch as last fetched, changed since, and new; none when that can't be told.
   */
  const changedFiles = async (change: {
    repoPath: string;
    worktree: string;
  }): Promise<readonly string[]> => {
    let main = defaultBranches.get(change.repoPath);
    if (main === undefined) {
      const told = await defaultBranchOf(change.repoPath, await options.commandEnv());
      if (!told.ok) return [];
      main = told.value;
      defaultBranches.set(change.repoPath, main);
    }
    const listed = async (args: readonly string[]) =>
      ((await gitOrNothing(change.worktree, args)) ?? "")
        .split(/\r?\n/)
        .filter((line) => line !== "");
    const all = await Promise.all([
      listed(["diff", "--name-only", `refs/remotes/${REMOTE}/${main}...HEAD`]),
      listed(["diff", "--name-only", "HEAD"]),
      listed(["ls-files", "--others", "--exclude-standard"]),
    ]);
    return [...new Set(all.flat())];
  };

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

  /** Helpers' branches made and merged one at a time, so two never pick the same name (#395). */
  const helperGit = createOneAtATime();

  /**
   * Clears a helper's worktree and branch away (#395): the folder first, by Node, then git forgets
   * it, as for a session's (`clearBranch`). Anything left behind is only logged.
   */
  const removeHelper = async (gitFolder: string, helper: HelperBranch) => {
    if (!(await removeFolder(helper.worktree))) {
      console.error("A helper's worktree couldn't be cleared away:", helper.worktree);
    }
    try {
      await git(gitFolder, ["worktree", "prune"]);
      const there = await git(gitFolder, ["branch", "--list", helper.branch]);
      if (there.trim() !== "") await git(gitFolder, ["branch", "-D", helper.branch]);
    } catch (error) {
      console.error("A helper's branch couldn't be cleared away:", gitFailureReason(error));
    }
  };

  /**
   * Clears every one of a session's helpers' worktrees and branches away (#395), when the session
   * ends or is deleted: the folders beside its worktree, and the branches named after its own.
   */
  const clearHelpers = async (clear: { repoPath: string; sessionBranch: SessionBranch }) => {
    const { repoPath, sessionBranch } = clear;
    const beside = dirname(sessionBranch.worktree);
    const stem = `${basename(sessionBranch.worktree)}-helper-`;
    const folders = await listFolder(beside);
    for (const name of folders.ok ? folders.value : []) {
      if (name.startsWith(stem)) await removeFolder(join(beside, name));
    }
    try {
      await git(repoPath, ["worktree", "prune"]);
      const listed = await git(repoPath, [
        "branch",
        "--list",
        "--format=%(refname:short)",
        `${helperBranchStem(sessionBranch.branch)}*`,
      ]);
      for (const branch of listed.split(/\r?\n/).map((line) => line.trim())) {
        if (isHelperBranchOf(sessionBranch.branch, branch)) {
          await git(repoPath, ["branch", "-D", branch]);
        }
      }
    } catch (error) {
      console.error(
        "A session's helpers' branches couldn't be cleared away:",
        gitFailureReason(error),
      );
    }
  };

  /**
   * Clears a session's worktree and branch away, for a session that never started, one whose pull
   * request was merged or closed (#172), or a quiet one (#605): then, `pushed`, its branch on
   * GitHub too (story 40), only ever one of Courtyard's own (`courtyard/…`). A branch the session
   * didn't make (`kept`, #326) stays, in the repository and on GitHub. Anything left behind is the
   * repository's to keep, so a failure is only logged. Whether its folder went: a process holding
   * it (a server, an editor) keeps it on Windows.
   */
  const clearBranch = async (clear: {
    repoPath: string;
    sessionBranch: SessionBranch;
    pushed: boolean;
  }) => {
    const { repoPath, sessionBranch } = clear;
    await clearHelpers({ repoPath, sessionBranch });
    // The folder goes first, by Node, then git forgets it: `git worktree remove` can't delete a
    // package install nested past Windows' path limit, and once it has half-removed a worktree
    // it refuses to touch it again ("is not a working tree").
    const gone = await removeFolder(sessionBranch.worktree);
    if (!gone)
      console.error("A session's worktree couldn't be cleared away:", sessionBranch.worktree);
    try {
      await git(repoPath, ["worktree", "prune"]);
      const there = await git(repoPath, ["branch", "--list", sessionBranch.branch]);
      if (there.trim() !== "" && sessionBranch.kept !== true) {
        await git(repoPath, ["branch", "-D", sessionBranch.branch]);
      }
    } catch (error) {
      console.error("A session branch couldn't be cleared away:", gitFailureReason(error));
    }
    const repo = clear.pushed ? await gitHubRepoOf(repoPath) : undefined;
    if (repo === undefined || !sessionBranch.branch.startsWith(BRANCH_PREFIX)) return gone;
    const deleted = await pullRequests.deleteBranch({ repo, branch: sessionBranch.branch });
    // GitHub may have deleted it already, on merging.
    if (!deleted.ok && !/Reference does not exist/i.test(JSON.stringify(deleted.error)))
      console.error("A session branch on GitHub couldn't be deleted:", deleted.error);
    return gone;
  };

  return {
    /** The folder a session's branch is checked out in. */
    worktreeOf,
    changedFiles,

    /**
     * Gives a helper that writes code a branch of its own (#395): from the session branch's last
     * commit, checked out in a folder beside the session's worktree, numbered after the session's
     * helpers' so far. Or git's reason it couldn't be.
     */
    branchOff: (session: SessionBranch): Promise<Result<HelperBranch, string>> =>
      helperGit(async () => {
        for (let number = 1; ; number += 1) {
          const branch = `${helperBranchStem(session.branch)}${number}`;
          const worktree = `${session.worktree}-helper-${number}`;
          const taken = await exists(worktree);
          if (!taken.ok) return err(`${worktree} couldn't be checked`);
          if (taken.value) continue;
          if ((await gitOrNothing(session.worktree, ["branch", "--list", branch])) !== "") continue;
          try {
            await git(session.worktree, [
              "worktree",
              "add",
              "--quiet",
              "--no-track",
              "-b",
              branch,
              worktree,
              "HEAD",
            ]);
            return ok({ branch, worktree });
          } catch (error) {
            return err(gitFailureReason(error));
          }
        }
      }),

    /**
     * Merges a helper's branch back into its session branch when it finishes (#395): anything it
     * left uncommitted is committed on its branch first, as `message`, so none of its work is
     * lost; then the session's worktree merges it, as long as it's on the session branch. Merged,
     * the helper's worktree and branch are cleared away. A clash stops the merge, leaving the
     * session's worktree as it was, and keeps the helper's branch for the session's model to
     * merge itself. Neither runs the repository's own hooks: the worker commits and merges.
     */
    mergeBack: (merge: {
      session: SessionBranch;
      helper: HelperBranch;
      message: string;
    }): Promise<MergeBack> =>
      helperGit(async () => {
        const { session, helper } = merge;
        const env = await options.commandEnv();
        try {
          const left = await git(helper.worktree, ["status", "--porcelain"]);
          if (left !== "") {
            await git(helper.worktree, ["add", "--all"], { env });
            await git(helper.worktree, ["commit", "--quiet", "--no-verify", "-m", merge.message], {
              env,
            });
          }
          const on = await git(session.worktree, ["branch", "--show-current"]);
          if (on !== session.branch) return "clash";
        } catch {
          return "clash";
        }
        try {
          await git(
            session.worktree,
            ["merge", "--quiet", "--no-edit", "--no-verify", helper.branch],
            { env },
          );
        } catch {
          await gitOrNothing(session.worktree, ["merge", "--abort"]);
          return "clash";
        }
        await removeHelper(session.worktree, helper);
        return "merged";
      }),

    /** Clears a session's helpers' worktrees and branches away (#395). */
    clearHelpers,

    /** The repository's default branch on its remote, freshly fetched (the setup check, #181). */
    freshDefault,

    /** The repository a code workspace's remote is on GitHub, as `owner/name`, or why there's none. */
    onGitHub,

    /** Which code sessions are running, and which wait for one to end. */
    slots: createCodeSlots(CODE_SESSIONS_AT_ONCE),

    /** The builds queue (#281): which heavy checks run, and which wait for one to end. */
    builds: createBuildsQueue(options.buildsLock),

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
     * Starts a session on a pull request's branch that no session opened (#278): the branch as
     * it is on the remote, freshly fetched, checked out in the session's own worktree as a branch
     * of that name tracking it, so the session pushes to the same pull request. One the repository
     * has already (#326), checked out nowhere and with nothing its remote lacks, is brought up to
     * the remote and used, and kept when the session is cleared away; any other is refused.
     */
    startOnBranch: async (start: {
      repoPath: string;
      sessionId: SessionId;
      branch: string;
    }): Promise<Result<SessionBranch, BranchRefusal>> => {
      const { repoPath, sessionId, branch } = start;
      const there = await isFolder(repoPath);
      if (!there.ok || !there.value) return err({ kind: "repo-missing", repoPath });
      const named = await gitOrNothing(repoPath, ["check-ref-format", "--branch", branch]);
      if (named === undefined || branch.startsWith("-")) {
        return err({ kind: "git", reason: `${branch} isn't a branch name git takes` });
      }
      const tracking = `refs/remotes/${REMOTE}/${branch}`;
      try {
        await git(repoPath, ["fetch", "--quiet", REMOTE, `+refs/heads/${branch}:${tracking}`], {
          timeoutMs: REMOTE_TIMEOUT_MS,
          env: await options.commandEnv(),
        });
      } catch (error) {
        return err({ kind: "remote", reason: gitFailureReason(error) });
      }
      const existing = (await gitOrNothing(repoPath, ["branch", "--list", branch])) !== "";
      if (existing) {
        const unused = await unusedBranch(repoPath, { branch, tracking });
        if (!unused.ok) return unused;
      }
      const worktree = worktreeOf(sessionId);
      try {
        // One already there is brought up to its remote first: it has nothing the remote lacks.
        if (existing) {
          await git(repoPath, ["branch", "--quiet", "--force", "--track", branch, tracking]);
        }
        await git(
          repoPath,
          existing
            ? ["worktree", "add", "--quiet", worktree, branch]
            : ["worktree", "add", "--quiet", "--track", "-b", branch, worktree, tracking],
        );
      } catch (error) {
        return err({ kind: "git", reason: gitFailureReason(error) });
      }
      return ok({ branch, worktree, ...(existing ? { kept: true } : {}) });
    },

    /**
     * Every open pull request on the code workspace's repository (#278), latest first, or why
     * GitHub can't be asked.
     */
    openPullRequests: async (find: {
      repoPath: string;
    }): Promise<Result<readonly OpenFound[], PullRequestProblem>> => {
      const repo = await onGitHub(find.repoPath);
      if (!repo.ok) return repo;
      return pullRequests.openPullRequests({ repo: repo.value });
    },

    /** Pull request `number` as the owner reviews it (#278): `undefined` when there's none. */
    reviewNumbered: async (find: {
      repoPath: string;
      number: number;
    }): Promise<Result<PullRequestReview | undefined, PullRequestProblem>> => {
      const repo = await onGitHub(find.repoPath);
      if (!repo.ok) return repo;
      return pullRequests.reviewNumbered({ repo: repo.value, number: find.number });
    },

    /** Pull request `number` as GitHub has it (#278): `undefined` when there's none. */
    pullRequestNumbered: async (find: {
      repoPath: string;
      number: number;
    }): Promise<Result<FoundPullRequest | undefined, PullRequestProblem>> => {
      const repo = await onGitHub(find.repoPath);
      if (!repo.ok) return repo;
      return pullRequests.pullRequestNumbered({ repo: repo.value, number: find.number });
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
      const merged = await pullRequests.merge({
        repo: repo.value,
        number: pull.number,
        head: pull.head,
      });
      if (merged.ok) options.onMerged?.();
      return merged;
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

    clearBranch,

    /** When a worktree's latest commit was made (#605), or `undefined` when git can't say. */
    lastCommitAt: async (worktree: string) => {
      const at = await gitOrNothing(worktree, ["log", "-1", "--format=%ct"]);
      return at === undefined || at === "" ? undefined : Number(at) * 1000;
    },

    /**
     * Clears a quiet session's worktree, branch and helpers away (#605), once what GitHub lacks is
     * kept on its `wip/` branch (`keepOnWip`): that branch, why it stays, or git's reason it does.
     */
    clearQuiet: async (clear: { repoPath: string; sessionBranch: SessionBranch }) => {
      const { worktree, branch } = clear.sessionBranch;
      const kept = await keepOnWip({ worktree, branch, env: await options.commandEnv() });
      if (kept.ok && kept.value.kind === "kept") await clearBranch({ ...clear, pushed: false });
      return kept;
    },

    /**
     * Checks a cleared session's branch out again in its worktree (#605, `checkOutAgain`), then
     * deletes its `wip/` branch on GitHub, whose work the branch has again.
     */
    checkOutAgain: async (back: {
      repoPath: string;
      sessionId: SessionId;
      branch: string;
      wip: string | undefined;
    }): Promise<Result<null, BranchRefusal>> => {
      const { repoPath, wip } = back;
      const env = await options.commandEnv();
      const worktree = worktreeOf(back.sessionId);
      const fresh = () => freshDefault(repoPath);
      const out = await checkOutAgain({ ...back, worktree, env, fresh });
      const repo = out.ok && wip !== undefined ? await gitHubRepoOf(repoPath) : undefined;
      if (repo !== undefined && wip !== undefined) {
        const deleted = await pullRequests.deleteBranch({ repo, branch: wip });
        if (!deleted.ok)
          console.error("A wip branch on GitHub couldn't be deleted:", deleted.error);
      }
      return out;
    },
  };
};

export type Code = ReturnType<typeof createCode>;
