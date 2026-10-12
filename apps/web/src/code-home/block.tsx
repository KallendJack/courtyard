import type { ReactNode } from "react";
import { classes } from "@/lib/classes";

// The blocks a code workspace's Home is built from (#301; Paper, "Tablet · Code workspace Home"):
// a card with its label in capitals, and rows inside it. Needs you's card is ringed in gold.

/** What a row's second line says by its colour (AGENTS.md): passed, needs the owner, running, failed. */
const TONES = {
  passed: "text-success",
  needs: "text-warning",
  running: "text-primary-text",
  failed: "text-destructive",
  quiet: "text-muted-foreground",
} as const;

export type RowTone = keyof typeof TONES;

/** One of Home's blocks: its label in capitals (gold, with a dot, when it needs the owner), and what's beside it. */
export function Block(props: {
  label: string;
  /** How many rows it has, after its label: Needs you's. */
  count?: number;
  needs?: boolean;
  /** Beside the label, on the right: "1 of 3", a milestone. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={props.label}
      className={classes(
        "flex min-w-0 flex-col gap-1.5 rounded-card border bg-surface p-3.5",
        props.needs && "border-warning/25",
      )}
    >
      <div className="flex items-center justify-between gap-2 pb-1.5">
        <h2
          className={classes(
            "flex items-center gap-2 text-label font-bold tracking-label uppercase",
            props.needs ? "text-warning" : "text-muted-foreground",
          )}
        >
          {props.needs && <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />}
          {props.label}
          {props.count !== undefined && ` · ${props.count}`}
        </h2>
        {props.aside !== undefined && (
          <span className="truncate text-label font-semibold text-placeholder">{props.aside}</span>
        )}
      </div>
      {props.children}
    </section>
  );
}

/**
 * A row of a block: what it is in bold, a line under it in its colour, and its one action at the
 * end, in a slot of its own so the actions line up.
 */
export function BlockRow(props: {
  label: string;
  title: ReactNode;
  sub: ReactNode;
  tone: RowTone;
  /** Before the words: a running session's dot. */
  lead?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li
      aria-label={props.label}
      className="flex min-h-14 items-center gap-2.5 rounded-row bg-secondary py-2.5 pr-2.5 pl-3"
    >
      {props.lead}
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <p className="truncate text-sm/4.5 font-bold">{props.title}</p>
        <p className={classes("truncate text-label font-medium", TONES[props.tone])}>{props.sub}</p>
      </div>
      {props.action !== undefined && (
        <div className="flex shrink-0 flex-col items-end gap-1">{props.action}</div>
      )}
    </li>
  );
}
