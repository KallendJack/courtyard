import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Commits Courtyard makes itself (the context folder's, a new repo's first, #391) are its own,
 * never the owner's git identity or signing.
 */
export const AS_COURTYARD = [
  "user.name=Courtyard",
  "user.email=courtyard@courtyard.invalid",
  "commit.gpgsign=false",
];

/** Variables a command gets on top of the worker's environment: an `undefined` is unset. */
export type CommandEnv = Readonly<Record<string, string | undefined>>;

/**
 * Runs git in `folder` and returns what it prints, trimmed, or throws when git fails. Git never
 * stops to ask for a password, in the terminal or a window, since nobody is there to answer.
 * `config` adds `-c` settings for this one command, and `env` variables to the worker's own (an
 * `undefined` is unset); a command still running after `timeoutMs` is ended and fails.
 */
export const git = async (
  folder: string,
  args: readonly string[],
  options: {
    config?: readonly string[];
    timeoutMs?: number;
    env?: CommandEnv;
  } = {},
) => {
  const config = (options.config ?? []).flatMap((setting) => ["-c", setting]);
  const { stdout } = await run("git", [...config, ...args], {
    ...runIn(folder, options.env),
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
  });
  return stdout.trim();
};

/** How every git command here runs: in `folder`, never asking for a password, in no window. */
const runIn = (folder: string, env: CommandEnv = {}) => ({
  cwd: folder,
  env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
  windowsHide: true,
});

/**
 * Runs git in `folder` with `input` on its standard input, and returns what it prints as bytes,
 * for output that holds file contents measured in bytes (`git cat-file --batch`). Throws when git
 * fails, like `git`.
 */
export const gitBytes = async (
  folder: string,
  command: { args: readonly string[]; input: string },
) => {
  const running = run("git", [...command.args], {
    ...runIn(folder),
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  });
  // Git ending before it reads everything fails the command, never the worker.
  running.child.stdin?.on("error", () => undefined);
  running.child.stdin?.end(command.input);
  return (await running).stdout;
};

/** Like `git`, but nothing instead of a failure, for questions whose answer can be missing. */
export const gitOrNothing = async (folder: string, args: readonly string[]) => {
  try {
    return await git(folder, args);
  } catch {
    return undefined;
  }
};

/**
 * Whether git ignores a path in `folder`, as named, whether or not it's there yet: a folder
 * (ending in `/`) or a file, or one inside an ignored folder (#202, #219). `undefined` when git
 * can't say, such as for a path past a symbolic link.
 */
export const gitIgnores = async (folder: string, path: string) => {
  try {
    await git(folder, ["check-ignore", "--quiet", "--", path]);
    return true;
  } catch (error) {
    // Git says 1 for a path it doesn't ignore, and more when it fails.
    return error instanceof Error && "code" in error && error.code === 1 ? false : undefined;
  }
};

/**
 * A commit's title as pages show it, its short hash first ("7d518cd Rail and Talk key"): a pull
 * request's merge commit by the title it merged, the first line of its message's body (#335).
 */
export const commitTitle = (commit: { short: string; subject: string; body: string }) => {
  const merged = /^Merge pull request #\d+ from /.test(commit.subject)
    ? commit.body.split("\n").find((line) => line.trim() !== "")
    : undefined;
  return `${commit.short} ${merged?.trim() ?? commit.subject}`;
};

/** What went wrong with a git command, in git's own words: its first error line. */
export const gitFailureReason = (error: unknown) => {
  const stderr = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const first = lines.find((line) => /^(fatal|error):/.test(line)) ?? lines[0];
  if (first !== undefined) return first.replace(/^(fatal|error):\s*/, "");
  return error instanceof Error && "killed" in error && error.killed
    ? "Git took too long, so it was stopped."
    : "Git couldn't run.";
};
