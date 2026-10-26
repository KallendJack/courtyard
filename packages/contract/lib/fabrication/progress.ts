import { z } from "zod";
import { BuildStepId } from "./derived.ts";

// How far the owner has got with a Build's steps (#699), and what follows from it, the same in
// Fabrication and in what a model is told: the step reached and whether building has started.

/** The most steps, and lines in a step, progress keeps: far more than any Build has. */
const MOST_STEPS = 200;

/**
 * How far the owner has got with a Build's steps (#699): the step reached, and the lines ticked in
 * each step by their place in it (0 is the first), so every device and a new session open where
 * they left off. Steps go by their IDs, never their numbers, so a step that comes or goes (castors
 * taken off) leaves the ticks on the steps they were ticked in. A Build not started has no step
 * reached and nothing ticked.
 */
export const BuildProgress = z.object({
  step: BuildStepId.nullable(),
  ticked: z
    .array(
      z.object({
        step: BuildStepId,
        lines: z.array(z.number().int().min(0).max(MOST_STEPS)).max(MOST_STEPS),
      }),
    )
    .max(MOST_STEPS),
  /**
   * Each step started (a line ticked) and the tool it was done with (#777), so it stays as it was
   * started, its ticks on the lines they were ticked on, when the owner's tools change. The worker
   * keeps these as lines are ticked; what's sent is never taken for them.
   */
  ways: z
    .array(z.object({ step: BuildStepId, tool: z.string().max(60) }))
    .max(MOST_STEPS)
    .default([]),
  /**
   * The tools the owner chose to buy for this Build, from its Tools tab (#763), by the steps' name
   * for them ("countersink-bit"), which its buy list lists until they have one.
   */
  buying: z.array(z.string().max(60)).max(MOST_STEPS).default([]),
  /**
   * The steps the owner can't do now, from Can't do this now at the bench (#793), each with why
   * ("Out of time", "Missing: 10 mm spanner × 2"), until Do it now or Done takes it off.
   */
  parked: z
    .array(z.object({ step: BuildStepId, why: z.string().max(120) }))
    .max(MOST_STEPS)
    .default([]),
});
export type BuildProgress = z.infer<typeof BuildProgress>;

/** Whether a step is done: every one of its lines ticked. */
const stepDone = (
  progress: BuildProgress,
  step: { id: string; actions: readonly unknown[] },
): boolean => tickedIn(progress, step.id).length >= step.actions.length;

/** The lines ticked in a step, by their place in it. */
export const tickedIn = (progress: BuildProgress, step: string): readonly number[] =>
  progress.ticked.find((each) => each.step === step)?.lines ?? [];

/**
 * The step reached, as the Build is now. Before any is, or when the Build no longer has it
 * (castors taken off), it's the first step with a line still to tick, or the last when all are.
 */
export const stepReached = <S extends { id: string; actions: readonly unknown[] }>(
  steps: readonly S[],
  progress: BuildProgress,
): S | undefined =>
  steps.find((step) => step.id === progress.step) ??
  steps.find((step) => !stepDone(progress, step)) ??
  steps.at(-1);

/** Whether the owner has started building: a line ticked, or a step past the first reached. */
export const buildStarted = (steps: readonly { id: string }[], progress: BuildProgress): boolean =>
  progress.ticked.some((each) => each.lines.length > 0) ||
  (progress.step !== null && progress.step !== steps[0]?.id);
