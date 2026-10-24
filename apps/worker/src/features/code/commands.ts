import { isAbsolute } from "node:path";
import { type AlwaysAllow, type ApprovalAsk, wordsOf } from "@courtyard/contract";
import { shownPath, staysInside } from "../../auth/workspace-files/index.ts";
import { gitIgnores, gitOrNothing } from "../../lib/git.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import { allowsAll } from "./allowing-all.ts";
import {
  alwaysOffer,
  type CommandRule,
  checksEverything,
  type IssueGap,
  isBuild,
  issueGapsIn,
  isTaskOnly,
  ruleFor,
  runsFromOf,
} from "./allowlist.ts";
import { codeWordsOf } from "./inline-code.ts";
import { outside, reachesOut } from "./paths.ts";
import { afterEnv, withoutEnv } from "./routine.ts";

/**
 * Whether a code session's commands and edits run without asking (ADR 0007): the allowlist, read
 * against the worktree's files and git.
 */

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
  /** A Lead's builder's push to the default branch, which it never makes (#730). */
  | { readonly kind: "default-branch"; readonly branch: string }
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

/** A repository on GitHub as `owner/name`, from its remote's address in any of git's forms. */
const GITHUB_REMOTE =
  /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

/**
 * The repository a code workspace's remote is on GitHub, as `owner/name`, or `undefined` when it
 * isn't on GitHub. Read as configured, before any `insteadOf` takes it elsewhere.
 */
export const gitHubRepoOf = async (repoPath: string) => {
  const address = await gitOrNothing(repoPath, ["config", "--get", "remote.origin.url"]);
  return address === undefined ? undefined : GITHUB_REMOTE.exec(address)?.[1];
};

/**
 * The branch a builder's `git push` would send to that is the repository's default (#730), as
 * origin's HEAD names it (or `main` or `master`), or `undefined` for none.
 */
const pushesToDefault = async (worktree: string, words: readonly string[]) => {
  const at = words[0] === "git" ? words.indexOf("push") : -1;
  if (at === -1) return undefined;
  const head = await gitOrNothing(worktree, [
    "symbolic-ref",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  const defaults = new Set(["main", "master", head?.replace(/^origin\//, "") ?? "main"]);
  const [, ...refspecs] = words.slice(at + 1).filter((word) => !word.startsWith("-"));
  return refspecs
    .map((refspec) => (refspec.split(":").at(-1) ?? "").replace(/^\+|^refs\/heads\//g, ""))
    .find((branch) => defaults.has(branch));
};

/** Whether a path names more than itself to the shell: a glob or braces it would expand. */
const EXPANDS = /[*?[{]/;

/**
 * Whether code given on the line (#464) runs without asking (#730): as Allow all covers it, naming
 * no path outside the worktree and no credential, and no file that decides what runs.
 */
const routineCode = (worktree: string, words: readonly string[]) => {
  const code = codeWordsOf(words);
  return (
    code !== undefined && allowsAll(worktree, words) && !code.some((w) => isSetup(w, undefined))
  );
};

/**
 * Whether a command may run in a session's worktree without asking: one command, on the command
 * allowlist or routine code given on the line (#730), naming no path outside the worktree, and,
 * for committing, with the worktree on the session branch. One that could run only with the
 * owner's approval says so. An issue filed without what every issue has is refused before anyone
 * is asked (#324), and so is a builder's push to the default branch (#730).
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
     * suite, which CI runs, and never pushes to the default branch (#730).
     */
    readonly builder?: boolean;
  },
  command: string,
): Promise<Result<null, CodeRefusal | CommandApproval>> => {
  const read = wordsOf(command);
  if (!read.ok) return err({ kind: read.error });
  const { worktree } = session;
  // The environment a test run is given in front of it (#730) names no path outside either.
  const { words, values } = withoutEnv(read.value);
  if (values.some((value) => outside(worktree, value)))
    return err({ kind: "needs-approval", reason: "reaches-out" });
  if (session.builder === true && isBuild(command)) {
    if (session.asTask === true) return err({ kind: "check-in-turn" });
    if (checksEverything(command)) return err({ kind: "ci-runs-it" });
  }
  if (session.builder === true) {
    const main = await pushesToDefault(worktree, afterEnv(words));
    if (main !== undefined) return err({ kind: "default-branch", branch: main });
  }
  // Any other environment could change what the command does (`GIT_TRACE=1`, `NODE_OPTIONS`), so
  // it asks, and Allow all never covers it (#730).
  if (afterEnv(words).length !== words.length)
    return err({ kind: "needs-approval", reason: "off-allowlist" });
  const [gap, ...gaps] = issueGapsIn(words);
  if (gap !== undefined) return err({ kind: "unfiled", gaps: [gap, ...gaps] });
  const namesRepo = words.some((word) => /^(?:--repo|-R)/.test(word));
  const work = {
    branch: session.branch,
    pullRequest: session.pullRequest,
    repo: namesRepo ? await gitHubRepoOf(worktree) : undefined,
  };
  if (session.asTask !== true && isTaskOnly(session.allowlist, words, work))
    return err({ kind: "task-only" });
  const rule = ruleFor(session.allowlist, words, work);
  if (rule === undefined) {
    if (routineCode(worktree, words)) return ok(null);
    const always = alwaysOffer(words);
    const code = codeWordsOf(words);
    const all =
      allowsAll(worktree, words) &&
      (code === undefined || code.every((word) => allowsAllSetup(word)));
    return err({
      kind: "needs-approval",
      reason: "off-allowlist",
      ...(always === undefined ? {} : { always }),
      ...(all ? { all: true } : {}),
    });
  }
  if (reachesOut(worktree, rule, words)) {
    return err({ kind: "needs-approval", reason: "reaches-out" });
  }
  // Code a download can bring is run only with the owner's OK (#219), and so is code where git
  // can't say.
  for (const from of runsFromOf(session.allowlist, words, work)) {
    if ((await gitIgnores(worktree, from)) !== false) {
      return err({ kind: "needs-approval", reason: "ignored-folder" });
    }
  }
  if (rule.unpacksInto !== undefined) {
    const folder = rule.unpacksInto(words.slice(rule.words.length));
    if (folder === undefined || !(await unpacksSafely(worktree, folder))) {
      return err({ kind: "needs-approval", reason: "off-allowlist" });
    }
  }
  // What it moves, makes or removes is the worktree's own, never a file that decides what runs,
  // unless Allow all covers that, nor the whole worktree, nor what a glob would find (#730).
  for (const path of rule.writes?.(words.slice(rule.words.length)) ?? []) {
    const place = EXPANDS.test(path)
      ? { kind: "outside" as const }
      : await editPlaceIn(worktree, path);
    if (place.kind === "outside") return err({ kind: "needs-approval", reason: "off-allowlist" });
    if (place.kind === "setup")
      return err({
        kind: "needs-approval",
        reason: "off-allowlist",
        ...(place.all ? { all: true } : {}),
      });
  }
  if (rule.onSessionBranch) {
    const on = await gitOrNothing(worktree, ["branch", "--show-current"]);
    if (on !== session.branch) return err({ kind: "off-branch", branch: session.branch });
  }
  // A bare `git push` goes where git says: only the session branch, under its own name (#730).
  if (rule.words.join(" ") === "git push" && words.every((w, at) => at < 2 || w.startsWith("-"))) {
    const to = await gitOrNothing(worktree, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{push}",
    ]);
    if (to !== `origin/${session.branch}`)
      return err({ kind: "needs-approval", reason: "off-allowlist" });
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
 * the package managers' settings, which hold registry tokens, and git hook folders and their
 * configs, whose hooks would go on running on the owner's own commits after the task.
 */
const ALL_ASKING_SETUP = new Set([
  ".git",
  ".github",
  ".claude",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".husky",
  ".githooks",
  ".lefthook",
  "lefthook.yml",
  ".lefthook.yml",
  ".pre-commit-config.yaml",
  ".simple-git-hooks.json",
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
