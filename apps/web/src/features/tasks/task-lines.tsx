import type { RunningTasks, SessionId, TaskEnding, TaskTold } from "@courtyard/contract";
import { createKept, useKept } from "@courtyard/ui/layout/kept.tsx";
import { lazy, Suspense, useState } from "react";
import { useElapsed } from "@/components/chat/session-state";
import { TaskLine, type TaskStanding } from "@/components/chat/task-line";
import { elapsedWords } from "../../lib/when.ts";
import { runningTasksOf } from "./api.ts";

/** A task's output, with Stop while it runs: loaded when one first opens. */
const TaskOutputSheet = lazy(() => import("./task-output.tsx"));

/** How a task ended, as its line says it on the right: "passed", "failed · exit 1", "stopped by you". */
const endedWords = (ending: TaskEnding) => {
  switch (ending.kind) {
    case "passed":
      return "passed";
    case "failed":
      return ending.exitCode === null ? "failed" : `failed · exit ${ending.exitCode}`;
    case "stopped":
      return {
        owner: "stopped by you",
        "session-ended": "stopped as the session ended",
        restart: "stopped by a restart",
      }[ending.by];
  }
};

/** Where an ended task stands, by how it ended. */
const STANDINGS: Record<TaskEnding["kind"], TaskStanding> = {
  passed: "passed",
  failed: "failed",
  stopped: "stopped",
};

/** A task's output, opened from its line, while `open` has been set once. */
function OutputSheet(props: {
  sessionId: SessionId;
  task: TaskTold;
  open: boolean | undefined;
  onClose: () => void;
}) {
  if (props.open === undefined) return null;
  return (
    <Suspense>
      <TaskOutputSheet
        sessionId={props.sessionId}
        task={props.task}
        open={props.open}
        onClose={props.onClose}
      />
    </Suspense>
  );
}

/**
 * A task that ended (#182), a line in the conversation where it did: "`pnpm test` · finished ·
 * 2:14 · passed", which opens its output.
 */
export function TaskEndedLine(props: { sessionId: SessionId; task: TaskTold }) {
  const { task } = props;
  const [open, setOpen] = useState<boolean>();
  if (task.ended === undefined) return null;
  const { ending, at } = task.ended;
  const ran = elapsedWords(Date.parse(at) - Date.parse(task.startedAt));
  const how = ending.kind === "stopped" ? endedWords(ending) : `finished · ${endedWords(ending)}`;
  return (
    <>
      <TaskLine
        command={task.command}
        standing={STANDINGS[ending.kind]}
        status={`${ran} · ${how}`}
        onOpen={() => setOpen(true)}
      />
      <OutputSheet
        sessionId={props.sessionId}
        task={task}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** One running task's row: how long it's run, ticking. */
function RunningRow(props: { task: TaskTold; lastLine: string | undefined; onOpen: () => void }) {
  const elapsed = useElapsed(props.task.startedAt);
  return (
    <li>
      <TaskLine
        command={props.task.command}
        standing="running"
        status={elapsed}
        {...(props.lastLine === undefined ? {} : { lastLine: props.lastLine })}
        onOpen={props.onOpen}
      />
    </li>
  );
}

/** Each session's running tasks' last lines, as last read. */
const KEPT = createKept<RunningTasks>();

/** How often the running tasks' last lines are asked for again. */
const LIVE_EVERY_MS = 3000;

/**
 * A code session's tasks still running (#182), one row each above the Reply box: the command, how
 * long it's run and the last line it printed. A tap opens its full output, live, with Stop.
 */
export function RunningTaskRows(props: { sessionId: SessionId; tasks: readonly TaskTold[] }) {
  const running = props.tasks.filter((task) => task.ended === undefined);
  // The task whose output is open, and whether it is: kept here, not in its row, so a task that
  // ends while it's open (Stop) stays open on its output until it's closed.
  const [opened, setOpened] = useState<{ task: TaskTold["task"]; open: boolean }>();
  const openedTask = props.tasks.find((task) => task.task === opened?.task);
  const lines = useKept(KEPT, {
    key: props.sessionId,
    asking: running.length > 0,
    // Asked again as one starts or ends.
    again: running.length,
    load: async () => {
      const loaded = await runningTasksOf(props.sessionId);
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
    busy: () => LIVE_EVERY_MS,
  });
  return (
    <>
      {running.length > 0 && (
        <ul aria-label="Tasks running" className="mb-2.5 flex flex-col gap-1.5">
          {running.map((task) => (
            <RunningRow
              key={task.task}
              task={task}
              lastLine={lines?.tasks.find((each) => each.task === task.task)?.lastLine}
              onOpen={() => setOpened({ task: task.task, open: true })}
            />
          ))}
        </ul>
      )}
      {openedTask !== undefined && (
        <OutputSheet
          key={openedTask.task}
          sessionId={props.sessionId}
          task={openedTask}
          open={opened?.open}
          onClose={() => setOpened({ task: openedTask.task, open: false })}
        />
      )}
    </>
  );
}
