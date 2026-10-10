import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

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
    env?: Readonly<Record<string, string | undefined>>;
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
const runIn = (folder: string, env: Readonly<Record<string, string | undefined>> = {}) => ({
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
