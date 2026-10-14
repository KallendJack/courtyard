import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { classes } from "@/lib/classes";

// The blocks a workspace's Home is built from (#301, #300; Paper, "Tablet · Code workspace Home",
// style guide "Workspace Home blocks"): a card with its label in capitals, and rows inside it.
// Needs you's card is ringed in gold. Its classes are in the stylesheet of each Home that shows it
// (code-home.css, planning-home.css), off the first load.

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
  /**
   * Its size is set by the layout, never by its rows (#398; Paper, "Code Home, fixed block sizes"):
   * from a tablet up, its share of the page's height; on a phone, two rows tall, the page scrolling
   * between blocks. Its rows, in `BlockRows`, scroll inside it, and empty it keeps its size.
   */
  fill?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={props.label}
      className={classes(
        "flex min-w-0 flex-col gap-1.5 rounded-card border bg-surface p-3.5",
        props.needs && "border-warning/25",
        props.fill && "md:min-h-0 md:flex-1 max-md:h-46 max-md:shrink-0",
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
 * A block's rows, scrolling inside its card when there are more than fit (#335, #398; Paper,
 * Components, "A block with more rows than fit"): its label stays put, a thin thumb shows how far
 * down they go, and a fade at the foot says there's more below, gone at the end; scrolled down, a
 * fade at the top says there's more above (#408). One per block: everything that scrolls in it.
 */
export function BlockRows(props: { children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ overflows: false, atStart: true, atEnd: true });
  const measure = useCallback(() => {
    const box = scroller.current;
    if (box === null) return;
    const overflows = box.scrollHeight > box.clientHeight + 1;
    const atStart = box.scrollTop <= 1;
    const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
    setFit((was) =>
      was.overflows === overflows && was.atStart === atStart && was.atEnd === atEnd
        ? was
        : { overflows, atStart, atEnd },
    );
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(measure);
    for (const each of [scroller.current, rows.current]) if (each !== null) observer.observe(each);
    return () => observer.disconnect();
  }, [measure]);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={measure}
        className={classes("scroll-thin min-h-0 flex-1 overflow-y-auto", fit.overflows && "pr-2")}
      >
        <div ref={rows} className="flex flex-col gap-1.5">
          {props.children}
        </div>
      </div>
      {fit.overflows && !fit.atStart && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-9 bg-linear-to-t from-transparent to-surface"
        />
      )}
      {fit.overflows && !fit.atEnd && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-linear-to-b from-transparent to-surface"
        />
      )}
    </div>
  );
}

/** What an empty block says, in one quiet line, keeping its place (#283): "Nothing running". */
export function BlockEmpty(props: { children: ReactNode }) {
  return <p className="py-1 text-meta font-medium text-muted-foreground">{props.children}</p>;
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
