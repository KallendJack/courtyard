import type { BuildStep, DerivedBuild } from "@courtyard/contract";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import type { ReactNode } from "react";
import { BenchPanel } from "./bench-panel.tsx";
import { CloseUp } from "./close-up.tsx";
import type { InView, Progress } from "./progress.ts";
import { StepFoot, useSwipe } from "./step-moves.tsx";
import { StepPanel } from "./step-panel.tsx";

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
};

/**
 * At the bench (#753; Paper, 2 · Agreed, "Fabrication · At the bench · Fold 933×645" and
 * "· Cover 476×695"): one step at a time, filling the screen. On the unfolded Fold, the step in 3D
 * on the left, with Hold to ask and Reset view, and the step in big type on the right, Back and
 * Done at thumb height; folded, the same stacked. A swipe on the step moves to the next or the one
 * before.
 */
export function AtTheBench(
  props: Bench & {
    step: BuildStep;
    view: InView;
    progress: Progress;
    sendPhoto: (photo: File) => void;
    cover: boolean;
  },
) {
  const { derived, step, progress, cover } = props;
  const swipe = useSwipe(progress, step);
  const picture = (
    <BenchPanel
      name={props.name}
      derived={derived}
      lit={props.lit}
      pick={props.pick}
      atStep={{ step, view: props.view }}
      resettable={!cover}
      over={props.answer}
    >
      {props.ask}
    </BenchPanel>
  );
  const theStep = (
    <div {...swipe} className={classes(PANEL, "flex-1 touch-pan-y")}>
      <Scroller className="flex min-h-0 flex-1 flex-col">
        <StepPanel
          derived={derived}
          step={step}
          progress={progress}
          sendPhoto={props.sendPhoto}
          big={!cover}
        >
          {step.closeUp !== null && <CloseUp closeUp={step.closeUp} parts={derived.parts} narrow />}
        </StepPanel>
      </Scroller>
      <StepFoot
        derived={derived}
        step={step}
        progress={progress}
        hint={
          cover
            ? "Swipe for the next step · open it on the Fold for Plan"
            : "Swipe for the next step · Tools, cut plan and buy list in Plan"
        }
      />
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
  const bench = (
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
