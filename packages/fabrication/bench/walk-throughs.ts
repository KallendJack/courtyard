import type { MarkedLength, WalkStep } from "../build.ts";
import {
  boltHoldCloseUp,
  PILOT,
  pilotCloseUp,
  plateDrillCloseUp,
  squareStockCloseUp,
  tapeHookCloseUp,
} from "./close-ups.ts";
import type { Shape } from "./frame.ts";
import { type Castors, spannerFor } from "./parameters.ts";

// What "show me how" walks through the first time a step needs a move a beginner may never have
// made (#777): marking a length, in the order it's done, and how deep a pilot hole goes. Each
// with its close-up where one shows the move, from the Build's own numbers.

/** A length's section as it lies flat: how wide its face is, and how thick. */
export type Section = { readonly wide: number; readonly thick: number };

/** Marking a length, as the first is marked: the tape, a tick, the square, the line. */
export const markingWalk = (length: MarkedLength | undefined, section: Section): WalkStep[] => {
  const first = length?.cuts[0];
  if (first === undefined) return [];
  return [
    {
      title: "Tape",
      says: "Hook the tape over the end you checked and pull it straight along one edge.",
      closeUp: tapeHookCloseUp(first.label, section.thick),
    },
    {
      title: "Tick",
      says: `At ${first.length}, make a small V in pencil, its point on the mark: a dot gets lost, a V points.`,
      closeUp: null,
    },
    {
      title: "Square",
      says: "Put the square's stock tight against the edge, and slide it until its blade touches the V's point.",
      closeUp: squareStockCloseUp(first.label, section.wide),
    },
    {
      title: "Line",
      says: "Hold the square still and draw along its blade, right across the face: that's the line you cut to.",
      closeUp: null,
    },
  ];
};

/** A screw's length from its name as shops give it, "5 × 80 screws"; none when it doesn't say. */
export const screwLength = (name: string): number | undefined => {
  const [, length] = /×\s*(\d+(?:\.\d+)?)/.exec(name) ?? [];
  return length === undefined ? undefined : Number(length);
};

/** How deep a pilot hole goes, the first time the steps drill one: as long as the screw. */
export const pilotWalk = (s: Shape, screws: string): WalkStep[] => {
  const depth = screwLength(screws);
  return [
    {
      title: "Pilot holes",
      says:
        depth === undefined
          ? `Drill each pilot hole with the ${PILOT} mm bit, as deep as a screw is long, so the screw doesn't split the wood.`
          : `Wrap a strip of tape round the ${PILOT} mm bit ${depth} mm from its tip, a screw's length, and stop drilling when the tape reaches the wood. A pilot hole stops the screw splitting the wood.`,
      closeUp: depth === undefined ? null : pilotCloseUp(s, depth),
    },
  ];
};

/**
 * Fitting a castor (#783): each hole drilled through the plate's own, so it can't be off, and the
 * bolt's head held while the nut is turned, so the bolt doesn't spin.
 */
export const castorWalk = (s: Shape, castors: Castors, boltLength: number): WalkStep[] => {
  const size = spannerFor(castors);
  return [
    {
      title: "Drill through the plate",
      says: "With the castor in place, drill through one of its plate's holes, then bolt it before the next, so every hole lines up with the plate. If the drill seems to stop, turn the collar behind the chuck to the drill symbol: the other numbers are for driving screws.",
      closeUp: plateDrillCloseUp(s, castors),
    },
    {
      title: "Hold the head",
      says:
        size === undefined
          ? "Hold the bolt's head still with a spanner, or pliers, and turn the nut with another spanner or a socket. Lock nuts are stiff all the way: that's normal."
          : `A spanner's size is stamped on it: look for ${size}. Hold the bolt's head still with one, or pliers, and turn the nut with another, or a ${size} mm socket. Lock nuts are stiff all the way: that's normal.`,
      closeUp: boltHoldCloseUp(s, castors, { size, boltLength }),
    },
  ];
};
