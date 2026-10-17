import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type SessionId,
  TASKS_AT_ONCE,
  type TaskEnding,
  TaskId,
  wordsOf,
} from "@courtyard/contract";
import { readTextEnd, readTextStart } from "../../lib/files.ts";
import type { CommandEnv } from "../../lib/git.ts";
import { err, ok, type Result } from "../../lib/result.ts";

/**
 * A code session's tasks (#182): long commands that outlive the turn that starts them, a dev
 * server or a slow test run. Each runs under a keeper (`keeper.ts`), which ends its whole process
 * tree when it's stopped, or when the worker goes, so none outlives the worker. Its output goes
 * straight to its file in the session's folder in the data folder, never the event log.
 */

/** The keeper each task runs under. */
const KEEPER = join(import.meta.dirname, "keeper.ts");

/** A task's output file, in its session's folder. */
export const taskOutputPath = (sessionFolder: string, task: TaskId) =>
  join(sessionFolder, "tasks", `${task}.log`);

/** Why a task didn't start. */
export type TaskRefusal =
  /** The session runs as many tasks as it may (`TASKS_AT_ONCE`). */
  | { readonly kind: "too-many" }
  /** Its command couldn't be read as one command, or its output file couldn't be made. */
  | { readonly kind: "unreadable" };

/** Who stops a task: the owner, its session ending, or the worker stopping. */
export type StoppedBy = Extract<TaskEnding, { kind: "stopped" }>["by"];

type Running = {
  readonly keeper: ChildProcess;
  /** Who asked it to stop, once someone has. */
  stoppedBy: StoppedBy | undefined;
  /** Resolves once it has ended and been told. */
  readonly ended: Promise<void>;
};

/** How long a task's last line, as the owner sees it, may be. */
const LAST_LINE_CHARACTERS = 200;

/** The last line a task's output has, from its end. */
const lastLineIn = (text: string) =>
  (
    text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .findLast((line) => line !== "") ?? ""
  ).slice(-LAST_LINE_CHARACTERS);

export const createTasks = () => {
  const sessions = new Map<SessionId, Map<TaskId, Running>>();
  const runningIn = (session: SessionId) => {
    const found = sessions.get(session) ?? new Map<TaskId, Running>();
    sessions.set(session, found);
    return found;
  };

  return {
    /**
     * Starts a task in `cwd`, its output in its file in `sessionFolder`, unless the session runs
     * as many as it may: its id. `ended` is told how it ended, once, after it has.
     */
    start: async (start: {
      session: SessionId;
      sessionFolder: string;
      command: string;
      cwd: string;
      env: CommandEnv;
      ended: (task: TaskId, ending: TaskEnding) => Promise<void>;
    }): Promise<Result<TaskId, TaskRefusal>> => {
      const running = runningIn(start.session);
      if (running.size >= TASKS_AT_ONCE) return err({ kind: "too-many" });
      const words = wordsOf(start.command);
      if (!words.ok) return err({ kind: "unreadable" });
      const task = TaskId.parse(randomUUID().slice(0, 8));
      const path = taskOutputPath(start.sessionFolder, task);
      let output: Awaited<ReturnType<typeof open>>;
      try {
        await mkdir(dirname(path), { recursive: true });
        output = await open(path, "a");
      } catch {
        return err({ kind: "unreadable" });
      }
      const env: NodeJS.ProcessEnv = { ...process.env };
      for (const [name, value] of Object.entries(start.env)) {
        if (value === undefined) delete env[name];
        else env[name] = value;
      }
      const keeper = spawn(process.execPath, [KEEPER, ...words.value], {
        cwd: start.cwd,
        env,
        stdio: ["pipe", output.fd, output.fd],
        windowsHide: true,
      });
      void output.close();
      // Says nothing if the keeper has gone already: it ends the task when its input closes.
      keeper.stdin?.on("error", () => {});
      let told: () => void = () => {};
      const entry: Running = {
        keeper,
        stoppedBy: undefined,
        ended: new Promise<void>((resolve) => {
          told = resolve;
        }),
      };
      running.set(task, entry);
      let done = false;
      const end = (code: number | null) => {
        if (done) return;
        done = true;
        running.delete(task);
        const ending: TaskEnding =
          entry.stoppedBy !== undefined
            ? { kind: "stopped", by: entry.stoppedBy }
            : code === 0
              ? { kind: "passed" }
              : { kind: "failed", exitCode: code };
        void start
          .ended(task, ending)
          .catch((error: unknown) => console.error(`Task ${task}: its end couldn't be told`, error))
          .finally(told);
      };
      keeper.on("error", () => end(null));
      keeper.on("exit", (code) => end(code));
      return ok(task);
    },

    /** Whether the task is still running in the session. */
    isRunning: (session: SessionId, task: TaskId) => sessions.get(session)?.has(task) === true,

    /** The session's tasks still running, oldest first. */
    running: (session: SessionId): TaskId[] => [...(sessions.get(session)?.keys() ?? [])],

    /**
     * Stops a task, by `by`: its whole process tree ends, and it's told as stopped. Resolves once
     * it has ended; `false` when it wasn't running.
     */
    stop: async (session: SessionId, task: TaskId, by: StoppedBy) => {
      const entry = sessions.get(session)?.get(task);
      if (entry === undefined) return false;
      entry.stoppedBy ??= by;
      entry.keeper.stdin?.end("stop\n");
      await entry.ended;
      return true;
    },

    /** Stops every task the session runs, by `by`, and resolves once they've all ended. */
    stopAll: async (session: SessionId, by: StoppedBy) => {
      const entries = [...(sessions.get(session)?.values() ?? [])];
      for (const entry of entries) {
        entry.stoppedBy ??= by;
        entry.keeper.stdin?.end("stop\n");
      }
      await Promise.all(entries.map((entry) => entry.ended));
    },

    /** A task's output, at most its last `characters`, and whether more came before it. */
    output: async (sessionFolder: string, task: TaskId, characters: number) => {
      const read = await readTextEnd(taskOutputPath(sessionFolder, task), characters);
      if (!read.ok) return read;
      return ok(read.value ?? { text: "", cut: false });
    },

    /** The start of a task's output, at most its first `bytes`: where a dev server says it serves (#183). */
    opening: async (sessionFolder: string, task: TaskId, bytes: number) => {
      const read = await readTextStart(taskOutputPath(sessionFolder, task), bytes);
      return read.ok ? (read.value ?? "") : "";
    },

    /** The last line a task has printed so far, for the row above the Reply box. */
    lastLine: async (sessionFolder: string, task: TaskId) => {
      const read = await readTextEnd(taskOutputPath(sessionFolder, task), 4096);
      return read.ok ? lastLineIn(read.value?.text ?? "") : "";
    },
  };
};

export type Tasks = ReturnType<typeof createTasks>;
