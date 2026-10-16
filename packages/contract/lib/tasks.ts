import { z } from "zod";

// A code session's tasks (#182): long commands that outlive the turn that starts them, such as a
// dev server or a slow test run. Their output stays in the data folder, never in the event log.

/** A task, by the id the worker gave it, unique in its session. */
export const TaskId = z
  .string()
  .regex(/^[a-z0-9-]{1,64}$/)
  .brand<"TaskId">();
export type TaskId = z.infer<typeof TaskId>;

/** The most tasks a session runs at once: a fourth isn't started. */
export const TASKS_AT_ONCE = 3;

/**
 * How a task ended: its command passed (exit code 0) or failed (with its exit code, or none when
 * it was ended some other way, or never started); or it was stopped, by the owner, because its
 * session ended (its pull request merged or closed, or it was deleted), or by a worker restart.
 */
export const TaskEnding = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("passed") }),
  z.object({ kind: z.literal("failed"), exitCode: z.number().int().nullable() }),
  z.object({ kind: z.literal("stopped"), by: z.enum(["owner", "session-ended", "restart"]) }),
]);
export type TaskEnding = z.infer<typeof TaskEnding>;

/** A task still running, as the row above the Reply box shows it: the last line it printed. */
export const RunningTask = z.object({ task: TaskId, lastLine: z.string() });
export type RunningTask = z.infer<typeof RunningTask>;

/** A session's tasks still running, oldest first. */
export const RunningTasks = z.object({ tasks: z.array(RunningTask) });
export type RunningTasks = z.infer<typeof RunningTasks>;

/** The most of a task's output the owner is sent at once: its end, the newest part. */
export const TASK_OUTPUT_MAX_CHARACTERS = 200_000;

/** A task's output as the owner reads it: its end, and whether more came before it. */
export const TaskOutput = z.object({ output: z.string(), cut: z.boolean() });
export type TaskOutput = z.infer<typeof TaskOutput>;
