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
  /** Only while the worktree is on the session branch: committing, pushing, its pull request. */
  readonly onSessionBranch?: boolean;
  /**
   * For pushing and the pull request (#172): whether the arguments after the words name only the
   * session's own branch and pull request; for `gh api`, whether it only reads (#181).
   */
  readonly own?: (rest: readonly string[], work: OwnWork) => boolean;
  /**
   * Its options whose value is text, never a path: a title, a body, a message, a jq filter (#202).
   * Such a value is still checked as a path, but as a whole: a link or a `:` in it isn't split.
   */
  readonly texts?: readonly string[];
  /**
   * For a command that picks where another runs (pnpm's workspace options, #202): that other
   * command, which must match a rule of its own that isn't for the session branch only, or
   * `undefined` when it names none.
   */
  readonly runs?: (rest: readonly string[]) => readonly string[] | undefined;
};

/** A session's own branch, and its pull request's number once it has one. */
export type OwnWork = { readonly branch: string; readonly pullRequest: number | undefined };

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
 * How long the line continuation at a backslash is (#202): the backslash and the line ending after
 * it, which the shell drops, so a command split over lines is one command. 0 when it isn't one.
 */
const continuationAt = (command: string, at: number) => {
  if (command[at + 1] === "\n") return 2;
  return command.startsWith("\r\n", at + 1) ? 3 : 0;
};

/**
 * A command's words, as a POSIX shell reads its quotes and backslashes, or why it can't be
 * matched: anything that could make it run more than one command, or substitute something into
 * it, isn't read further. Quoted text may hold line breaks (a pull request's body), and a
 * backslash at a line's end joins the next line on (#202).
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
      const continues = continuationAt(command, at);
      if (continues === 0) add(next);
      at += continues || 2;
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
        const continues = inside === "\\" ? continuationAt(command, at - 1) : 0;
        if (continues > 0) {
          at += continues - 1;
        } else if (inside === "\\" && ESCAPED_IN_DOUBLE_QUOTES.has(command[at] ?? "")) {
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
/** What ripgrep is never asked for: running a program on each file, or for the host's name. */
const RG_NEVER = [/^--pre/, /^--hostname-bin/];
/** What tail is never asked for: following a file, which never ends, so the turn would wait forever. */
const TAIL_NEVER = [/^-[A-Za-z0-9]*[fF]/, /^--follow/];

/**
 * The shell commands a model looks around the worktree with (#178), none of which can run another
 * program or write a file. `find` isn't one: it can `-exec`.
 */
const LOOKS = ["cat", "ls", "head", "wc", "grep", "diff"];

/** The package scripts a session runs to check its own work. */
const PACKAGE_SCRIPTS = ["check", "typecheck", "test", "build", "e2e", "verify"];
/**
 * The tools those scripts run, run directly (#202), never in a mode that waits forever. They run
 * the same code the scripts do; `biome check --write` formats only files in the worktree, since a
 * path it's given outside it asks.
 */
const TEST_TOOLS: readonly { readonly words: readonly string[]; readonly never: RegExp[] }[] = [
  { words: ["vitest", "run"], never: [/^--watch/, /^-w$/, /^--ui/] },
  { words: ["playwright", "test"], never: [/^--ui/, /^--debug/] },
  { words: ["tsc", "--noEmit"], never: [/^--watch/, /^-w$/] },
  { words: ["biome", "check"], never: [] },
];
/** What runs them: npx only for them, which could otherwise fetch and run any package. */
const TOOL_RUNNERS = [["npx"], ["pnpm"], ["pnpm", "exec"]];

/** Pnpm's options that pick the workspace packages a command runs in, with a value. */
const PNPM_PICKS = new Set(["--filter", "-F", "--dir", "-C"]);
/** And those without one: every package. */
const PNPM_EVERY = new Set(["-r", "--recursive"]);

/**
 * The pnpm command that pnpm's workspace options pick packages for (`pnpm --filter <name>
 * <script>`, `-F`, `-C <dir>`, `--dir`, `-r`, `--recursive`), or `undefined` without any (#202).
 */
const pickedCommand = (rest: readonly string[]) => {
  let at = 0;
  for (;;) {
    const word = rest[at] ?? "";
    if (PNPM_EVERY.has(word) || /^--(filter|dir)=./.test(word)) at += 1;
    else if (PNPM_PICKS.has(word) && rest[at + 1] !== undefined) at += 2;
    else break;
  }
  return at === 0 || at === rest.length ? undefined : ["pnpm", ...rest.slice(at)];
};

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

/** What `git push` may say besides the remote and the branch: nothing that forces or deletes. */
const PUSH_FLAGS = new Set(["-u", "--set-upstream", "-q", "--quiet"]);

/**
 * Whether a push sends only the session branch to its remote, under its own name: `git push -u
 * origin HEAD`, `git push origin <branch>` or `git push origin HEAD:<branch>`.
 */
const pushesOwn = (rest: readonly string[], { branch }: OwnWork) => {
  const named = rest.filter((word) => !PUSH_FLAGS.has(word));
  const [remote, refspec, ...more] = named;
  if (remote !== "origin" || refspec === undefined || more.length > 0) return false;
  return [
    "HEAD",
    branch,
    `refs/heads/${branch}`,
    `HEAD:${branch}`,
    `HEAD:refs/heads/${branch}`,
    `${branch}:${branch}`,
  ].includes(refspec);
};

/** A gh command's flags: those that take a value, and those that stand alone. */
type GhFlags = { readonly withValue: ReadonlySet<string>; readonly alone: ReadonlySet<string> };

/**
 * A gh command's arguments read with its flags: what isn't a flag, and each flag with its value.
 * `undefined` for a flag it doesn't know, which could do anything (`--repo`, `--web`), or one
 * missing its value.
 */
const ghParts = (rest: readonly string[], flags: GhFlags) => {
  const positionals: string[] = [];
  const values: (readonly [string, string])[] = [];
  for (let at = 0; at < rest.length; at += 1) {
    const word = rest[at] ?? "";
    if (!word.startsWith("-")) {
      positionals.push(word);
      continue;
    }
    const equals = word.startsWith("--") ? word.indexOf("=") : -1;
    const flag = equals === -1 ? word : word.slice(0, equals);
    const inline = equals === -1 ? undefined : word.slice(equals + 1);
    if (flags.alone.has(flag) && inline === undefined) continue;
    if (!flags.withValue.has(flag)) return undefined;
    // Its value is in it, after `=`, or the next word, which is then read.
    if (inline === undefined) at += 1;
    const value = inline ?? rest[at];
    if (value === undefined) return undefined;
    values.push([flag, value]);
  }
  return { positionals, values };
};

/** The text a pull request or an issue is given: its title, body, comment or description. */
const GH_TEXTS = ["--title", "-t", "--body", "-b", "--comment", "-c", "--description", "-d"];

const PR_TEXT = ["--title", "-t", "--body", "-b", "--body-file", "-F", "--base", "-B"];
const PR_MILESTONE = ["--milestone", "-m"];

const PR_CREATE: GhFlags = {
  withValue: new Set([
    ...PR_TEXT,
    ...PR_MILESTONE,
    ...["--head", "-H", "--label", "-l", "--reviewer", "-r", "--assignee", "-a"],
    ...["--project", "-p", "--template", "-T"],
  ]),
  alone: new Set(["--fill", "-f", "--fill-first", "--fill-verbose", "--draft", "-d", "--dry-run"]),
};

const PR_EDIT: GhFlags = {
  withValue: new Set([
    ...PR_TEXT,
    ...PR_MILESTONE,
    ...["--add-label", "--remove-label", "--add-reviewer", "--remove-reviewer"],
    ...["--add-assignee", "--remove-assignee", "--add-project", "--remove-project"],
  ]),
  alone: new Set(["--remove-milestone"]),
};

/** Whether `gh pr create` opens the session branch's own pull request, in its own repository. */
const opensOwn = (rest: readonly string[], { branch }: OwnWork) => {
  const parts = ghParts(rest, PR_CREATE);
  return (
    parts !== undefined &&
    parts.positionals.length === 0 &&
    parts.values.every(([flag, value]) =>
      flag === "--head" || flag === "-H" ? value === branch : true,
    )
  );
};

/**
 * Whether `gh pr edit` changes the session's own pull request: the current branch's, or one named
 * by the session branch or its number.
 */
const editsOwn = (rest: readonly string[], { branch, pullRequest }: OwnWork) => {
  const parts = ghParts(rest, PR_EDIT);
  if (parts === undefined || parts.positionals.length > 1) return false;
  const [named] = parts.positionals;
  return named === undefined || named === branch || named === String(pullRequest ?? "");
};

/**
 * Gh's flags for another repository, a browser or an editor, which the commands on the
 * repository's issues and labels never take.
 */
const GH_ELSEWHERE = [/^--repo/, /^-R/, /^--web/, /^-w$/, /^--editor/, /^-e$/];

/** What Matt Pocock's skills change on the repository's issues and labels (#181). */
const GH_ISSUES = [
  ["issue", "create"],
  ["issue", "edit"],
  ["issue", "comment"],
  ["issue", "close"],
  ["label", "create"],
  ["label", "list"],
];

/** The flags `gh api` takes when it only reads: none that sends fields or a body. */
const API_READ: GhFlags = {
  withValue: new Set(["--method", "-X", "--jq", "-q", "--template", "-t", "--header", "-H"]),
  alone: new Set(["--paginate", "--slurp", "--include", "-i", "--silent", "--verbose"]),
};

/** Whether `gh api` only reads: one REST path, asked with GET, sending nothing (#181). */
const readsOnly = (rest: readonly string[]) => {
  const parts = ghParts(rest, API_READ);
  if (parts === undefined || parts.positionals.length !== 1) return false;
  if (parts.positionals[0] === "graphql") return false;
  return parts.values.every(([flag, value]) =>
    flag === "--method" || flag === "-X" ? value.toUpperCase() === "GET" : true,
  );
};

/**
 * A code workspace's command allowlist when its settings name none: the shell commands that look
 * around the worktree (#178), the repository's package scripts (install with a frozen lockfile,
 * check, typecheck, test, build, e2e and verify), in the packages pnpm's workspace options pick
 * too, and the tools they run, run directly (#202), git and gh commands that only look, adding and
 * committing on the session branch, pushing it, and opening and updating its own pull request
 * (#172), and filing, labelling, commenting on and closing the repository's issues, as Matt
 * Pocock's skills do (#181).
 */
const DEFAULT_ALLOWLIST: readonly CommandRule[] = [
  ...LOOKS.map((look) => ({ words: [look], more: true })),
  { words: ["tail"], more: true, never: TAIL_NEVER },
  { words: ["rg"], more: true, never: RG_NEVER },
  { words: ["pwd"], more: false },
  { words: ["pnpm", "install", "--frozen-lockfile"], more: false },
  { words: ["npm", "ci"], more: false },
  ...PACKAGE_SCRIPTS.flatMap((script) => [
    { words: ["pnpm", script], more: true },
    { words: ["pnpm", "run", script], more: true },
    { words: ["npm", "run", script], more: true },
  ]),
  { words: ["npm", "test"], more: true },
  ...TEST_TOOLS.flatMap(({ words, never }) =>
    TOOL_RUNNERS.map((runner) => ({ words: [...runner, ...words], more: true, never })),
  ),
  { words: ["pnpm"], more: true, runs: pickedCommand },
  ...GIT_LOOKS.map((look) => ({ words: ["git", look], more: true, never: GIT_NEVER })),
  { words: ["git", "branch"], more: false },
  { words: ["git", "branch", "--show-current"], more: false },
  { words: ["git", "remote", "-v"], more: false },
  { words: ["git", "add"], more: true, never: GIT_NEVER },
  {
    words: ["git", "commit"],
    more: true,
    never: GIT_NEVER,
    onSessionBranch: true,
    texts: ["-m", "--message"],
  },
  ...GH_LOOKS.map((look) => ({ words: ["gh", ...look], more: true, never: GH_NEVER })),
  ...GH_ISSUES.map((words) => ({
    words: ["gh", ...words],
    more: true,
    never: GH_ELSEWHERE,
    texts: GH_TEXTS,
  })),
  // A run's artifacts, into the worktree (its -D folder is checked as a path), for a fixing turn.
  { words: ["gh", "run", "download"], more: true, never: GH_ELSEWHERE },
  { words: ["gh", "api"], more: true, own: readsOnly, texts: ["--jq", "-q", "--template", "-t"] },
  { words: ["git", "push"], more: true, onSessionBranch: true, own: pushesOwn },
  {
    words: ["gh", "pr", "create"],
    more: true,
    onSessionBranch: true,
    own: opensOwn,
    texts: GH_TEXTS,
  },
  {
    words: ["gh", "pr", "edit"],
    more: true,
    onSessionBranch: true,
    own: editsOwn,
    texts: GH_TEXTS,
  },
];

/** A command named by its first words in a workspace's settings, with ` ...` when more may follow. */
const ruleNamed = (named: string): CommandRule => {
  const words = named.split(" ");
  const more = words.at(-1) === "...";
  return { words: more ? words.slice(0, -1) : words, more };
};

/**
 * A code workspace's command allowlist: the default, with the commands its settings add and
 * without the default ones they remove (by their words, whether or not more may follow).
 */
export const allowlistFor = (settings: {
  readonly add: readonly string[];
  readonly remove: readonly string[];
}): readonly CommandRule[] => {
  const removed = new Set(settings.remove.map((named) => ruleNamed(named).words.join(" ")));
  return [
    ...DEFAULT_ALLOWLIST.filter((rule) => !removed.has(rule.words.join(" "))),
    ...settings.add.map(ruleNamed),
  ];
};

/**
 * The rule a command's words match, or `undefined` when none does. A push or a pull request
 * command matches only when it names the session's own branch and pull request, and one that
 * picks where another runs only when that other matches too.
 */
export const ruleFor = (
  allowlist: readonly CommandRule[],
  words: readonly string[],
  work: OwnWork,
): CommandRule | undefined =>
  allowlist.find((rule) => {
    if (words.length < rule.words.length) return false;
    if (!rule.words.every((first, index) => words[index] === first)) return false;
    const rest = words.slice(rule.words.length);
    if (!rule.more && rest.length > 0) return false;
    if (rule.own !== undefined && !rule.own(rest, work)) return false;
    if (rule.runs !== undefined) {
      const runs = rule.runs(rest);
      const inner = runs === undefined ? undefined : ruleFor(allowlist, runs, work);
      if (inner === undefined || inner.onSessionBranch) return false;
    }
    return !rest.some((argument) => rule.never?.some((never) => never.test(argument)));
  });

/**
 * The paths an argument could name: itself; whatever follows an `=` or a `:` in it
 * (`--option=value`, `HEAD:path`), a drive's colon aside; and, for short options, whatever follows
 * each letter, since a short option's value can be written onto it, after others too (`-F../x`,
 * `-qF../x`).
 */
const pathsIn = (argument: string) => {
  const paths = [argument];
  for (let at = 0; at < argument.length; at += 1) {
    const char = argument[at];
    const drive = char === ":" && at === 1 && /^[A-Za-z]$/.test(argument[0] ?? "");
    if ((char === "=" || char === ":") && !drive) paths.push(argument.slice(at + 1));
  }
  if (/^-[^-]/.test(argument)) {
    for (let at = 2; at < argument.length; at += 1) paths.push(argument.slice(at));
  }
  return paths;
};

/**
 * The paths a command matching a rule could name: those in each argument after the rule's words
 * (`pathsIn`), but only the whole of a text option's value (`texts`), so a link in a pull
 * request's body isn't read as a path (#202).
 */
const pathsNamed = (rule: CommandRule, words: readonly string[]) => {
  const rest = words.slice(rule.words.length);
  const texts = new Set(rule.texts);
  const paths: string[] = [];
  for (let at = 0; at < rest.length; at += 1) {
    const word = rest[at] ?? "";
    const equals = word.startsWith("--") ? word.indexOf("=") : -1;
    if (texts.has(word)) {
      paths.push(word, ...rest.slice(at + 1, at + 2));
      at += 1;
    } else if (equals !== -1 && texts.has(word.slice(0, equals))) {
      paths.push(word.slice(equals + 1));
    } else {
      paths.push(...pathsIn(word));
    }
  }
  return paths;
};

/**
 * Whether a command matching a rule names a path outside the worktree (`pathsNamed`): one from
 * the home folder (`~`), an absolute one elsewhere, one that climbs out with `..`, or one naming
 * a drive that isn't absolute here (`C:/x` off Windows, `C:x` on it), whose place the worker
 * can't tell.
 */
export const reachesOut = (worktree: string, rule: CommandRule, words: readonly string[]) =>
  pathsNamed(rule, words).some((path) => {
    if (path.startsWith("~")) return true;
    const absolute = isAbsolute(path);
    if (/^[A-Za-z]:/.test(path) && !absolute) return true;
    if (!absolute && !path.split(/[\\/]/).includes("..")) return false;
    const fromWorktree = relative(worktree, resolve(worktree, path));
    return fromWorktree.startsWith("..") || isAbsolute(fromWorktree);
  });
