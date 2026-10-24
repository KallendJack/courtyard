import { wordsOf } from "@courtyard/contract";
import type { CommandRule } from "./allowlist.ts";
import { attachedValues } from "./paths.ts";

/**
 * Routine work inside a session's worktree (#730), which never asks: moving, copying, making and
 * removing files there, the repository's other check scripts, restoring files and bringing the
 * branch up to date, and commands that only look or wait. Each kind was asked for in the 14 days
 * of session logs before it. What changes files changes only the worktree's own, never one that
 * decides what runs, which the code module checks (`writes`).
 */

/** What git and gh are never asked for: writing a file, reading one from elsewhere, a browser. */
export const GIT_NEVER = [
  /^--output/,
  /^--no-index$/,
  /^--ext-diff$/,
  /^--textconv$/,
  /^-O/,
  /^--open-files-in-pager/,
  /^--exec/,
];
export const GH_NEVER = [/^--web$/, /^-w$/];

/**
 * The environment a command may be given in front of it (`PORT=4392 pnpm exec playwright test`):
 * only what picks a test run's port, its screenshots' folder, its time zone or its colours, never
 * what changes how a program loads, where it's installed or Courtyard's own settings.
 */
const SAFE_ENV = new Set(["PORT", "CI", "TZ", "NO_COLOR", "FORCE_COLOR", "COURTYARD_E2E_SHOTS"]);

/** An assignment in front of a command: `NAME=value`. */
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

/** Whether a word is an assignment, as the shell reads one in front of a command. */
export const isAssignment = (word: string) => ASSIGNMENT.test(word);

/**
 * A command's words after every assignment in front of it, safe or not (#730): the command the
 * shell runs, which `GIT_TRACE=1 git push origin main` is too.
 */
export const afterEnv = (words: readonly string[]) => {
  const at = words.findIndex((word) => !isAssignment(word));
  return at === -1 ? [] : words.slice(at);
};

/**
 * A command's words without the environment in front of it, and that environment's values, when
 * every name in it is safe (`SAFE_ENV`); as they are otherwise, so the first is no command's and
 * it asks.
 */
export const withoutEnv = (words: readonly string[]) => {
  const at = words.findIndex((word) => !ASSIGNMENT.test(word));
  const env = words.slice(0, at === -1 ? words.length : at);
  const safe = env.every((word) => SAFE_ENV.has(ASSIGNMENT.exec(word)?.[1] ?? ""));
  if (!safe || at === -1) return { words, values: [] };
  return { words: words.slice(at), values: env.map((word) => ASSIGNMENT.exec(word)?.[2] ?? "") };
};

/** A command's words once the shell's quoting is read, without a safe environment in front. */
export const commandWords = (command: string) => {
  const read = wordsOf(command);
  return read.ok ? { ...read, value: withoutEnv(read.value).words } : read;
};

/**
 * The package scripts that build or test, which wait their turn in the builds queue (#281), and
 * theirs (`test:e2e`, #730). The others (`check`, `typecheck`) are light enough to run at once.
 */
const BUILD_SCRIPTS = new Set(["test", "build", "e2e", "verify"]);

export const isBuildScript = (script: string | undefined) =>
  BUILD_SCRIPTS.has(script?.split(":")[0] ?? "");

/**
 * A package script that only checks, builds or formats (#730), by its name: `lint`,
 * `format:check`, `test:e2e`, `check:ideas`; never one that waits forever, serves, deploys or
 * publishes (`test:watch`, `build:deploy`).
 */
export const isRoutineScript = (script: string | undefined) =>
  /^(?:check|typecheck|test|build|e2e|format|lint)(?::[\w:.-]+)?$/.test(script ?? "") &&
  !/watch|dev|serve|start|preview|ui|deploy|release|publish/.test(script ?? "");

/**
 * The paths a command that changes files names: its words that aren't options, `--x=` values, and
 * whatever a short option could have written onto it (`cp -t.claude x`, #730).
 */
const named = (rest: readonly string[]) =>
  rest.flatMap((word) => {
    if (!word.startsWith("-")) return [word];
    return /^--[\w-]+=./.test(word) ? [word.replace(/^[^=]*=/, "")] : attachedValues(word);
  });

/** The paths after `--`. */
const afterDashes = (rest: readonly string[]) => {
  const at = rest.indexOf("--");
  return at === -1 ? [] : rest.slice(at + 1);
};

/** Git's quiet options, which say nothing of what it does. */
const QUIET = new Set(["-q", "--quiet"]);

/**
 * Whether `git checkout` only restores files (#730): `git checkout [<ref>] -- <paths>`, or
 * `--theirs`/`--ours` and the conflicted paths; never switching branches.
 */
const restoresFiles = (rest: readonly string[]) => {
  const sides = new Set(["--theirs", "--ours"]);
  const at = rest.indexOf("--");
  if (at === -1) return sides.has(rest[0] ?? "") && rest.slice(1).every((w) => !w.startsWith("-"));
  const before = rest.slice(0, at).filter((word) => !QUIET.has(word) && !sides.has(word));
  return before.length <= 1 && before.every((w) => !w.startsWith("-")) && rest.length > at + 1;
};

/** The paths `git checkout` restores. */
const restored = (rest: readonly string[]) => {
  const after = afterDashes(rest);
  return after.length > 0 ? after : rest.slice(1);
};

/** Whether `git reset` only unstages (#730): quietly, all or the paths after `--`, never to a commit. */
const unstages = (rest: readonly string[]) => {
  const at = rest.indexOf("--");
  return (at === -1 ? rest : rest.slice(0, at)).every((word) => QUIET.has(word));
};

/**
 * Whether `git rebase` brings the session branch onto a branch from origin (#730), as the house
 * rules have it, or carries on, skips or stops one that stopped on a conflict.
 */
const rebasesOnBase = (rest: readonly string[]) => {
  if (rest.length === 1 && ["--continue", "--abort", "--skip"].includes(rest[0] ?? "")) return true;
  const named = rest.filter((word) => !QUIET.has(word));
  return named.length === 1 && /^origin\/[\w./-]+$/.test(named[0] ?? "");
};

/** `git branch`'s options that only list. */
const LISTS = new Set(["-r", "--remotes", "-a", "--all", "-v", "-vv", "--verbose", "--no-color"]);

/** Whether `git branch` only lists branches, by their names' patterns with `--list` (#730). */
const listsBranches = (rest: readonly string[]) => {
  const listing = rest.includes("--list") || rest.includes("-l");
  return rest.every(
    (word) =>
      LISTS.has(word) || word === "--list" || word === "-l" || (listing && !word.startsWith("-")),
  );
};

/** Tar's extracting, from one archive: `-xf`, `xzf`, `-xvf`. */
const EXTRACT = /^-?[vzjJ]*x[vzjJ]*f$/;

/** The folder `tar -xf <archive> -C <folder>` unpacks into, and nothing else it's told. */
const tarFolder = (rest: readonly string[]) => {
  const [mode, archive, into, folder, ...more] = rest;
  const plain = archive !== undefined && !archive.startsWith("-") && more.length === 0;
  return EXTRACT.test(mode ?? "") && plain && into === "-C" ? folder : undefined;
};

/** Unzip's options that say nothing of where it unpacks: overwrite, never overwrite, quietly. */
const UNZIP_FLAGS = new Set(["-o", "-n", "-q", "-qq"]);

/** The folder `unzip <archive> -d <folder>` unpacks into, and nothing else it's told. */
const unzipFolder = (rest: readonly string[]) => {
  const words = rest.filter((word) => !UNZIP_FLAGS.has(word));
  const [archive, into, folder, ...more] = words;
  const plain = archive !== undefined && !archive.startsWith("-") && more.length === 0;
  return plain && into === "-d" ? folder : undefined;
};

/** Gh's commands that only look, besides the allowlist's own (#730). */
const GH_READS = [
  ...["issues", "prs", "code", "repos", "commits"].map((what) => ["search", what]),
  ...["release", "workflow"].flatMap((what) => [
    [what, "list"],
    [what, "view"],
  ]),
];

export const ROUTINE: readonly CommandRule[] = [
  // Moving, copying, making and removing the worktree's files.
  ...["rm", "mkdir", "mv", "cp"].map((program) => ({
    words: [program],
    more: true,
    writes: named,
  })),
  ...["mv", "rm", "restore"].map((what) => ({
    words: ["git", what],
    more: true,
    never: GIT_NEVER,
    writes: named,
  })),
  { words: ["git", "checkout"], more: true, own: restoresFiles, writes: restored },
  { words: ["git", "reset"], more: true, own: unstages, writes: afterDashes },
  // Bringing the session branch onto its base, and git that only lists.
  { words: ["git", "rebase"], more: true, onSessionBranch: true, own: rebasesOnBase },
  { words: ["git", "branch"], more: true, own: listsBranches },
  { words: ["git", "worktree", "list"], more: true, never: GIT_NEVER },
  { words: ["git", "for-each-ref"], more: true, never: GIT_NEVER },
  // A trace unpacked into a folder git ignores, as a run's artifacts are.
  {
    words: ["tar"],
    more: true,
    own: (rest) => tarFolder(rest) !== undefined,
    unpacksInto: tarFolder,
  },
  {
    words: ["unzip"],
    more: true,
    own: (rest) => unzipFolder(rest) !== undefined,
    unpacksInto: unzipFolder,
  },
  // The repository's other check scripts, and what the registry says of a package.
  { words: ["pnpm"], more: true, script: true },
  { words: ["pnpm", "run"], more: true, script: true },
  { words: ["pnpm", "view"], more: true },
  { words: ["npm", "view"], more: true },
  // The time (never setting it), a pause, what a file is, whether two are the same.
  { words: ["date"], more: true, never: [/^-s/, /^--set/] },
  ...["echo", "sleep", "cmp", "cut"].map((program) => ({ words: [program], more: true })),
  { words: ["file"], more: true, never: [/^-C$/, /^--compile/] },
  ...GH_READS.map((look) => ({ words: ["gh", ...look], more: true, never: GH_NEVER })),
];
