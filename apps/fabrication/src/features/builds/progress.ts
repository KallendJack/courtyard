import {
  type BuildOpened,
  type BuildProgress,
  type BuildStep,
  type DerivedBuild,
  stepReached,
  tickedIn,
} from "@courtyard/contract";
import { useCallback, useRef, useState } from "react";
import { keepProgress } from "@/api/fabrication";

// How far the owner has got with a Build's steps (#699): the step reached and the lines ticked,
// changed on the page at once and kept by the worker, in order, so the Fold, the PC and a new
// session open where they left off. Steps go by their IDs, so ticks stay on their steps when the
// Build changes.

/** Progress with a step's ticked lines replaced. */
const withLines = (progress: BuildProgress, step: string, lines: readonly number[]) => ({
  ...progress,
  ticked: [
    ...progress.ticked.filter((each) => each.step !== step),
    ...(lines.length === 0 ? [] : [{ step, lines: [...lines].sort((a, b) => a - b) }]),
  ],
});

/**
 * What the 3D view shows at a step: the parts put on the Build up to it, with what they're fitted
 * with, and the step's own parts lit. Before anything's put on (checking, marking, cutting) it's
 * the whole Build, so the owner sees what the pieces become.
 */
export const inView = (derived: DerivedBuild, step: BuildStep) => {
  const added = derived.steps
    .filter((each) => each.number <= step.number)
    .flatMap((each) => each.adds);
  return {
    shown: added.length === 0 ? undefined : new Set(added),
    current: new Set(step.parts),
  };
};
export type InView = ReturnType<typeof inView>;

const same = (a: BuildProgress, b: BuildProgress) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A Build's progress on the page: changed at once, then kept by the worker, one save after
 * another so the last one wins. Progress read again from the worker (from another device) is
 * taken up unless a save is on its way.
 */
export const useProgress = (
  build: BuildOpened,
  /** Reads the Build again once progress is kept, so the page never holds an older place. */
  reread: () => void,
) => {
  const workspaceId = build.place.workspace.id;
  const { slug } = build;
  const [progress, setProgress] = useState(build.progress);
  // What the worker was last known to have, so only a change made elsewhere is taken up.
  const [known, setKnown] = useState(build.progress);
  const [problem, setProblem] = useState<string>();
  const sending = useRef(false);
  const waiting = useRef<BuildProgress | undefined>(undefined);

  if (!sending.current && !same(build.progress, known)) {
    setKnown(build.progress);
    setProgress(build.progress);
  }

  const keep = useCallback(
    async (wanted: BuildProgress) => {
      waiting.current = wanted;
      if (sending.current) return;
      sending.current = true;
      while (true) {
        const next = waiting.current;
        if (next === undefined) break;
        waiting.current = undefined;
        setKnown(next);
        const kept = await keepProgress({ workspaceId, slug }, next);
        setProblem(
          kept.kind === "loaded"
            ? undefined
            : "Your place couldn't be kept just now. It's still here on this screen.",
        );
      }
      sending.current = false;
      reread();
    },
    [workspaceId, slug, reread],
  );

  const change = (next: BuildProgress) => {
    setProgress(next);
    void keep(next);
  };
  const { steps } = build.derived;
  const step = stepReached(steps, progress);
  /** The step at a number, kept by its ID. */
  const at = (number: number) => steps[Math.max(1, Math.min(number, steps.length)) - 1]?.id ?? null;

  return {
    progress,
    step,
    problem,
    /** Moves to a step, by its number. */
    go: (number: number) => change({ ...progress, step: at(number) }),
    /** Ticks a line of the step reached, or unticks it. */
    tick: (line: number) => {
      if (step === undefined) return;
      const lines = tickedIn(progress, step.id);
      change(
        withLines(
          progress,
          step.id,
          lines.includes(line) ? lines.filter((each) => each !== line) : [...lines, line],
        ),
      );
    },
    /** "Done, next step": every line of this step ticked, and on to the next. */
    done: () => {
      if (step === undefined) return;
      const all = step.actions.map((_, line) => line);
      const ticked = withLines(progress, step.id, all);
      change({ ...ticked, step: at(step.number + 1) });
    },
  };
};
export type Progress = ReturnType<typeof useProgress>;

/** How the actions read: "Show me how" for a beginner, or "Just the numbers". */
export type Detail = "how" | "numbers";

const DETAIL_KEY = "fabrication-detail";

/** The detail chosen, kept on this device, since it's how this person reads steps. */
export const useDetail = () => {
  const [detail, setDetail] = useState<Detail>(() =>
    localStorage.getItem(DETAIL_KEY) === "numbers" ? "numbers" : "how",
  );
  const choose = (chosen: Detail) => {
    setDetail(chosen);
    localStorage.setItem(DETAIL_KEY, chosen);
  };
  return [detail, choose] as const;
};
