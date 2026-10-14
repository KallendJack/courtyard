import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
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

/** From a tablet up, where blocks share the page's height and their rows scroll inside (#335). */
const TABLET_UP = "(min-width: 48rem)";

/**
 * The least height a block can have and still show its label and its first row in full (#398),
 * from a tablet up, or `undefined` (no least height) on a phone, or when it isn't asked for. It's
 * measured, since rows differ: an approval's, with its button, is taller than a running one.
 */
const useOneRowAtLeast = (section: RefObject<HTMLElement | null>, wanted: boolean) => {
  const [least, setLeast] = useState<number>();
  useEffect(() => {
    const box = section.current;
    if (!wanted || box === null) return;
    const tabletUp = window.matchMedia(TABLET_UP);
    const measure = () => {
      const label = box.firstElementChild;
      // Its first row, or the one quiet line an empty block keeps its place with (#283).
      const row = box.querySelector<HTMLElement>("li, [data-block-empty]");
      if (!tabletUp.matches || !(label instanceof HTMLElement) || row === null) {
        setLeast(undefined);
        return;
      }
      const style = getComputedStyle(box);
      const edges = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"] as const;
      const around = edges.reduce((sum, edge) => sum + Number.parseFloat(style[edge]), 0);
      setLeast(around + label.offsetHeight + Number.parseFloat(style.rowGap) + row.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    const rows = new MutationObserver(measure);
    rows.observe(box, { childList: true, subtree: true });
    tabletUp.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      rows.disconnect();
      tabletUp.removeEventListener("change", measure);
    };
  }, [section, wanted]);
  return least;
};

/** One of Home's blocks: its label in capitals (gold, with a dot, when it needs the owner), and what's beside it. */
export function Block(props: {
  label: string;
  /** How many rows it has, after its label: Needs you's. */
  count?: number;
  needs?: boolean;
  /** Beside the label, on the right: "1 of 3", a milestone. */
  aside?: ReactNode;
  /**
   * From a tablet up, it takes the height its page gives it, rather than its rows' (#335): its
   * rows, in `BlockRows`, scroll inside it.
   */
  fill?: boolean;
  /**
   * From a tablet up, it never gets smaller than its label and one row (#398): with blocks above
   * and below it, it gives way to them only that far, and its rows scroll inside.
   */
  oneRowAtLeast?: boolean;
  children: ReactNode;
}) {
  const section = useRef<HTMLElement>(null);
  const oneRow = useOneRowAtLeast(section, props.oneRowAtLeast === true);
  return (
    <section
      ref={section}
      aria-label={props.label}
      style={oneRow === undefined ? undefined : { minHeight: oneRow }}
      className={classes(
        "flex min-w-0 flex-col gap-1.5 rounded-card border bg-surface p-3.5",
        props.needs && "border-warning/25",
        props.fill && "md:flex-1",
        (props.fill || props.oneRowAtLeast) && "md:min-h-0",
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
 * A block's rows, scrolling inside its card from a tablet up when there are more than fit (#335;
 * Paper, Components, "A block with more rows than fit"): its label stays put, a thin thumb shows
 * how far down they go, and a fade at the foot says there's more below, gone at the end. `capped`
 * stops them at a few rows' height in a block that keeps its own size (Running).
 */
export function BlockRows(props: { children: ReactNode; capped?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ overflows: boolean; atEnd: boolean }>({
    overflows: false,
    atEnd: true,
  });
  const measure = useCallback(() => {
    const box = scroller.current;
    if (box === null) return;
    const overflows = box.scrollHeight > box.clientHeight + 1;
    const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
    setFit((was) =>
      was.overflows === overflows && was.atEnd === atEnd ? was : { overflows, atEnd },
    );
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(measure);
    for (const each of [scroller.current, rows.current]) if (each !== null) observer.observe(each);
    return () => observer.disconnect();
  }, [measure]);
  return (
    <div className="relative flex min-h-0 flex-col md:flex-1">
      <div
        ref={scroller}
        onScroll={measure}
        className={classes(
          "scroll-thin min-h-0 md:flex-1 md:overflow-y-auto",
          props.capped && "md:max-h-56",
          fit.overflows && "md:pr-2",
        )}
      >
        <div ref={rows} className="flex flex-col gap-1.5">
          {props.children}
        </div>
      </div>
      {fit.overflows && !fit.atEnd && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-linear-to-b from-transparent to-surface max-md:hidden"
        />
      )}
    </div>
  );
}

/** What an empty block says, in one quiet line, keeping its place (#283): "Nothing running". */
export function BlockEmpty(props: { children: ReactNode }) {
  return (
    <p data-block-empty="" className="py-1 text-meta font-medium text-muted-foreground">
      {props.children}
    </p>
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
