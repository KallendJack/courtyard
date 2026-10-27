import type { CloseUp } from "../close-up.ts";
import { type At3, area, box, boxFaces, drawn } from "./drawing.ts";

// The first-time skills (#778): a pilot hole, a countersink and squaring a frame, each drawn in
// full the first time a Build's steps need it, and named with a "how?" tap after, whatever the
// Build. Each from the pieces and sizes of the step that first needs it.

/** A screw's length from its name as shops give it, "5 × 80 screws": 80. */
export const screwLength = (name: string) => Number(/×\s*(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? 0);

/** The piece drilled, its section, the screw by its name and the pilot bit's size, mm. */
export type Pilot = {
  readonly piece: { readonly wide: number; readonly thick: number; readonly name: string };
  readonly screw: string;
  readonly bit: number;
};

/** The pilot hole: the bit over its mark, tape round it at the screw's depth, straight down. */
export const pilotHoleCloseUp = ({ piece, screw, bit }: Pilot): CloseUp => {
  const length = 3 * piece.wide;
  const hole: At3 = { x: length / 2, y: piece.wide / 2, z: piece.thick };
  // The bit drawn thick enough to see, a gap above the wood, as long as the wood is wide.
  const r = Math.max(bit, piece.wide * 0.05);
  const gap = piece.thick * 0.6;
  const shank = box(hole.x - r, hole.y - r, hole.z + gap, 2 * r, 2 * r, piece.wide);
  const tape = box(
    hole.x - 1.4 * r,
    hole.y - 1.4 * r,
    hole.z + gap + piece.wide * 0.55,
    2.8 * r,
    2.8 * r,
    3 * r,
  );
  const deep = screwLength(screw);
  return drawn({
    type: "pilot-hole",
    title: "Drill a pilot hole",
    faces: [
      ...boxFaces(box(0, 0, 0, length, piece.wide, piece.thick), "timber"),
      area(hole.x - r, hole.y - r, 2 * r, 2 * r, hole.z, "drill-first"),
      ...boxFaces(shank, "steel"),
      ...boxFaces(tape, "tape"),
    ],
    strokes: [{ from: hole, to: { ...hole, z: 0 }, look: "path" }],
    pills: [
      {
        says: `${bit} mm bit`,
        to: { x: shank.x, y: shank.y + r, z: shank.z + shank.h * 0.2 },
        badge: 1,
      },
      {
        says: "Tape at depth",
        to: { x: tape.x, y: tape.y + tape.d, z: tape.z + tape.h / 2 },
        badge: 2,
      },
      { says: "Straight down", to: hole, badge: 3 },
    ],
    notes: [
      `A ${bit} mm bit, thinner than the ${deep} mm screw, so its thread still bites.`,
      `Wrap tape round the bit ${deep} mm from its tip. Drill straight down until the tape touches, then drive the screw.`,
    ],
  });
};

/** The piece countersunk, as thick as the sheet, and the screw by its name. */
export type Countersink = {
  readonly piece: { readonly thick: number; readonly name: string };
  readonly screw: string;
};

/** A countersink: the bit's cone over a shallow dip, and the screw's head flush in the next. */
export const countersinkCloseUp = ({ piece }: Countersink): CloseUp => {
  const length = 12 * piece.thick;
  const wide = 6 * piece.thick;
  const top = piece.thick;
  const dip = piece.thick * 0.5;
  const at = (x: number): At3 => ({ x, y: wide / 2, z: top });
  const sunk = at(length / 3);
  const flush = at((2 * length) / 3);
  const cone = top + piece.thick * 0.6;
  return drawn({
    type: "countersink",
    title: "Countersink a screw",
    faces: [
      ...boxFaces(box(0, 0, 0, length, wide, piece.thick), "sheet"),
      area(sunk.x - dip / 2, sunk.y - dip / 2, dip, dip, top, "drill-first"),
      // The bit: its cone pointing down at the hole, its shank above.
      {
        fill: "steel",
        points: [
          { x: sunk.x, y: sunk.y, z: cone },
          { x: sunk.x - dip, y: sunk.y, z: cone + dip * 1.2 },
          { x: sunk.x + dip, y: sunk.y, z: cone + dip * 1.2 },
        ],
      },
      ...boxFaces(
        box(
          sunk.x - dip / 4,
          sunk.y - dip / 4,
          cone + dip * 1.2,
          dip / 2,
          dip / 2,
          3 * piece.thick,
        ),
        "steel",
      ),
      // The next screw's head, flush in its dip.
      area(flush.x - dip / 2, flush.y - dip / 2, dip, dip, top, "steel"),
    ],
    spots: [flush],
    pills: [
      { says: "Countersink bit", to: { ...sunk, z: cone + dip * 2 }, badge: 1 },
      { says: "Shallow dip", to: sunk, badge: 2 },
      { says: "Head flush", to: flush, badge: 3 },
    ],
    notes: [
      `Drill a shallow dip into the ${piece.name} with the countersink bit, about as wide as the screw's head.`,
      "Drive the screw until its head sits flush in the dip, so nothing catches on it.",
    ],
  });
};

/** A frame flat on the floor: its long sides `long` apart end to end, `across` outside to outside. */
export type SquareFrame = {
  readonly long: number;
  readonly across: number;
  readonly wide: number;
  readonly thick: number;
};

/** Squaring a frame: its two diagonals, corner to corner, measured and made the same. */
export const squareFrameCloseUp = ({ long, across, wide, thick }: SquareFrame): CloseUp => {
  const top = 2 * thick;
  const corner = (x: number, y: number): At3 => ({ x, y, z: top });
  return drawn({
    type: "square-frame",
    title: "Square the frame",
    faces: [
      ...boxFaces(box(0, 0, 0, long, wide, thick), "timber"),
      ...boxFaces(box(0, across - wide, 0, long, wide, thick), "timber"),
      ...boxFaces(box(0, 0, thick, wide, across, thick), "timber"),
      ...boxFaces(box(long - wide, 0, thick, wide, across, thick), "timber"),
    ],
    strokes: [
      { from: corner(0, 0), to: corner(long, across), look: "path" },
      { from: corner(long, 0), to: corner(0, across), look: "path" },
    ],
    pills: [
      { says: "Diagonal 1", to: corner(long * 0.7, across * 0.7), badge: 1 },
      { says: "Diagonal 2", to: corner(long * 0.3, across * 0.7), badge: 2 },
      { says: "Same = square", to: corner(long / 2, across / 2) },
    ],
    notes: [
      "Measure corner to corner both ways, outside corner to outside corner. The same within 2 mm means it's square.",
      "Not the same? Push the longer diagonal's corners towards each other, then measure again.",
    ],
  });
};
