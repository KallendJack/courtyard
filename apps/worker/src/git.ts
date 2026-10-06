import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Runs git in `folder` and returns what it prints, trimmed, or throws when git fails. Git never
 * stops to ask for a password, in the terminal or a window, since nobody is there to answer.
 * `config` adds `-c` settings for this one command; a command still running after `timeoutMs` is
 * ended and fails.
 */
export const git = async (
  folder: string,
  args: readonly string[],
  options: { config?: readonly string[]; timeoutMs?: number } = {},
) => {
  const config = (options.config ?? []).flatMap((setting) => ["-c", setting]);
  const { stdout } = await run("git", [...config, ...args], {
    cwd: folder,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
    windowsHide: true,
    ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
  });
  return stdout.trim();
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
