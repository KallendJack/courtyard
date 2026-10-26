import type { BuildPart, DerivedBuild } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Check } from "lucide-react";
import { Disclosure } from "@/components/disclosure";
import { PANEL } from "../at-the-bench.tsx";
import type { Progress } from "../progress.ts";
import { mm } from "../words.ts";
import { Fixing, Piece, pieceScale } from "./pictures.tsx";

// The parts page (#778; Paper, 2 · Agreed, "Fabrication · Parts page, any build · Fold 933×645
// (#778)"): before the steps, like a flat pack's inventory, every piece drawn with its letter,
// count and sizes, and the fixings bag by count. Label each piece ticks them off one part at a
// time, with a How? chip for more; Start step 1 goes on.

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
          "flex h-full w-full flex-col gap-1.5 overflow-hidden rounded-row border bg-secondary p-2.5 text-left",
          labelled ? "border-success/33" : "border-input",
        )}
      >
        <span className="flex w-full items-center gap-2">
          <span
            className={classes(
              "flex size-6 shrink-0 items-center justify-center rounded-full text-label font-extrabold",
              labelled ? "bg-success text-background" : "bg-input text-foreground",
            )}
          >
            {part.label}
          </span>
          <span
            className={classes(
              "min-w-0 flex-1 text-sm/4.5 font-bold",
              labelled ? "text-success" : "text-foreground",
            )}
          >
            {part.name}
            {labelled && <Check aria-hidden className="ml-1 inline size-3.5 align-[-2px]" />}
          </span>
          <span className="shrink-0 font-mono text-meta text-muted-foreground">× {part.count}</span>
        </span>
        <Piece part={part} scale={props.scale} />
        <span className="font-mono text-label text-muted-foreground">{sizesOf(part)}</span>
      </button>
    </li>
  );
}

/** Label each piece: what to do, and a How? chip that opens how to do it well. */
function LabelEach() {
  return (
    <div className="flex flex-col gap-3">
      <CapsLabel tone="primary">Before you start</CapsLabel>
      <h2 className="display-title text-title text-foreground">Label each piece</h2>
      <div className="flex flex-col items-start gap-2.5">
        <p className="text-sm/5.25 text-muted-foreground">
          Pencil its letter on an end that won't show. Tap a piece when it's done.
        </p>
        <Disclosure look="chip" label="How? Shown the first time">
          <p className="text-sm/5.25 text-foreground">
            A pencil, not a pen: it sands off. Pick an end that goes into a joint or onto the floor,
            so once it's built it won't show.
          </p>
        </Disclosure>
      </div>
    </div>
  );
}

/** The fixings bag: each fixing's shape, its name and how many. */
function Bag(props: { bag: DerivedBuild["bag"] }) {
  if (props.bag.length === 0) return null;
  return (
    <section aria-label="Fixings bag" className="flex flex-col gap-2 border-t border-border pt-3.5">
      <CapsLabel tone="muted" heading={{ level: 3 }}>
        Fixings bag
      </CapsLabel>
      <ul className="flex flex-col gap-2">
        {props.bag.map((item) => (
          <li key={item.name} className="flex h-8.5 items-center gap-3 text-interface">
            <Fixing item={item} />
            <span className="min-w-0 flex-1 text-foreground">{item.name}</span>
            <span className="shrink-0 text-muted-foreground">{item.count}</span>
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
  const scale = pieceScale(parts);
  const { labelled } = progress.progress;
  const pieces = parts.reduce((sum, part) => sum + part.count, 0);
  const done = parts
    .filter((part) => labelled.includes(part.label))
    .reduce((sum, part) => sum + part.count, 0);
  const tiles = (
    <section aria-label="Your parts" className="flex flex-1 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <CapsLabel tone="muted" heading={{ level: 2 }}>
          Your parts · {pieces} pieces
        </CapsLabel>
        <p role="status" className="text-meta text-success">
          {done} of {pieces} labelled
        </p>
      </div>
      <ul className={classes("grid gap-2", narrow ? "grid-cols-2" : "grid-cols-3")}>
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
      <p className="mt-auto text-sm text-muted-foreground">
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
      <LabelEach />
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
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-3 p-3">
      <div className={PANEL}>
        <Scroller className="flex min-h-0 flex-1 flex-col">{tiles}</Scroller>
      </div>
      <div className={PANEL}>
        <Scroller className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col gap-3 pb-2">{before}</div>
        </Scroller>
        {start}
      </div>
    </div>
  );
}
