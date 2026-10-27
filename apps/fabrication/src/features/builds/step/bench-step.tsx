import { type BuildStep, type DerivedBuild, tickedIn } from "@courtyard/contract";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { Check } from "lucide-react";
import { useState } from "react";
import type { BenchAsk } from "../chat/hold-to-ask.tsx";
import type { Progress } from "../progress.ts";
import { StepFoot } from "../step-moves.tsx";
import { Checklist, Meaning } from "../step-panel.tsx";
import { benchChips } from "../words.ts";
import { type Open, StepButtons, StepOpened } from "./step-buttons.tsx";

/** The step's tools as the bench's few chips: ticked, or gold while it isn't known you have it. */
function BenchChips(props: { step: BuildStep }) {
  const chips = benchChips(props.step);
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Tools for this step" className="flex flex-wrap gap-2 pt-2 max-md:pt-0.5">
      {chips.map((chip) => (
        <li
          key={chip.key}
          className={classes(
            "flex h-8 items-center gap-1.5 rounded-full px-3 text-sm",
            chip.ready ? "bg-secondary text-foreground" : "bg-warning/10 text-warning",
          )}
        >
          {chip.ready ? (
            <Check aria-hidden className="size-3.5 text-success" />
          ) : (
            <span aria-hidden className="size-1.5 rounded-full bg-warning" />
          )}
          {chip.says}
        </li>
      ))}
    </ul>
  );
}

/**
 * A step at the bench, as its agreed boards have it (#826; Paper, 2 · Agreed, "Fabrication · End
 * frames in 3D, your kit · Fold (#785, #788)" and "· Asking at the bench: step buttons + answer
 * card · Fold (#793)"), and nothing else: which step and how long, its title, its numbered lines
 * with their boxes, its tools as chips, then pinned at the foot its four buttons, and Back and
 * Done. What a button opens shows over the step's lines, never down them, with the buttons, Back
 * and Done still in reach, so on the unfolded Fold the step never scrolls.
 */
export function BenchStep(props: {
  derived: DerivedBuild;
  step: BuildStep;
  progress: Progress;
  /** Is this right? (#793): the photo, asked about against the step. */
  check: (ask: BenchAsk) => Promise<string | undefined>;
}) {
  const { derived, step, progress } = props;
  const [word, setWord] = useState<string>();
  const [open, setOpen] = useState<Open>();
  const [openFor, setOpenFor] = useState(step.id);
  // A new step opens with nothing open over it and no word's meaning.
  if (openFor !== step.id) {
    setOpenFor(step.id);
    setOpen(undefined);
    setWord(undefined);
  }
  const meaning = derived.glossary.find((each) => each.word === word);
  return (
    <section aria-label="Steps" className="flex min-h-0 flex-1 flex-col gap-3.5 max-md:gap-2.5">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Scroller data-step-panel className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-w-0 flex-col gap-3.5 max-md:gap-2">
            <div className="flex flex-col gap-1.5 max-md:gap-0.5">
              <CapsLabel tone="primary">
                Step {step.number} of {derived.steps.length} · about {step.minutes} min
                {step.helper ? " · needs a helper" : ""}
              </CapsLabel>
              <h2 className="display-title text-step text-foreground max-md:text-sheet-title">
                {step.title}
              </h2>
            </div>
            <div className="flex flex-col gap-2.5">
              <Checklist
                step={step}
                detail="how"
                ticked={tickedIn(progress.progress, step.id)}
                tick={progress.tick}
                openWord={setWord}
                bench
              />
              {meaning !== undefined && (
                <Meaning meaning={meaning} close={() => setWord(undefined)} />
              )}
              <BenchChips step={step} />
            </div>
          </div>
        </Scroller>
        {open !== undefined && (
          <StepOpened
            open={open}
            setOpen={setOpen}
            derived={derived}
            step={step}
            progress={progress}
          />
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2.5 max-md:gap-2">
        <StepButtons
          step={step}
          progress={progress}
          open={open}
          toggle={(which) => setOpen((now) => (now === which ? undefined : which))}
          check={props.check}
        />
        <StepFoot derived={derived} step={step} progress={progress} bench />
      </div>
    </section>
  );
}
