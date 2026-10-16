import type { SessionId, TaskOutput, TaskTold } from "@courtyard/contract";
import { Button } from "@/components/buttons/button";
import { FormError } from "@/components/forms/form-error";
import { createKept, PlaceholderRows, useKept } from "@/components/layout/kept";
import { Sheet } from "@/components/sheets/sheet";
import { useAction } from "@/hooks/use-action";
import { describeProblem } from "../../components/layout/problems.tsx";
import { stopTask, taskOutputOf } from "./api.ts";

/** Each task's output as last read, so it opens with it at once. */
const KEPT = createKept<TaskOutput>();

/** How often a running task's output is asked for again while it's open. */
const LIVE_EVERY_MS = 1500;

/**
 * A task's full output (#182), its end, live while it runs, with Stop; loaded when it first opens.
 * Its output comes from the data folder, never the session's events.
 */
export default function TaskOutputSheet(props: {
  sessionId: SessionId;
  task: TaskTold;
  open: boolean;
  onClose: () => void;
}) {
  const { sessionId, task } = props;
  const running = task.ended === undefined;
  const output = useKept(KEPT, {
    key: `${sessionId} ${task.task}`,
    asking: props.open,
    // Asked again once it ends, for what it printed last.
    again: running,
    load: async () => {
      const loaded = await taskOutputOf(sessionId, task.task);
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
    busy: () => (running ? LIVE_EVERY_MS : undefined),
  });
  const stop = useAction(async () => {
    const stopped = await stopTask(sessionId, task.task);
    // Ended already (404) needs no word: its line says how.
    if (stopped.kind === "failed" && stopped.status === 404) return undefined;
    return stopped.kind === "loaded" ? undefined : describeProblem(stopped).body;
  });

  return (
    <Sheet title={task.command} open={props.open} onClose={props.onClose}>
      {output === undefined ? (
        <PlaceholderRows count={4} size="text" />
      ) : output.output === "" ? (
        <p className="text-meta text-muted-foreground">Nothing printed yet.</p>
      ) : (
        <>
          {output.cut && (
            <p className="text-meta text-muted-foreground">Only its latest output is shown.</p>
          )}
          <pre
            data-task-output=""
            className="font-mono text-caption whitespace-pre-wrap wrap-anywhere text-foreground/85"
          >
            {output.output}
          </pre>
        </>
      )}
      {running && (
        <div className="flex flex-col items-start gap-2">
          <FormError message={stop.error} />
          <Button
            variant="destructive"
            size="sm"
            busy={stop.busy}
            busyLabel="Stopping…"
            onClick={() => void stop.run()}
          >
            Stop
          </Button>
        </div>
      )}
    </Sheet>
  );
}
