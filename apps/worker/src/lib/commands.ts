import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CommandEnv } from "./git.ts";

const windows = process.platform === "win32";

/**
 * The shell a command line runs in: bash where there is one, so a model's command means on the
 * Windows worker what it means anywhere (Git for Windows' bash, which Claude Code needs there
 * too), else the system's own.
 */
const shellFor = (): string | true => {
  if (!windows) return existsSync("/bin/bash") ? "/bin/bash" : true;
  const candidates = [
    process.env.CLAUDE_CODE_GIT_BASH_PATH,
    process.env.ProgramFiles && join(process.env.ProgramFiles, "Git", "bin", "bash.exe"),
    process.env["ProgramFiles(x86)"] &&
      join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe"),
  ];
  return candidates.find((path): path is string => Boolean(path) && existsSync(path ?? "")) ?? true;
};

/**
 * Ends a process and everything it started: its process group, or on Windows its tree. Says
 * nothing if it has gone already.
 */
export const endProcessTree = (pid: number) => {
  if (windows) {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-pid, name);
    } catch {
      // Gone already.
    }
  };
  signal("SIGTERM");
  setTimeout(() => signal("SIGKILL"), 3000).unref();
};

/** How a command run with `runCommand` ended. */
export type CommandEnded = {
  /** Its exit code, or `null` when it was ended (stopped, or out of time) or couldn't start. */
  readonly exitCode: number | null;
  /** What it printed, its output and errors together as they came: the end of it, when cut. */
  readonly output: string;
  /** Whether what it printed was longer than it keeps, so only the end is kept. */
  readonly cut: boolean;
  /** Whether it ran out of time and was ended. */
  readonly timedOut: boolean;
};

/**
 * Runs one command line in `cwd`, through the shell, and waits for it to end: how it ended and
 * the last `keep` characters it printed. `env` goes on top of `base` (an `undefined` is unset).
 * Stopping `signal`, or running past `timeoutMs`, ends it and everything it started.
 */
export const runCommand = (run: {
  command: string;
  cwd: string;
  base: NodeJS.ProcessEnv;
  env: CommandEnv;
  signal: AbortSignal;
  timeoutMs: number;
  keep: number;
}): Promise<CommandEnded> =>
  new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...run.base };
    for (const [name, value] of Object.entries(run.env)) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
    let output = "";
    let cut = false;
    let timedOut = false;
    const heard = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > run.keep) {
        output = output.slice(-run.keep);
        cut = true;
      }
    };
    const child = spawn(run.command, {
      cwd: run.cwd,
      env,
      shell: shellFor(),
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group, so the whole tree can be ended at once.
      detached: !windows,
      windowsHide: true,
    });
    child.stdout.on("data", heard);
    child.stderr.on("data", heard);
    const end = () => {
      if (child.pid !== undefined && child.exitCode === null) endProcessTree(child.pid);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      end();
    }, run.timeoutMs);
    run.signal.addEventListener("abort", end, { once: true });
    let done = false;
    const finish = (exitCode: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      run.signal.removeEventListener("abort", end);
      resolve({ exitCode: timedOut ? null : exitCode, output, cut, timedOut });
    };
    child.on("error", (error) => {
      output += `${error.message}\n`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
    if (run.signal.aborted) end();
  });
