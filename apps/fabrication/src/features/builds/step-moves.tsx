import type { BuildStep, DerivedBuild } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { type PointerEvent, useRef } from "react";
import type { Progress } from "./progress.ts";

// How the owner moves between a Build's steps (#699, #753): Back and Done at the foot, a swipe at
// the bench, and the dots that show how far they've got.

/** How far a swipe goes before it moves a step, in pixels. */
const SWIPE = 60;

/**
 * A step swiped (#753's boards): to the left for the next, to the right for the one before, with
 * a finger or a pen; nothing is ticked. Spread on the element the step is in.
 */
export const useSwipe = (progress: Progress, step: BuildStep) => {
  const from = useRef<{ x: number; y: number }>(undefined);
  return {
    onPointerDown: (event: PointerEvent) => {
      from.current =
        event.pointerType === "mouse" ? undefined : { x: event.clientX, y: event.clientY };
    },
    onPointerUp: (event: PointerEvent) => {
      const start = from.current;
      from.current = undefined;
      if (start === undefined) return;
      const across = event.clientX - start.x;
      const down = event.clientY - start.y;
      if (Math.abs(across) < SWIPE || Math.abs(across) < Math.abs(down) * 2) return;
      progress.go(step.number + (across < 0 ? 1 : -1));
    },
    onPointerCancel: () => {
      from.current = undefined;
    },
  };
};

/**
 * Back, and "Done, next step", pinned at the foot, big enough for dusty hands; above them, at the
 * bench, a line saying a swipe moves a step and where the rest is (`hint`).
 */
export function StepFoot(props: {
  derived: DerivedBuild;
  step: BuildStep;
  progress: Progress;
  hint?: string;
}) {
  const { derived, step, progress } = props;
  const last = step.number === derived.steps.length;
  return (
    <div className="flex shrink-0 flex-col gap-2 pt-3">
      {progress.problem !== undefined && (
        <p role="status" className="text-meta text-warning">
          {progress.problem}
        </p>
      )}
      {props.hint !== undefined && <p className="text-meta text-muted-foreground">{props.hint}</p>}
      <div className="flex gap-3">
        <Button
          variant="outline"
          size="thumb"
          disabled={step.number === 1}
          onClick={() => progress.go(step.number - 1)}
        >
          Back
        </Button>
        <Button variant="primary" size="thumb" grow onClick={progress.done}>
          {last ? "Done, all built" : "Done, next step"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Each step as a dot, done · now · to go: how far the Build has got, and nothing to tap (owner,
 * 2026-10-25). Back, Done and a swipe move between steps.
 */
export function StepDots(props: { derived: DerivedBuild; step: BuildStep }) {
  const { step } = props;
  const count = props.derived.steps.length;
  return (
    <div
      role="progressbar"
      aria-label="Steps"
      aria-valuemin={1}
      aria-valuemax={count}
      aria-valuenow={step.number}
      aria-valuetext={`Step ${step.number} of ${count}`}
      className="flex min-w-0 items-center gap-1.5"
    >
      {props.derived.steps.map((each) => (
        <span
          key={each.number}
          aria-hidden
          className={classes(
            "block h-2.5 shrink-0 rounded-full",
            each.number === step.number
              ? "w-6 bg-primary"
              : each.number < step.number
                ? "w-2.5 bg-success"
                : "w-2.5 bg-input",
          )}
        />
      ))}
    </div>
  );
}
