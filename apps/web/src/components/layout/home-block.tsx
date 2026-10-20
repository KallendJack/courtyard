import type { ReactNode } from "react";
import { classes } from "@/lib/classes";
import { CapsLabel } from "./caps-label.tsx";
import { Scroller } from "./scroller.tsx";

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
  /** In the aside's place, the block's own controls: the Builders board's Pause (#592). */
  actions?: ReactNode;
  /**
   * The Builders board's size (#592; Paper, "Tablet · Builders board"): from a tablet up, three
   * shares of the page's height to the block under it's one; on a phone, as tall as three rows.
   */
  tall?: boolean;
  /**
   * Its size is set by the layout, never by its rows (#398; Paper, "Code Home, fixed block sizes"):
   * from a tablet up, its share of the page's height; on a phone, two rows tall, the page scrolling
   * between blocks. Its rows, in `BlockRows`, scroll inside it, and empty it keeps its size.
   */
  fill?: boolean;
  /** Its size is its slot's, set by the page (Home's Needs you, #492); its rows scroll inside. */
  fillsSlot?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={props.label}
      className={classes(
        "flex min-w-0 flex-col gap-1.5 rounded-card border bg-surface p-3.5",
        props.needs && "border-warning/25",
        props.fill && "md:min-h-0 md:flex-1 max-md:h-46 max-md:shrink-0",
        props.tall && "md:min-h-0 md:flex-3 max-md:h-88 max-md:shrink-0",
        props.fillsSlot && "h-full min-h-0",
      )}
    >
      <div
        className={classes(
          "flex items-center justify-between gap-2",
          props.actions === undefined ? "pb-1.5" : "pb-0.5",
        )}
      >
        <CapsLabel
          tone={props.needs ? "warning" : "muted"}
          heading={{ level: 2 }}
          className="flex items-center gap-2"
        >
          {props.needs && <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />}
          {props.label}
          {props.count !== undefined && ` · ${props.count}`}
        </CapsLabel>
        {props.actions === undefined ? (
          props.aside !== undefined && (
            <span className="truncate text-label font-semibold text-placeholder">
              {props.aside}
            </span>
          )
        ) : (
          <div className="flex shrink-0 items-center gap-2">{props.actions}</div>
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
  return (
    <Scroller fadeEnd className="min-h-0 flex-1 data-overflows:pr-2">
      <div className="flex flex-col gap-1.5">{props.children}</div>
    </Scroller>
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
      <div className="flex min-w-0 grow flex-col">
        <p className="truncate text-sm/4.5 font-bold">{props.title}</p>
        <p className={classes("truncate text-meta font-medium", TONES[props.tone])}>{props.sub}</p>
      </div>
      {props.action !== undefined && (
        <div className="flex shrink-0 flex-col items-end gap-1">{props.action}</div>
      )}
    </li>
  );
}
