import { RunningTasks, type SessionId, type TaskId, TaskOutput } from "@courtyard/contract";
import { z } from "zod";
import { fromWorker, sendJson } from "../../api/worker.ts";

// A code session's tasks (#182), as the worker has them.

const tasksPath = (sessionId: SessionId) => `/sessions/${encodeURIComponent(sessionId)}/tasks`;

/** The session's tasks still running, each with the last line it printed. */
export const runningTasksOf = (sessionId: SessionId) =>
  fromWorker(tasksPath(sessionId), RunningTasks);

/** A task's output, its end. */
export const taskOutputOf = (sessionId: SessionId, task: TaskId) =>
  fromWorker(`${tasksPath(sessionId)}/${encodeURIComponent(task)}/output`, TaskOutput);

/** The owner's Stop: it ends, telling nobody. */
export const stopTask = (sessionId: SessionId, task: TaskId) =>
  sendJson({
    path: `${tasksPath(sessionId)}/${encodeURIComponent(task)}/stop`,
    body: {},
    schema: z.unknown(),
  });
