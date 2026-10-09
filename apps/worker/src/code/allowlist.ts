import { isAbsolute, relative, resolve } from "node:path";
import { err, ok, type Result } from "../result.ts";

/**
 * The command allowlist (ADR 0007): the commands a code session runs without asking. A command is
 * matched on its words, once the shell's quoting is read, never on the start of its text, and a
 * command that could run a second one (chaining, piping, redirecting or substituting) never
 * matches, whatever it starts with.
 */

/** One kind of command the allowlist lets through. */
export type CommandRule = {
  /** Its first words, exactly: `["pnpm", "test"]`. */
  readonly words: readonly string[];
  /** Whether more arguments may follow them. */
  readonly more: boolean;
  /** Arguments that are never allowed after them, as patterns. */
  readonly never?: readonly RegExp[];
  /** Only while the worktree is on the session branch: committing, and later pushing it. */
  readonly onSessionBranch?: boolean;
};

/** Why a command can't be matched against the allowlist at all. */
export type UnmatchableCommand =
  /** It chains, pipes, redirects or substitutes, so it could run something else. */
  | "chained"
  /** Its quotes don't close, or it's empty. */
  | "unreadable";

/** Characters the shell reads as starting another command, a redirect or a substitution. */
const OPERATORS = new Set([";", "&", "|", "<", ">", "(", ")", "`", "$", "\n", "\r"]);
/** Characters a backslash keeps literal inside double quotes. */
const ESCAPED_IN_DOUBLE_QUOTES = new Set(["$", "`", '"', "\\"]);

/**
 * A command's words, as a POSIX shell reads its quotes and backslashes, or why it can't be
 * matched: anything that could make it run more than one command, or substitute something into
 * it, isn't read further.
 */
export const wordsOf = (command: string): Result<string[], UnmatchableCommand> => {
  const words: string[] = [];
  let word: string | undefined;
  let at = 0;
  const add = (text: string) => {
    word = (word ?? "") + text;
  };
  while (at < command.length) {
    const char = command[at] ?? "";
    if (char === " " || char === "\t") {
      if (word !== undefined) words.push(word);
      word = undefined;
      at += 1;
    } else if (OPERATORS.has(char) || (char === "#" && word === undefined)) {
      return err("chained");
    } else if (char === "\\") {
      const next = command[at + 1];
      if (next === undefined) return err("unreadable");
      add(next);
      at += 2;
    } else if (char === "'") {
      const end = command.indexOf("'", at + 1);
      if (end === -1) return err("unreadable");
      add(command.slice(at + 1, end));
      at = end + 1;
    } else if (char === '"') {
      add("");
      at += 1;
      for (;;) {
        const inside = command[at];
        if (inside === undefined) return err("unreadable");
        at += 1;
        if (inside === '"') break;
        if (inside === "$" || inside === "`") return err("chained");
        if (inside === "\\" && ESCAPED_IN_DOUBLE_QUOTES.has(command[at] ?? "")) {
          add(command[at] ?? "");
          at += 1;
        } else {
          add(inside);
        }
      }
    } else {
      add(char);
      at += 1;
    }
  }
  if (word !== undefined) words.push(word);
  return words.length === 0 ? err("unreadable") : ok(words);
};

/** What git and gh are never asked for: writing a file, reading one from elsewhere, a browser. */
const GIT_NEVER = [
  /^--output/,
  /^--no-index$/,
  /^--ext-diff$/,
  /^--textconv$/,
  /^-O/,
  /^--open-files-in-pager/,
  /^--exec/,
];
const GH_NEVER = [/^--web$/, /^-w$/];

/** The package scripts a session runs to check its own work. */
const PACKAGE_SCRIPTS = ["check", "typecheck", "test", "build", "e2e", "verify"];
/** Git's commands that only look. */
const GIT_LOOKS = [
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "ls-files",
  "blame",
  "grep",
  "shortlog",
  "describe",
];
/** Gh's commands that only look. */
const GH_LOOKS = [
  ["pr", "view"],
  ["pr", "list"],
  ["pr", "diff"],
  ["pr", "checks"],
  ["pr", "status"],
  ["issue", "view"],
  ["issue", "list"],
  ["run", "view"],
  ["run", "list"],
  ["repo", "view"],
];

/**
 * A code workspace's command allowlist when its settings name none: the repository's package
 * scripts (install with a frozen lockfile, check, typecheck, test, build, e2e and verify), git and
 * gh commands that only look, and adding and committing on the session branch. Pushing the
 * session branch and its own pull request join it with the GitHub sign-in (#99, #172).
 */
export const DEFAULT_ALLOWLIST: readonly CommandRule[] = [
  { words: ["pnpm", "install", "--frozen-lockfile"], more: false },
  { words: ["npm", "ci"], more: false },
  ...PACKAGE_SCRIPTS.flatMap((script) => [
    { words: ["pnpm", script], more: true },
    { words: ["pnpm", "run", script], more: true },
    { words: ["npm", "run", script], more: true },
  ]),
  { words: ["npm", "test"], more: true },
  ...GIT_LOOKS.map((look) => ({ words: ["git", look], more: true, never: GIT_NEVER })),
  { words: ["git", "branch"], more: false },
  { words: ["git", "branch", "--show-current"], more: false },
  { words: ["git", "remote", "-v"], more: false },
  { words: ["git", "add"], more: true, never: GIT_NEVER },
  { words: ["git", "commit"], more: true, never: GIT_NEVER, onSessionBranch: true },
  ...GH_LOOKS.map((look) => ({ words: ["gh", ...look], more: true, never: GH_NEVER })),
];

/** The rule a command's words match, or `undefined` when none does. */
export const ruleFor = (allowlist: readonly CommandRule[], words: readonly string[]) =>
  allowlist.find((rule) => {
    if (words.length < rule.words.length) return false;
    if (!rule.words.every((first, index) => words[index] === first)) return false;
    const rest = words.slice(rule.words.length);
    if (!rule.more && rest.length > 0) return false;
    return !rest.some((argument) => rule.never?.some((never) => never.test(argument)));
  });

/** The paths an argument could name: itself, and what follows `=` in `--option=value`. */
const pathsIn = (argument: string) => {
  const value = /^--?[^=]+=(.*)$/.exec(argument)?.[1];
  return value === undefined ? [argument] : [argument, value];
};

/**
 * Whether any of a command's arguments names a path outside the worktree: one from the home
 * folder (`~`), an absolute one elsewhere, or one that climbs out with `..`.
 */
export const reachesOut = (worktree: string, words: readonly string[]) =>
  words.flatMap(pathsIn).some((path) => {
    if (path.startsWith("~")) return true;
    const absolute = isAbsolute(path) || /^[A-Za-z]:/.test(path);
    if (!absolute && !path.split(/[\\/]/).includes("..")) return false;
    const fromWorktree = relative(worktree, resolve(worktree, path));
    return fromWorktree.startsWith("..") || isAbsolute(fromWorktree);
  });
