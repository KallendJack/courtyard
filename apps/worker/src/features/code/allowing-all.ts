import {
  ALWAYS_ASKING_PROGRAMS,
  ALWAYS_ASKS,
  CHECKED,
  CREDENTIALS,
  NODE_LOADS,
  startsWith,
} from "./allowlist.ts";
import { codeOf, codeReachesOut, codeRunsOthers, givesCode } from "./inline-code.ts";
import { reachesOut } from "./paths.ts";
import { isAssignment } from "./routine.ts";

/**
 * What Allow all for this task covers (#428), and code given on the line (#464), which runs
 * without asking when it stays in the worktree (#730).
 */

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

/**
 * Whether Allow all for this task (#428) covers a command only the owner could allow otherwise, so
 * it runs without asking while the session allows all. Never one that must still ask (decision
 * 4): one naming a path outside the worktree; one of a default rule's that failed its checks,
 * which covers pushing anywhere but the session's own branch, force pushing, deleting a branch and
 * gh's commands that act on another's pull request; anything else that must always ask (merging a
 * pull request, deleting a repository, a release or a ref, git's and gh's settings and sign-in, a
 * program that runs another, anything naming a credential); gh's other commands, publishing,
 * signing in, and the machine's services and processes; nor one told options before its command,
 * nor a runner's whose command isn't covered itself, nor one given an environment that isn't a
 * test run's (#730: `GIT_TRACE=1 git push`, read as a program it isn't). Code given on the line
 * (`node -e`, `python -c`, #464) is covered, as the same code saved in the worktree would be, with
 * its text checked for paths and credentials too; never node's loading other code first or a
 * debugger, nor code that could run another program or reach the network (`codeRunsOthers`).
 */
export const allowsAll = (worktree: string, words: readonly string[]): boolean => {
  const [program, next] = words;
  if (program === undefined || isAssignment(program)) return false;
  const code = codeOf(words);
  // Options before the command it runs (`git -c … push`, `pnpm --filter … exec`) could change
  // what it does, so they're never read past: it asks. Code given on the line (`bun -e`) isn't one.
  if (OPTIONS_FIRST.has(program) && next?.startsWith("-") === true && !givesCode(program, next))
    return false;
  if (ALWAYS_ASKING_PROGRAMS.has(program) || ALL_ASKING_PROGRAMS.has(program)) return false;
  if (words.some((word) => CREDENTIALS.test(word))) return false;
  if (program === "node" && words.some((word) => NODE_LOADS.some((loads) => loads.test(word))))
    return false;
  // Node's rule fails code given on the line, which Allow all covers (#464); `node --test` stays.
  const checked = CHECKED.filter(
    (rule) => !(code !== undefined && rule.words.join(" ") === "node"),
  );
  const first = [...ALWAYS_ASKS, ...ALL_ASKS, ...checked.map((rule) => rule.words)];
  if (first.some((asks) => startsWith(words, asks))) return false;
  if (codeReachesOut(worktree, words) || codeRunsOthers(words)) return false;
  // A runner (`pnpm exec`, `npx`) is covered only as far as the command it runs is.
  const runner = RUNNERS.find((runs) => startsWith(words, runs));
  if (runner !== undefined) {
    const runs = words.slice(runner.length);
    return runs[0]?.startsWith("-") === false && allowsAll(worktree, runs);
  }
  if (code !== undefined) return true;
  return !reachesOut(worktree, { words: [program], more: true }, words);
};
