import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { classes } from "@/lib/classes";

/**
 * Where a helper stands (#117), as its line shows it: finished (or stopped with its turn),
 * working, waiting on the owner's OK, or waiting for another helper to finish.
 */
export type HelperStanding = "done" | "stopped" | "working" | "needs-you" | "waiting";

/** The dot before a helper's line while it hasn't finished: violet while live, gold for the owner. */
const DOTS = {
  working: "size-2 rounded-full bg-primary",
  "needs-you": "size-2 rounded-full bg-warning",
  waiting: "size-2 rounded-full border-stroke border-placeholder",
} as const;

/** What a helper's line says on its right, in the colour of where it stands. */
const STATUS = {
  done: "text-success",
  stopped: "text-muted-foreground",
  working: "text-muted-foreground",
  "needs-you": "text-warning",
  waiting: "text-muted-foreground",
} as const;

/**
 * One helper's line in a turn (#117, Paper board "Tablet · Session: helpers at work"): "Helper ·"
 * and its name, with where it stands on the right ("Done · 6 steps", "Needs your OK"). A tap
 * opens, under it, what it did in a few words each, then its final report.
 */
export function HelperLine(props: {
  name: string;
  standing: HelperStanding;
  status: string;
  open: boolean;
  onToggle: () => void;
  /** What it did, in a few words each, shown once opened. */
  steps: readonly string[];
  /** Its final report, shown under its steps once opened. */
  report?: ReactNode;
}) {
  const { standing, open } = props;
  const finished = standing === "done" || standing === "stopped";
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={props.onToggle}
        className="flex h-7.5 w-full min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span aria-hidden className="flex w-4 shrink-0 items-center justify-center">
          {finished ? (
            <Chevron
              strokeWidth={2.5}
              className={classes("size-3.5", open ? "text-foreground" : "text-muted-foreground")}
            />
          ) : (
            <span className={DOTS[standing]} />
          )}
        </span>
        <span className="shrink-0 text-sm/5 font-medium text-muted-foreground">Helper ·</span>
        <span
          className={classes(
            "min-w-0 grow truncate text-interface font-semibold",
            standing === "waiting" ? "text-muted-foreground" : "text-foreground/90",
          )}
        >
          {props.name}
        </span>
        <span className={classes("shrink-0 text-label font-semibold", STATUS[standing])}>
          {props.status}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-l-2 border-input pl-5.5">
          {props.steps.length > 0 && (
            <p className="text-sm/5 font-medium text-muted-foreground">{props.steps.join(" · ")}</p>
          )}
          {props.report}
        </div>
      )}
    </div>
  );
}
