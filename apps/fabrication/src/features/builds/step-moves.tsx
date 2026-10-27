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
 * Back, and "Done, next step", pinned at the foot, big enough for dusty hands. At the bench
 * (`bench`, #826), as its boards draw them: square-cornered, Back narrow and Done the rest.
 */
export function StepFoot(props: {
  derived: DerivedBuild;
  step: BuildStep;
  progress: Progress;
  bench?: boolean;
}) {
  const { derived, step, progress } = props;
  const last = step.number === derived.steps.length;
  const done = last ? "Done, all built" : "Done, next step";
  // Back from step 1 goes to the parts page, when the Build has one (#778).
  const first = step.number === 1 && !progress.withParts;
  return (
    <div className={classes("flex shrink-0 flex-col gap-2", props.bench !== true && "pt-3")}>
      {progress.problem !== undefined && (
        <p role="status" className="text-meta text-warning">
          {progress.problem}
        </p>
      )}
      {props.bench === true ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={first}
            onClick={() => progress.go(step.number - 1)}
            className="h-14 w-24 shrink-0 rounded-lg max-md:h-12 bg-secondary text-answer font-semibold text-foreground active:translate-y-px disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={progress.done}
            className="h-14 flex-1 rounded-lg max-md:h-12 bg-primary text-talk font-bold text-primary-foreground hover:bg-primary/80 active:translate-y-px"
          >
            {done}
          </button>
        </div>
      ) : (
        <div className="flex gap-3">
          <Button
            variant="outline"
            size="thumb"
            disabled={first}
            onClick={() => progress.go(step.number - 1)}
          >
            Back
          </Button>
          <Button variant="primary" size="thumb" grow onClick={progress.done}>
            {done}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Each step as a dot, done · now · to go: how far the Build has got, and nothing to tap (owner,
 * 2026-10-25). Back, Done and a swipe move between steps.
 */
export function StepDots(props: {
  derived: DerivedBuild;
  /** The step's number: 0 on the parts page, before the first (#778). */
  at: number;
}) {
  const { at } = props;
  const count = props.derived.steps.length;
  return (
    <div
      role="progressbar"
      aria-label="Steps"
      aria-valuemin={0}
      aria-valuemax={count}
      aria-valuenow={at}
      aria-valuetext={at === 0 ? "Your parts, before step 1" : `Step ${at} of ${count}`}
      className="flex min-w-0 items-center gap-1.25 pl-1.5"
    >
      {props.derived.steps.map((each) => (
        <span
          key={each.number}
          aria-hidden
          className={classes(
            "block h-2 shrink-0 rounded-full",
            each.number === at
              ? "w-5.5 bg-primary"
              : each.number < at
                ? "w-2 bg-success"
                : "w-2 bg-input",
          )}
        />
      ))}
    </div>
  );
}
