import type { BuildPart, DerivedBuild } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Check, CircleHelp } from "lucide-react";
import { Disclosure } from "@/components/disclosure";
import { PANEL } from "../at-the-bench.tsx";
import type { Progress } from "../progress.ts";
import { mm } from "../words.ts";
import { Fixing, Piece, pieceScale } from "./pictures.tsx";

// The parts page (#778; Paper, 2 · Agreed, "Fabrication · Parts page, any build · Fold 933×645
// (#778)"): before the steps, like a flat pack's inventory, every piece drawn with its letter,
// count and sizes, and the fixings bag by count. Label each piece ticks them off one part at a
// time, its how-to in full until the first is labelled, then a How? tap; Start step 1 goes on.

/** The longest piece's length on the page, in pixels: the rest are drawn at its scale. */
const LONGEST = 120;

/** A piece's sizes as the board has them: "950 · 45 × 95", or a sheet's "1250 × 600 · ply". */
const sizesOf = (part: BuildPart) =>
  part.material.kind === "sheet"
    ? `${mm(part.length)} × ${mm(part.width)} · ${/ply/i.test(part.material.stock) ? "ply" : "sheet"}`
    : `${mm(part.length)} · ${mm(part.thickness)} × ${mm(part.width)}`;

/** A part's tile: its letter, name and count, the piece in 3D, its sizes; tapped, it's labelled. */
function Tile(props: {
  part: BuildPart;
  scale: number;
  labelled: boolean;
  label: (part: string) => void;
}) {
  const { part, labelled } = props;
  return (
    <li>
      <button
        type="button"
        aria-pressed={labelled}
        aria-label={`${part.label}, ${part.name} × ${part.count}`}
        onClick={() => props.label(part.label)}
        className={classes(
          "flex h-full w-full flex-col gap-3 rounded-tile border p-3.5 text-left",
          labelled ? "border-success/40 bg-muted" : "border-border bg-muted",
        )}
      >
        <span className="flex w-full items-center gap-2.5">
          <span
            className={classes(
              "flex size-8 shrink-0 items-center justify-center rounded-full text-interface font-bold",
              labelled ? "bg-success text-background" : "bg-background text-foreground",
            )}
          >
            {part.label}
          </span>
          <span
            className={classes(
              "min-w-0 flex-1 text-answer leading-tight font-semibold",
              labelled ? "text-success" : "text-foreground",
            )}
          >
            {part.name}
            {labelled && <Check aria-hidden className="ml-1 inline size-4" />}
          </span>
          <span className="shrink-0 font-mono text-interface text-muted-foreground">
            × {part.count}
          </span>
        </span>
        <span className="flex min-h-12 items-center">
          <Piece part={part} scale={props.scale} />
        </span>
        <span className="font-mono text-meta text-muted-foreground">{sizesOf(part)}</span>
      </button>
    </li>
  );
}

/** Label each piece: in full until one's labelled, then a How? tap. */
function LabelEach(props: { begun: boolean }) {
  const how = "Pencil its letter on an end that won't show.";
  return (
    <div className="flex flex-col gap-2">
      <CapsLabel tone="primary">Before you start</CapsLabel>
      <h2 className="display-title text-sheet-title text-foreground">Label each piece</h2>
      {props.begun ? (
        <>
          <p className="text-interface text-muted-foreground">Tap a piece when it's done.</p>
          <Disclosure
            look="tap"
            icon={<CircleHelp aria-hidden className="size-4 text-primary-text" />}
            label="How?"
          >
            <p className="text-interface text-foreground">{how}</p>
          </Disclosure>
        </>
      ) : (
        <p className="text-answer text-muted-foreground">{how} Tap a piece when it's done.</p>
      )}
    </div>
  );
}

/** The fixings bag: each fixing's shape, its name and how many. */
function Bag(props: { bag: DerivedBuild["bag"] }) {
  if (props.bag.length === 0) return null;
  return (
    <section aria-label="Fixings bag" className="flex flex-col gap-2">
      <CapsLabel tone="muted" heading={{ level: 3 }}>
        Fixings bag
      </CapsLabel>
      <ul className="flex flex-col gap-1">
        {props.bag.map((item) => (
          <li key={item.name} className="flex min-h-10 items-center gap-3 text-interface">
            <Fixing item={item} />
            <span className="min-w-0 flex-1 text-foreground">{item.name}</span>
            <span className="shrink-0 font-mono text-muted-foreground">{item.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The parts page, at the bench: on the unfolded Fold the parts beside what to do before starting,
 * the bag and Start step 1; folded (`narrow`), the same stacked, and so in a computer's side
 * panel (`inPanel`), which is its own panel.
 */
export function PartsPage(props: {
  derived: DerivedBuild;
  progress: Progress;
  narrow: boolean;
  inPanel?: boolean;
}) {
  const { derived, progress, narrow } = props;
  const parts = derived.parts.filter((part) => part.material.kind !== "printed");
  const scale = pieceScale(parts, LONGEST);
  const { labelled } = progress.progress;
  const pieces = parts.reduce((sum, part) => sum + part.count, 0);
  const done = parts
    .filter((part) => labelled.includes(part.label))
    .reduce((sum, part) => sum + part.count, 0);
  const tiles = (
    <section aria-label="Your parts" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <CapsLabel tone="muted" heading={{ level: 2 }}>
          Your parts · {pieces} pieces
        </CapsLabel>
        <p role="status" className="text-interface text-success">
          {done} of {pieces} labelled
        </p>
      </div>
      <ul className={classes("grid gap-2.5", narrow ? "grid-cols-2" : "grid-cols-3")}>
        {parts.map((part) => (
          <Tile
            key={part.label}
            part={part}
            scale={scale}
            labelled={labelled.includes(part.label)}
            label={progress.label}
          />
        ))}
      </ul>
      <p className="text-interface text-muted-foreground">
        Lay them out by letter. Each step shows which ones it uses.
      </p>
    </section>
  );
  const start = (
    <div className="flex shrink-0 flex-col gap-2 pt-3">
      {progress.problem !== undefined && (
        <p role="status" className="text-meta text-warning">
          {progress.problem}
        </p>
      )}
      <Button variant="primary" size="thumb" grow onClick={() => progress.go(1)}>
        Start step 1
      </Button>
    </div>
  );
  const before = (
    <>
      <LabelEach begun={done > 0} />
      <hr className="border-border" />
      <Bag bag={derived.bag} />
    </>
  );
  const stacked = (
    <>
      <Scroller className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-col gap-5 pb-2">
          {tiles}
          {before}
        </div>
      </Scroller>
      {start}
    </>
  );
  if (props.inPanel) return stacked;
  return narrow ? (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <div className={classes(PANEL, "flex-1")}>{stacked}</div>
    </div>
  ) : (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3 p-3">
      <div className={PANEL}>
        <Scroller className="flex min-h-0 flex-1 flex-col">{tiles}</Scroller>
      </div>
      <div className={PANEL}>
        <Scroller className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-4 pb-2">{before}</div>
        </Scroller>
        {start}
      </div>
    </div>
  );
}
