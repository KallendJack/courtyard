import { ChevronRight } from "lucide-react";
import { classes } from "@/lib/classes";

/**
 * Where a task stands (#182), as its line shows it: running, or how it ended. Each colour means
 * one thing: violet is live, moss passed, red failed; a stopped one is quiet.
 */
export type TaskStanding = "running" | "passed" | "failed" | "stopped";

const DOTS = {
  running: "bg-primary shadow-glow animate-pulse",
  passed: "bg-success",
  failed: "bg-destructive-text",
  stopped: "bg-muted-foreground",
} as const;

const STATUS = {
  running: "text-muted-foreground",
  passed: "text-success",
  failed: "text-destructive-text",
  stopped: "text-muted-foreground",
} as const;

/**
 * One task's line (#182): its command, then where it stands on the right ("1:12", "finished · 2:14
 * · passed"). Running, it sits above the Reply box with the last line it printed under it; ended,
 * it's a line in the conversation where it ended. A tap opens its output.
 */
export function TaskLine(props: {
  command: string;
  standing: TaskStanding;
  status: string;
  /** The last line it printed, while it runs. */
  lastLine?: string;
  onOpen: () => void;
}) {
  const { standing } = props;
  const running = standing === "running";
  return (
    <button
      type="button"
      onClick={props.onOpen}
      aria-label={`Task · ${props.command} · ${props.status}`}
      className={classes(
        "flex w-full min-w-0 items-center gap-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        running
          ? "rounded-row bg-secondary px-3.5 py-2 ring-1 ring-input ring-inset"
          : "h-7.5 rounded-sm",
      )}
    >
      <span aria-hidden className="flex w-4 shrink-0 items-center justify-center">
        <span className={classes("size-2 rounded-full", DOTS[standing])} />
      </span>
      <span className="flex min-w-0 grow flex-col gap-px">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-sm/5 font-medium text-muted-foreground">Task ·</span>
          <code className="min-w-0 truncate font-mono text-meta font-semibold text-foreground/90">
            {props.command}
          </code>
        </span>
        {running && props.lastLine !== undefined && props.lastLine !== "" && (
          <span className="truncate font-mono text-caption text-muted-foreground">
            {props.lastLine}
          </span>
        )}
      </span>
      <span className={classes("shrink-0 font-mono text-meta font-semibold", STATUS[standing])}>
        {props.status}
      </span>
      <ChevronRight
        aria-hidden
        strokeWidth={2.5}
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    </button>
  );
}
