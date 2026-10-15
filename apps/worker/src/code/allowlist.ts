import { isAbsolute, relative, resolve } from "node:path";
import { type AlwaysAllow, wordsOf } from "@courtyard/contract";
import { isHelperBranchOf } from "./branches.ts";

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
  /**
   * For a command that unpacks files (`gh run download`, #202): the folder it unpacks into, which
   * the code module allows only when git ignores it and it's neither the worktree itself nor a
   * file that decides what allowed commands run.
   */
  readonly unpacksInto?: (rest: readonly string[]) => string | undefined;
  /**
   * For a command that runs code from where it's told (#219): the folders and files it runs from
   * (pnpm's `-C`/`--dir` folder, the script node runs), which the code module allows only when git
   * doesn't ignore them, since a download (`gh run download`) can bring code there. A folder ends
   * in `/`.
   */
  readonly runsFrom?: (rest: readonly string[]) => readonly string[];
};

/** A session's own branch, and its pull request's number once it has one. */
export type OwnWork = { readonly branch: string; readonly pullRequest: number | undefined };

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

/** The package scripts a session runs to check its own work, and to format it (#388). */
const PACKAGE_SCRIPTS = ["check", "typecheck", "test", "build", "e2e", "verify", "format"];
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
/** What runs them as the repository installed them: never npx, which can fetch any package. */
const TOOL_RUNNERS = [["pnpm"], ["pnpm", "exec"]];

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

/**
 * The folders pnpm's workspace options say a command runs in (`-C <dir>`, `--dir <dir>`,
 * `--dir=<dir>`), each ending in `/` (#219).
 */
const pickedFolders = (rest: readonly string[]) => {
  const folders: string[] = [];
  for (let at = 0; at < rest.length; at += 1) {
    const word = rest[at] ?? "";
    const value = rest[at + 1];
    if (word.startsWith("--dir=")) folders.push(word.slice("--dir=".length));
    else if (PNPM_PICKS.has(word) && value !== undefined) {
      if (word === "-C" || word === "--dir") folders.push(value);
      at += 1;
    } else if (!PNPM_EVERY.has(word) && !word.startsWith("--filter=")) break;
  }
  return folders.map((folder) => (folder.endsWith("/") ? folder : `${folder}/`));
};

/** The files `node --test` is given to run (#219): every word that isn't an option. */
const testFiles = (rest: readonly string[]) => rest.filter((word) => !word.startsWith("-"));

/**
 * The package scripts that build or test, which wait their turn in the builds queue (#281). The
 * others (`check`, `typecheck`) are light enough to run at once.
 */
const BUILD_SCRIPTS = new Set(["test", "build", "e2e", "verify"]);

/** Whether a command's words, after any runner, start one of the test tools that build or test. */
const startsBuildTool = (words: readonly string[]) => {
  const [tool, mode] = words;
  return tool === "vitest" || (tool === "playwright" && mode === "test");
};

/**
 * Whether a command is a heavy check, which waits its turn in the builds queue (#281): one of the
 * package scripts that build or test (`pnpm verify`, `pnpm run test`, `npm test`, in any packages
 * pnpm's workspace options pick), or a test tool run directly (`vitest`, `playwright test`, run
 * bare or by `pnpm`, `pnpm exec`, `npx`). Anything else, and anything that can't be read as one
 * command, is light.
 */
export const isBuild = (command: string) => {
  const read = wordsOf(command);
  if (!read.ok) return false;
  const [runner, ...rest] = read.value;
  if (runner === "npm") {
    const [first, second] = rest;
    return first === "test" || (first === "run" && BUILD_SCRIPTS.has(second ?? ""));
  }
  if (runner === "npx") return startsBuildTool(rest);
  if (runner !== "pnpm") return startsBuildTool(read.value);
  const picked = pickedCommand(rest)?.slice(1) ?? rest;
  const [first, ...after] = picked;
  if (first === "exec") return startsBuildTool(after);
  if (first === "run") return BUILD_SCRIPTS.has(after[0] ?? "");
  return BUILD_SCRIPTS.has(first ?? "") || startsBuildTool(picked);
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
  "merge-base",
  "ls-remote",
  "check-ignore",
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
  ["repo", "list"],
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

/** What `git merge` may say besides the branch it merges in: no strategy, no squash (#388). */
const MERGE_FLAGS = new Set(["--no-edit", "--no-ff", "-q", "--quiet"]);

/**
 * Whether a merge brings a branch from origin into the session branch, plainly (#388): `git merge
 * origin/main`, with `--no-edit`, `--no-ff`, `-q` or a message (`-m <text>`), as Bring up to date
 * asks; or one of the session's helpers' own branches, kept when it didn't merge cleanly (#395);
 * or `git merge --abort`, which undoes one that stopped on a conflict.
 */
const mergesBase = (rest: readonly string[], work: OwnWork) => {
  if (rest.length === 1 && rest[0] === "--abort") return true;
  const named: string[] = [];
  for (let at = 0; at < rest.length; at += 1) {
    const word = rest[at] ?? "";
    if (word === "-m" || word === "--message") at += 1;
    else if (!word.startsWith("--message=") && !MERGE_FLAGS.has(word)) named.push(word);
  }
  const [branch, ...more] = named;
  return (
    more.length === 0 &&
    branch !== undefined &&
    (/^origin\/[\w./-]+$/.test(branch) || isHelperBranchOf(work.branch, branch))
  );
};

/** What `git fetch` may say besides the remote and its branches. */
const FETCH_FLAGS = new Set(["-q", "--quiet", "--prune", "-p"]);

/**
 * Whether a fetch only brings origin's branches up to date (#388): `git fetch`, `git fetch
 * origin`, `git fetch origin main`, never into a local branch (`main:main`) or from elsewhere.
 */
const fetchesOrigin = (rest: readonly string[]) => {
  const [remote, ...branches] = rest.filter((word) => !FETCH_FLAGS.has(word));
  if (remote === undefined) return true;
  return (
    remote === "origin" &&
    branches.every((branch) => /^[\w./-]+$/.test(branch) && !branch.startsWith("-"))
  );
};

/**
 * What node is never asked for: code given on the line, code loaded before the script, or a
 * debugger to attach (#388).
 */
const NODE_NEVER = [
  /^-e$/,
  /^--eval/,
  /^-p$/,
  /^--print/,
  /^-r$/,
  /^--require/,
  /^--import/,
  /^--loader/,
  /^--experimental-loader/,
  /^--inspect/,
];

/** Whether node runs a script file of the repository's, named first (#388): `node scripts/x.ts`. */
const runsScript = (rest: readonly string[]) => {
  const [script] = rest;
  return script !== undefined && /^[^-].*\.(?:[cm]?js|[cm]?ts)$/.test(script);
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

/** What `gh pr comment` says: its body, never an edit or a deletion of one already there. */
const PR_COMMENT: GhFlags = {
  withValue: new Set(["--body", "-b", "--body-file", "-F"]),
  alone: new Set(),
};

/**
 * Whether `gh pr edit` or `gh pr comment` acts on the session's own pull request: the current
 * branch's, or one named by the session branch or its number.
 */
const actsOnOwn =
  (flags: GhFlags) =>
  (rest: readonly string[], { branch, pullRequest }: OwnWork) => {
    const parts = ghParts(rest, flags);
    if (parts === undefined || parts.positionals.length > 1) return false;
    const [named] = parts.positionals;
    return named === undefined || named === branch || named === String(pullRequest ?? "");
  };

/** What `gh run rerun` takes: only re-running a run's failed jobs. */
const RUN_RERUN: GhFlags = { withValue: new Set(), alone: new Set(["--failed"]) };

/**
 * Whether `gh run rerun` re-runs one run's failed jobs, in this repository (#356): what a fixing
 * turn does for a flake that isn't its pull request's.
 */
const rerunsFailed = (rest: readonly string[]) => {
  const parts = ghParts(rest, RUN_RERUN);
  return (
    parts !== undefined &&
    parts.positionals.length === 1 &&
    /^\d+$/.test(parts.positionals[0] ?? "") &&
    rest.includes("--failed")
  );
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

/** The flags `gh issue create` takes, read to check the issue it files (#324). */
const ISSUE_CREATE: GhFlags = {
  withValue: new Set([
    ...["--title", "-t", "--body", "-b", "--body-file", "-F", "--label", "-l"],
    ...["--milestone", "-m", "--assignee", "-a", "--project", "-p", "--template", "-T"],
    ...["--parent", "--recover", "--repo", "-R"],
  ]),
  alone: new Set(["--web", "-w", "--editor", "-e"]),
};

/** The category labels an issue carries one of (Matt Pocock's triage roles). */
const CATEGORY_LABELS = new Set(["bug", "enhancement"]);
/** The triage labels an issue carries exactly one of (Matt Pocock's triage roles). */
const TRIAGE_LABELS = new Set([
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
]);

/** What an issue filed with `gh issue create` lacks of what every issue has (#324). */
export type IssueGap = "no-milestone" | "no-category" | "no-triage" | "triages";

/**
 * What the issue a command files lacks (#324): a milestone, a category label, exactly one triage
 * label. Nothing for a command that files no issue; everything for one whose flags can't be read.
 */
export const issueGapsIn = (words: readonly string[]): readonly IssueGap[] => {
  const [gh, issue, create, ...rest] = words;
  if (gh !== "gh" || issue !== "issue" || create !== "create") return [];
  const values = ghParts(rest, ISSUE_CREATE)?.values ?? [];
  const milestone = values.some(([flag, value]) => PR_MILESTONE.includes(flag) && value !== "");
  const labels = values
    .filter(([flag]) => flag === "--label" || flag === "-l")
    .flatMap(([, value]) => value.split(",").map((label) => label.trim()));
  const triages = new Set(labels.filter((label) => TRIAGE_LABELS.has(label))).size;
  return [
    ...(milestone ? [] : ["no-milestone" as const]),
    ...(labels.some((label) => CATEGORY_LABELS.has(label)) ? [] : ["no-category" as const]),
    ...(triages === 0 ? ["no-triage" as const] : triages > 1 ? ["triages" as const] : []),
  ];
};

/** The flags `gh run download` takes: none for another repository. */
const RUN_DOWNLOAD: GhFlags = {
  withValue: new Set(["--dir", "-D", "--name", "-n", "--pattern", "-p"]),
  alone: new Set(),
};

/**
 * The one folder `gh run download` is told to unpack a run's artifacts into (`-D`), or `undefined`
 * when it names none, or a flag it doesn't take.
 */
const downloadFolder = (rest: readonly string[]) => {
  const parts = ghParts(rest, RUN_DOWNLOAD);
  if (parts === undefined || parts.positionals.length > 1) return undefined;
  const folders = parts.values.filter(([flag]) => flag === "--dir" || flag === "-D");
  return folders.length === 1 ? folders[0]?.[1] : undefined;
};

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
 * (#172), commenting on it and re-running a run's failed jobs, for a flake that isn't its own
 * (#356), filing, labelling, commenting on and closing the repository's issues, as Matt
 * Pocock's skills do (#181), and fetching origin, merging a branch from it into the session branch
 * and running the repository's own scripts and tests with node (#388).
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
  { words: ["pnpm"], more: true, runs: pickedCommand, runsFrom: pickedFolders },
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
  // A run's artifacts, for a fixing turn, into a folder git ignores (#202).
  {
    words: ["gh", "run", "download"],
    more: true,
    own: (rest) => downloadFolder(rest) !== undefined,
    unpacksInto: downloadFolder,
  },
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
    own: actsOnOwn(PR_EDIT),
    texts: GH_TEXTS,
  },
  // Saying a failing check is a flake that isn't the PR's, and re-running its failed jobs (#356).
  {
    words: ["gh", "pr", "comment"],
    more: true,
    own: actsOnOwn(PR_COMMENT),
    texts: GH_TEXTS,
  },
  { words: ["gh", "run", "rerun"], more: true, own: rerunsFailed },
  // Bringing the session branch up to date with its base (#388).
  { words: ["git", "fetch"], more: true, never: GIT_NEVER, own: fetchesOrigin },
  {
    words: ["git", "merge"],
    more: true,
    never: GIT_NEVER,
    onSessionBranch: true,
    own: mergesBase,
    texts: ["-m", "--message"],
  },
  // The repository's own scripts and tests, run directly (#388).
  { words: ["node", "--test"], more: true, never: NODE_NEVER, runsFrom: testFiles },
  {
    words: ["node"],
    more: true,
    never: NODE_NEVER,
    own: runsScript,
    runsFrom: (rest) => rest.slice(0, 1),
  },
];

/** A command named by its first words in a workspace's settings, with ` ...` when more may follow. */
const ruleNamed = (named: string): CommandRule => {
  const words = named.split(" ");
  const more = words.at(-1) === "...";
  return { words: more ? words.slice(0, -1) : words, more };
};

/** What Allow always allows (#185) as a workspace's settings name a command: `ruleNamed`'s form. */
export const namedAs = (allows: AlwaysAllow) =>
  [...allows.words, ...(allows.more ? ["..."] : [])].join(" ");

/** What a command named in a workspace's settings allows, as Allow always says it (#185). */
export const allowsOf = (named: string): AlwaysAllow => {
  const { words, more } = ruleNamed(named);
  return { words: [...words], more };
};

/** The rule a command allowed always (#185) is: its words, and whatever may follow them. */
export const alwaysRule = (allows: AlwaysAllow): CommandRule => ({
  words: allows.words,
  more: allows.more,
});

/**
 * A code workspace's command allowlist: the default, with the commands its settings add and
 * those the owner allowed always (#185), and without the default ones they remove (by their
 * words, whether or not more may follow).
 */
export const allowlistFor = (settings: {
  readonly add: readonly string[];
  readonly remove: readonly string[];
  readonly always: readonly { readonly command: string }[];
}): readonly CommandRule[] => {
  const removed = new Set(settings.remove.map((named) => ruleNamed(named).words.join(" ")));
  return [
    ...DEFAULT_ALLOWLIST.filter((rule) => !removed.has(rule.words.join(" "))),
    ...settings.add.map(ruleNamed),
    ...settings.always.map(({ command }) => ruleNamed(command)),
  ];
};

/**
 * A word Allow always may take into what it allows (#185): a command's or subcommand's name
 * (`pnpm`, `exec`, `left-pad`), never a path, an option, a number or a value.
 */
const PLAIN_WORD = /^[a-z][a-z0-9-]*$/;

/**
 * The default rules that check more than a command's words (what may follow them, the branch it's
 * on, whose pull request it names, the paths it reaches): a command of theirs that asks failed
 * one of those checks, which Allow always would skip.
 */
const CHECKED = DEFAULT_ALLOWLIST.filter(
  (rule) =>
    !rule.more ||
    rule.never !== undefined ||
    rule.own !== undefined ||
    rule.onSessionBranch === true ||
    rule.unpacksInto !== undefined,
);

/**
 * Commands that must always ask (#185 decision 4), by their first words: merging a pull request
 * (pushing to a branch not the session's), deleting a repository, a release or a ref, and git's
 * and gh's settings and sign-in, which hold credentials and decide what runs.
 */
const ALWAYS_ASKS: readonly (readonly string[])[] = [
  ["gh", "pr", "merge"],
  ["gh", "repo", "delete"],
  ["gh", "release", "delete"],
  ["gh", "auth"],
  ["gh", "secret"],
  ["gh", "variable"],
  ["gh", "ssh-key"],
  ["gh", "gpg-key"],
  ["git", "config"],
  ["git", "credential"],
  ["git", "update-ref"],
  ["git", "remote"],
];

/**
 * Programs that must always ask (#185): those that run another command named after them (a shell,
 * `xargs`, `find`'s `-exec`, `sudo`), or that read or hold credentials (the environment, keys).
 */
const ALWAYS_ASKING_PROGRAMS = new Set([
  ...["sh", "bash", "zsh", "fish", "dash", "pwsh", "powershell", "cmd", "eval", "exec"],
  ...["sudo", "su", "doas", "xargs", "find", "env", "printenv", "nohup", "timeout", "time"],
  ...["nice", "watch", "command", "builtin", "ssh", "scp", "sftp", "ssh-add", "ssh-keygen"],
  ...["gpg", "security", "op", "pass", "keychain", "secret-tool"],
]);

/** Words that name a credential, or where one is kept: a token, a key, `.env`, `.ssh`, a login. */
const CREDENTIALS =
  /token|secret|credential|passw|\.env|\.ssh|\.netrc|\.npmrc|\.pypirc|\.aws|\.gnupg|id_rsa|id_ed25519|\bauth\b/i;

/** Whether one list of words starts with the other. */
const startsWith = (words: readonly string[], first: readonly string[]) =>
  first.every((word, index) => words[index] === word);

/**
 * What Allow always would allow for a command off the allowlist (#185): its leading words, as
 * Claude Code does, so the same command with other arguments doesn't ask again. Those are the
 * words before its first path, option or value (`pnpm exec playwright test` of `pnpm exec
 * playwright test e2e/icons.spec.ts`); when every word is one of those, the last is taken as the
 * command's argument (`pnpm add` of `pnpm add left-pad`), unless that leaves only one. A command
 * of one word is allowed as itself. `undefined`, so never offered, for what must always ask
 * (decision 4): a command whose first word alone would follow (`rm -rf build`), one of a default
 * rule's that failed its checks, or whose words could cover one of those (`gh pr …` covers its own
 * pull request's commands), one that pushes, merges a pull request, deletes a repository, a
 * release or a ref, a program that runs another or holds credentials, and anything naming one.
 */
export const alwaysOffer = (words: readonly string[]): AlwaysAllow | undefined => {
  const [program] = words;
  if (program === undefined || ALWAYS_ASKING_PROGRAMS.has(program)) return undefined;
  if (words.some((word) => CREDENTIALS.test(word))) return undefined;
  if (words.length === 1)
    return PLAIN_WORD.test(program) ? { words: [program], more: false } : undefined;
  const plain = words.findIndex((word) => !PLAIN_WORD.test(word));
  const leading =
    plain === -1 ? words.slice(0, words.length > 2 ? -1 : undefined) : words.slice(0, plain);
  if (leading.length < 2) return undefined;
  const covers = (rule: readonly string[]) => startsWith(words, rule) || startsWith(rule, leading);
  if (CHECKED.some((rule) => covers(rule.words))) return undefined;
  if (ALWAYS_ASKS.some(covers)) return undefined;
  return { words: leading, more: true };
};

/**
 * Programs Allow all for this task (#428) never covers, besides those that must always ask: gh,
 * whose commands off the allowlist change things on GitHub, outside the session branch, and those
 * that reach beyond the worktree to the machine's services and processes.
 */
const ALL_ASKING_PROGRAMS = new Set([
  ...["gh", "docker", "podman", "kubectl", "systemctl", "service", "launchctl", "schtasks"],
  ...["kill", "pkill", "killall", "taskkill", "shutdown", "reboot"],
]);

/** Commands Allow all never covers, by their first words: publishing a package, and signing in. */
const ALL_ASKS: readonly (readonly string[])[] = ["npm", "pnpm", "yarn"].flatMap((manager) =>
  ["publish", "unpublish", "deprecate", "login", "logout", "adduser"].map((what) => [
    manager,
    what,
  ]),
);

/** Programs whose options before their command Allow all never reads past (#428). */
const OPTIONS_FIRST = new Set(["git", "pnpm", "npm", "yarn", "bun"]);

/** What runs another command named after it, by its first words (#428): `pnpm exec gh …`. */
const RUNNERS: readonly (readonly string[])[] = [
  ...[
    ["pnpm", "exec"],
    ["pnpm", "dlx"],
    ["npm", "exec"],
    ["yarn", "exec"],
    ["yarn", "dlx"],
  ],
  ...[["bun", "x"], ["npx"], ["pnpx"], ["bunx"]],
];

/** Programs that run code given on the line, by the options that give it (`python -c`, #428). */
const INLINE_CODE = new Map<string, readonly string[]>([
  ["python", ["-c"]],
  ["python3", ["-c"]],
  ["py", ["-c"]],
  ["perl", ["-e", "-E"]],
  ["ruby", ["-e"]],
  ["php", ["-r"]],
  ["deno", ["eval"]],
  ["bun", ["-e", "--eval", "-p", "--print"]],
]);

/**
 * Whether Allow all for this task (#428) covers a command only the owner could allow otherwise, so
 * it runs without asking while the session allows all. Never one that must still ask (decision
 * 4): one naming a path outside the worktree; one of a default rule's that failed its checks,
 * which covers pushing anywhere but the session's own branch, force pushing, deleting a branch and
 * gh's commands that act on another's pull request; anything else that must always ask (merging a
 * pull request, deleting a repository, a release or a ref, git's and gh's settings and sign-in, a
 * program that runs another, anything naming a credential); gh's other commands, publishing,
 * signing in, the machine's services and processes, and code given on the line; nor one told
 * options before its command, nor a runner's whose command isn't covered itself.
 */
export const allowsAll = (worktree: string, words: readonly string[]): boolean => {
  const [program, next] = words;
  if (program === undefined) return false;
  // Options before the command it runs (`git -c … push`, `pnpm --filter … exec`) could change
  // what it does, so they're never read past: it asks.
  if (OPTIONS_FIRST.has(program) && next?.startsWith("-") === true) return false;
  if (ALWAYS_ASKING_PROGRAMS.has(program) || ALL_ASKING_PROGRAMS.has(program)) return false;
  if (words.some((word) => CREDENTIALS.test(word))) return false;
  const inline = INLINE_CODE.get(program);
  if (inline !== undefined && words.some((word) => inline.includes(word))) return false;
  const first = [...ALWAYS_ASKS, ...ALL_ASKS, ...CHECKED.map((rule) => rule.words)];
  if (first.some((asks) => startsWith(words, asks))) return false;
  // A runner (`pnpm exec`, `npx`) is covered only as far as the command it runs is.
  const runner = RUNNERS.find((runs) => startsWith(words, runs));
  if (runner !== undefined) {
    const runs = words.slice(runner.length);
    return runs[0]?.startsWith("-") === false && allowsAll(worktree, runs);
  }
  return !reachesOut(worktree, { words: [program], more: true }, words);
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
