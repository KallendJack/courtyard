import type { MarkedLength, WalkStep } from "../build.ts";
import { screwSpotsCloseUp, squareStockCloseUp, tapeHookCloseUp } from "./close-ups.ts";
import type { Shape } from "./frame.ts";

// What "show me how" walks through the first time a step needs a move a beginner may never have
// made (#777): marking a length, in the order it's done, and marking a joint's screw spots
// (#789). Each with its close-up where one shows the move, from the Build's own numbers.

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

/**
 * Marking a joint's screw spots, the first time a rail is screwed to a leg (#789): no tape, as the
 * screws only have to hit the leg hidden under the rail. An offcut draws where it is.
 */
export const screwSpotsWalk = (s: Shape): WalkStep[] => [
  {
    title: "The leg's edge",
    says: "Lay an offcut of leg timber on the rail's end, flush with it, and draw along its inside edge. The strip it covered is where the leg is underneath.",
    closeUp: screwSpotsCloseUp(s),
  },
  {
    title: "Two crosses",
    says: "Draw 2 pencil crosses in the strip, on a diagonal: one near the top corner, one near the opposite bottom corner.",
    closeUp: null,
  },
  {
    title: "A fingertip in",
    says: "By eye: each cross about a fingertip from the strip's edges. It only has to hit the leg, and the diagonal keeps the wood from splitting.",
    closeUp: null,
  },
];
