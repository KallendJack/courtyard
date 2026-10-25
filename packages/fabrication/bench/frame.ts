import type { Box, Fitted, Part } from "../build.ts";
import type { BenchParameters } from "./parameters.ts";

// The framed bench's shape: where every piece goes, and so every piece's cut size.
//
// Two end frames (two legs each, an upper and a lower end rail on their inner faces) are joined by
// long rails on their outer faces, front and back, upper and lower. The legs' wide faces run along
// the bench. The top sits on the frame, reaching past it by the overhang on every side; the
// shelf rests on the lower long rails between the end frames; brace panels go on the outside of
// the ends and the back. On castors, each end frame stands on a base of the wider timber.

/** What the shelf leaves between itself and each end frame, so it drops in. */
const SHELF_GAP = 2;
/** How far a castor's plate sits in from each end of its base. */
const CASTOR_INSET = 10;

/** Cut to the whole mm below: a part a touch short fits, one a touch long doesn't. */
const cutSize = (mm: number) => Math.floor(mm + 1e-9);
/** A worked-out height, to a tenth of a mm. */
const tenth = (mm: number) => Math.round(mm * 10) / 10;
/** A size as a step says it to the owner: to the whole mm, though the Build keeps it exact. */
export const whole = (mm: number) => Math.round(mm);

export type Shape = ReturnType<typeof shapeOf>;

/** Every size the bench's parts come from, worked out once. */
export const shapeOf = (parameters: BenchParameters) => {
  const length = parameters.length.value;
  const depth = parameters.depth.value;
  const overhang = parameters.top.overhang.value;
  const top = parameters.top.sheet.thickness.value;
  /** The frame timber's section: thick across the bench, wide along it. */
  const thick = parameters.frame.timber.thickness.value;
  const wide = parameters.frame.timber.width.value;
  const wideThick = parameters.frame.wide.thickness.value;
  const wideWidth = parameters.frame.wide.width.value;
  const castor = parameters.castors?.height.value ?? 0;
  const base = parameters.castors ? wideThick : 0;
  const foot = castor + base;
  const leg = cutSize(parameters.height.value - top - foot);
  const frameLength = length - 2 * overhang;
  const frameDepth = depth - 2 * overhang;
  const endRail = frameDepth - 2 * thick;
  /** Between the end frames' inner faces. */
  const between = frameLength - 2 * (wide + thick);
  const shelfHeight = parameters.shelf.height.value;
  return {
    length,
    depth,
    height: tenth(foot + leg + top),
    overhang,
    top,
    shelfSheet: parameters.shelf.sheet.thickness.value,
    braceSheet: parameters.braces.sheet.thickness.value,
    thick,
    wide,
    wideThick,
    wideWidth,
    castor,
    foot,
    leg,
    legTop: tenth(foot + leg),
    frameLength,
    frameDepth,
    endRail,
    between,
    shelfHeight,
    shelfLength: between - 2 * SHELF_GAP,
    braceHeight: leg - shelfHeight,
    left: overhang,
    right: length - overhang,
    front: overhang,
    back: depth - overhang,
  };
};

/** Why a bench of these sizes can't be built, or nothing when it can. */
export const shapeProblems = (shape: Shape): string[] => {
  const problems: string[] = [];
  if (shape.endRail <= 0) problems.push("The bench is too shallow for its frame.");
  if (shape.between <= 0) problems.push("The bench is too short for its end frames.");
  if (shape.leg <= 0) problems.push("The bench is too low for its top and castors.");
  else if (shape.shelfHeight + 2 * shape.wide > shape.leg) {
    problems.push("The lower rails are too high: they'd meet the upper rails.");
  }
  return problems;
};

const box = (x: number, y: number, z: number, w: number, d: number, h: number): Box => ({
  x: tenth(x),
  y: tenth(y),
  z: tenth(z),
  w: tenth(w),
  d: tenth(d),
  h: tenth(h),
});

/** The bench's parts, labelled as the agreed boards label them (no I, which reads as 1). */
export const benchParts = (parameters: BenchParameters, shape: Shape): Part[] => {
  const s = shape;
  const timber = { kind: "timber", stock: parameters.frame.timber.name } as const;
  const wideTimber = { kind: "timber", stock: parameters.frame.wide.name } as const;
  const upper = s.legTop - s.wide;
  const lower = s.foot + s.shelfHeight;
  const middle = (thickness: number) => (s.length - thickness) / 2;
  const frameTimber = { width: s.wide, thickness: s.thick, material: timber };
  const wideCut = { width: s.wideWidth, thickness: s.wideThick, material: wideTimber };
  const { ends, rear } = parameters.braces;
  const braced =
    ends && rear
      ? "the outside of the ends and the back"
      : ends
        ? "the outside of the ends"
        : "the back";

  const parts: (Omit<Part, "count"> & { on: boolean })[] = [
    {
      on: true,
      label: "A",
      name: "Legs",
      does: `One at each corner, standing on ${parameters.castors ? "the castor bases" : "the floor"}.`,
      length: s.leg,
      ...frameTimber,
      boxes: [s.left, s.right - s.wide].flatMap((x) =>
        [s.front + s.thick, s.back - 2 * s.thick].map((y) =>
          box(x, y, s.foot, s.wide, s.thick, s.leg),
        ),
      ),
    },
    {
      on: true,
      label: "B",
      name: "Long rails",
      does: `Front and back, top and bottom. The top pair holds the top, the bottom pair ${parameters.shelf.on ? "the shelf" : "stiffens the frame"}.`,
      length: cutSize(s.frameLength),
      ...frameTimber,
      boxes: [s.front, s.back - s.thick].flatMap((y) =>
        [upper, lower].map((z) => box(s.left, y, z, s.frameLength, s.thick, s.wide)),
      ),
    },
    {
      on: true,
      label: "C",
      name: "End rails",
      does: "Join each end's two legs, top and bottom, making the two end frames.",
      length: cutSize(s.endRail),
      ...frameTimber,
      boxes: [s.left + s.wide, s.right - s.wide - s.thick].flatMap((x) =>
        [upper, lower].map((z) => box(x, s.front + s.thick, z, s.thick, s.endRail, s.wide)),
      ),
    },
    {
      on: parameters.shelf.on,
      label: "D",
      name: "Shelf support",
      does: "Across the middle under the shelf, so it doesn't sag.",
      length: cutSize(s.endRail),
      ...frameTimber,
      boxes: [box(middle(s.thick), s.front + s.thick, lower, s.thick, s.endRail, s.wide)],
    },
    {
      on: parameters.castors !== null,
      label: "E",
      name: "Castor bases",
      does: "Under each end frame, with a castor bolted under each end.",
      length: cutSize(s.frameDepth),
      ...wideCut,
      boxes: [s.left, s.right - s.wideWidth].map((x) =>
        box(x, s.front, s.castor, s.wideWidth, s.frameDepth, s.wideThick),
      ),
    },
    {
      on: true,
      label: "F",
      name: "Top support",
      does: "Across the middle under the top, so it doesn't sag.",
      length: cutSize(s.endRail),
      ...wideCut,
      boxes: [
        box(
          middle(s.wideThick),
          s.front + s.thick,
          s.legTop - s.wideWidth,
          s.wideThick,
          s.endRail,
          s.wideWidth,
        ),
      ],
    },
    {
      on: true,
      label: "G",
      name: "Top",
      does:
        s.overhang > 0
          ? "The worktop, reaching past the frame on every side."
          : "The worktop, flush with the frame.",
      length: cutSize(s.length),
      width: cutSize(s.depth),
      thickness: s.top,
      material: { kind: "sheet", stock: parameters.top.sheet.name },
      boxes: [box(0, 0, s.legTop, s.length, s.depth, s.top)],
    },
    {
      on: parameters.shelf.on,
      label: "H",
      name: "Shelf",
      does: "Rests on the lower long rails, between the end frames.",
      length: cutSize(s.shelfLength),
      width: cutSize(s.frameDepth),
      thickness: s.shelfSheet,
      material: { kind: "sheet", stock: parameters.shelf.sheet.name },
      boxes: [
        box(
          s.left + s.wide + s.thick + SHELF_GAP,
          s.front,
          lower + s.wide,
          s.shelfLength,
          s.frameDepth,
          s.shelfSheet,
        ),
      ],
    },
    {
      on: parameters.braces.ends || parameters.braces.rear,
      label: "J",
      name: "Braces",
      does: `On ${braced}, so the frame can't rack.`,
      length: cutSize(s.endRail),
      width: cutSize(s.braceHeight),
      thickness: s.braceSheet,
      material: { kind: "sheet", stock: parameters.braces.sheet.name },
      boxes: [
        ...(parameters.braces.ends
          ? [s.left - s.braceSheet, s.right].map((x) =>
              box(x, s.front + s.thick, lower, s.braceSheet, s.endRail, s.braceHeight),
            )
          : []),
        ...(parameters.braces.rear
          ? [box(middle(s.endRail), s.back, lower, s.endRail, s.braceSheet, s.braceHeight)]
          : []),
      ],
    },
  ];
  return parts
    .filter((part) => part.on)
    .map(({ on: _on, ...part }) => ({ ...part, count: part.boxes.length }));
};

/** The castors, under the ends of each base. */
export const benchFitted = (parameters: BenchParameters, shape: Shape): Fitted[] => {
  const castors = parameters.castors;
  if (!castors) return [];
  const s = shape;
  const plateLength = castors.plate.length.value;
  const plateWidth = castors.plate.width.value;
  return [
    {
      name: castors.name,
      on: "E",
      boxes: [s.left, s.right - s.wideWidth].flatMap((x) =>
        [s.front + CASTOR_INSET, s.back - CASTOR_INSET - plateLength].map((y) =>
          box(x + (s.wideWidth - plateWidth) / 2, y, 0, plateWidth, plateLength, s.castor),
        ),
      ),
    },
  ];
};
