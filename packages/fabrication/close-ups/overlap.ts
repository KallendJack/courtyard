import type { CloseUp } from "../close-up.ts";
import { area, box, boxFaces, crossOn, drawn } from "./drawing.ts";

// A screwed overlap (#813; Paper, 2 · Agreed, "Fabrication · End frames in 3D, your kit · Fold
// (#785, #788)", its screwed-overlap close-up): one piece across another, the green where it sits
// on it, the only place a screw can go, and 2 crosses in it by eye, on a diagonal so the wood
// doesn't split along one grain line (#789).

/**
 * Two pieces screwed where one lies on the other: the piece on top, `across` wide and `thick`,
 * and the piece under it, its face `across` wide, `thick` deep. Each named as the step names it.
 */
export type Overlap = {
  readonly over: { readonly across: number; readonly thick: number; readonly name: string };
  readonly under: { readonly across: number; readonly thick: number; readonly name: string };
};

/** The pieces: the one under running back, the one on top running along, its end flush. */
export const overlapModel = ({ over, under }: Overlap) => {
  // A short way past the overlap each way: it's the overlap that matters.
  const past = 0.8 * Math.max(over.across, under.across);
  const top = under.thick + over.thick;
  return {
    under: box(0, -past, 0, under.across, over.across + 2 * past, under.thick),
    over: box(0, 0, under.thick, under.across + 1.5 * past, over.across, over.thick),
    /** Where the top piece sits on the one under it: the only place a screw goes. */
    green: { x: 0, y: 0, z: top, w: under.across, d: over.across },
    // One near a top corner, one near the opposite bottom corner, a fingertip in.
    crosses: [
      { x: under.across / 3, y: over.across / 4, z: top },
      { x: (2 * under.across) / 3, y: (3 * over.across) / 4, z: top },
    ],
  };
};

export const overlapCloseUp = (overlap: Overlap): CloseUp => {
  const model = overlapModel(overlap);
  const { green } = model;
  const size = Math.min(green.w, green.d) * 0.12;
  return drawn({
    type: "screwed-overlap",
    title: "Mark your screw spots",
    faces: [
      ...boxFaces(model.under, "timber"),
      ...boxFaces(model.over, "timber"),
      area(green.x, green.y, green.w, green.d, green.z, "just-screw"),
    ],
    strokes: [
      // The edge of the piece underneath, drawn across the top: the green's far side.
      {
        from: { x: green.w, y: 0, z: green.z },
        to: { x: green.w, y: green.d, z: green.z },
        look: "edge",
      },
      ...model.crosses.flatMap((cross) => crossOn(cross, size)),
    ],
    spots: model.crosses,
    pills: [
      { says: "Only in green", to: { x: green.w / 2, y: green.d / 2, z: green.z }, badge: 1 },
      { says: "2 crosses", to: model.crosses[1] ?? model.crosses[0] ?? green, badge: 2 },
      // Each piece named off the wood: the one on top past the green, the one under at its near end.
      {
        says: overlap.over.name,
        to: { x: (green.w + model.over.w) / 2, y: green.d / 2, z: green.z },
      },
      {
        says: overlap.under.name,
        to: {
          x: model.under.w / 2,
          y: model.under.y + model.under.d - (model.under.d - green.d) / 4,
          z: model.under.h,
        },
      },
    ],
    notes: [
      `Screws only in the green: where the ${overlap.over.name} sits on the ${overlap.under.name}. The red line is its edge, drawn.`,
      "By eye: 2 crosses on a diagonal, a fingertip from the edges.",
    ],
  });
};
