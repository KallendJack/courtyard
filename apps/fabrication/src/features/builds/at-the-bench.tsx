import type { BuildStep, DerivedBuild } from "@courtyard/contract";
import { classes } from "@courtyard/ui/lib/classes.ts";
import type { ReactNode } from "react";
import { BenchPanel } from "./bench-panel.tsx";
import type { BenchAsk } from "./chat/hold-to-ask.tsx";
import type { Progress } from "./progress.ts";
import { BenchStep } from "./step/bench-step.tsx";
import { useSwipe } from "./step-moves.tsx";

/** A panel on the PC and the Fold: one of the boards' cards. */
export const PANEL =
  "flex min-h-0 min-w-0 flex-col rounded-card border border-border bg-surface p-4";

/** What both of the Fold's ways of working show of the Build in 3D. */
type Bench = {
  name: string;
  derived: DerivedBuild;
  lit: string | undefined;
  pick: (label: string) => void;
  /** Hold to ask, at the foot of the 3D view. */
  ask: ReactNode;
  /** What was asked's answer, over the 3D view while it shows. */
  answer: ReactNode;
  /** A printed part on the printer's plate (#702), shown in place of the bench in 3D. */
  printed: ReactNode | undefined;
};

/** A printed part's picture, with Hold to ask at its foot and the answer over it, as the bench's. */
function Printed(props: { printed: ReactNode; ask: ReactNode; answer: ReactNode }) {
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {props.printed}
      {props.answer !== null && props.answer !== undefined && (
        <div className="pointer-events-none absolute inset-x-0 top-0 bottom-18 flex flex-col justify-end *:pointer-events-auto">
          {props.answer}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end *:pointer-events-auto">
        {props.ask}
      </div>
    </div>
  );
}

/**
 * At the bench (#753; Paper, 2 · Agreed, "Fabrication · At the bench · Fold 933×645" and
 * "· Cover 476×695"): one step at a time, filling the screen. On the unfolded Fold, the step in 3D
 * on the left, with Hold to ask and Reset view, and the step as its boards have it on the right
 * (`BenchStep`, #826); folded, the same stacked. A swipe on the step moves to the next or the one
 * before. No chat: what's asked is answered over the picture, and the full chat is in Plan.
 */
export function AtTheBench(
  props: Bench & {
    step: BuildStep;
    progress: Progress;
    /** Is this right? (#793): the photo, asked about against the step. */
    check: (ask: BenchAsk) => Promise<string | undefined>;
    cover: boolean;
  },
) {
  const { derived, step, progress, cover } = props;
  const swipe = useSwipe(progress, step);
  const picture =
    props.printed === undefined ? (
      <BenchPanel
        name={props.name}
        derived={derived}
        lit={props.lit}
        pick={props.pick}
        atStep={{ step }}
        bench
        withCards={!cover}
        over={props.answer}
      >
        {props.ask}
      </BenchPanel>
    ) : (
      <Printed printed={props.printed} ask={props.ask} answer={props.answer} />
    );
  const theStep = (
    <div
      {...swipe}
      className="flex min-h-0 min-w-0 flex-1 touch-pan-y flex-col rounded-card border border-border bg-surface px-4.5 pt-4.5 pb-3"
    >
      <BenchStep derived={derived} step={step} progress={progress} check={props.check} />
    </div>
  );
  return cover ? (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className={classes(PANEL, "h-2/5 shrink-0")}>{picture}</div>
      {theStep}
    </div>
  ) : (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 p-3">
      <div className={PANEL}>{picture}</div>
      {theStep}
    </div>
  );
}

/**
 * Plan (#753; Paper, 2 · Agreed, "Fabrication · Plan · Fold 933×645"): the Build big in 3D, with
 * Hold to ask and Chat, and its cut plan, buy list and tools as tabs beside it (`side`). Folded,
 * only a Build with no steps shows it, stacked.
 */
export function Plan(props: Bench & { side: ReactNode; cover: boolean }) {
  const bench =
    props.printed === undefined ? (
      <BenchPanel
        name={props.name}
        derived={props.derived}
        lit={props.lit}
        pick={props.pick}
        resettable={!props.cover}
        over={props.answer}
      >
        {props.ask}
      </BenchPanel>
    ) : (
      <Printed printed={props.printed} ask={props.ask} answer={props.answer} />
    );
  return props.cover ? (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className={classes(PANEL, "h-2/5 shrink-0")}>{bench}</div>
      <div className={classes(PANEL, "flex-1 gap-4")}>{props.side}</div>
    </div>
  ) : (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3 p-3">
      <div className={PANEL}>{bench}</div>
      <div className={classes(PANEL, "gap-4")}>{props.side}</div>
    </div>
  );
}
