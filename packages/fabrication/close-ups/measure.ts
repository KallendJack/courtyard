import type { CloseUp } from "../close-up.ts";
import type { SquareKind } from "../tools.ts";
import { type At3, box, boxFaces, crossOn, drawn } from "./drawing.ts";

// Measuring and marking a length (#813; Paper, 2 · Agreed, "Fabrication · Measure and mark a
// length, your kit · Fold (#772)"): the tape hooked over the end, a tick at the step's number, a
// line squared across with the user's own square, and the offcut crossed. Its section is the
// piece's own; its length is drawn short, as only the end and the tick matter.

/** The piece marked, `wide` across its face and `thick`, the number ticked, and the square. */
export type Marking = {
  readonly piece: { readonly wide: number; readonly thick: number; readonly name: string };
  readonly at: number;
  readonly square: SquareKind | undefined;
};

/** A speed square's leg, mm: a usual 7 inch one's. */
const SPEED_SQUARE = 180;

const SQUARE_NAMES: Readonly<Record<SquareKind, string>> = {
  speed: "speed square",
  "l-square": "L-square",
};

export const markModel = ({ piece, square }: Marking) => {
  const { wide, thick } = piece;
  const length = 6 * wide;
  const tick = 0.55 * length;
  const leg = Math.min(wide, SPEED_SQUARE);
  return {
    piece: box(0, 0, 0, length, wide, thick),
    // The tape's blade along the top, and its hook down over the end.
    tape: box(0, 0.08 * wide, thick, tick + 0.15 * length, 0.3 * wide, 1),
    hook: box(-2, 0.08 * wide, thick * 0.7, 2, 0.3 * wide, thick * 0.3 + 1),
    tick: { from: { x: tick, y: 0.4 * wide, z: thick }, to: { x: tick, y: 0.55 * wide, z: thick } },
    line: { from: { x: tick, y: 0, z: thick }, to: { x: tick, y: wide, z: thick } },
    cross: { x: (tick + length) / 2, y: wide / 2, z: thick },
    // The square on the near edge, its blade's edge on the line.
    square:
      square === "speed"
        ? {
            triangle: [
              { x: tick, y: wide, z: thick + 1 },
              { x: tick, y: wide - leg, z: thick + 1 },
              { x: tick + leg, y: wide, z: thick + 1 },
            ],
            boxes: [box(tick, wide, thick - 12, leg, 4, 13)],
          }
        : {
            triangle: [],
            boxes: [
              box(tick, -0.1 * wide, thick, 0.15 * wide, 1.1 * wide, 1.5),
              box(tick, wide, thick * 0.7, 0.9 * wide, 0.12 * wide, thick * 0.3 + 6),
            ],
          },
  };
};

export const markCloseUp = (marking: Marking & { yours: boolean }): CloseUp => {
  const model = markModel(marking);
  const { wide, thick } = marking.piece;
  const hookTop: At3 = { x: -1, y: 0.23 * wide, z: thick };
  return drawn({
    type: "measure-mark",
    title: "Measure and mark a length",
    faces: [
      ...boxFaces(model.piece, "timber"),
      ...boxFaces(model.tape, "tape"),
      ...boxFaces(model.hook, "tape"),
      ...model.square.boxes.flatMap((each) => boxFaces(each, "tool")),
      ...(model.square.triangle.length === 0
        ? []
        : [{ fill: "tool" as const, points: model.square.triangle }]),
    ],
    strokes: [
      { ...model.tick, look: "pencil" },
      { ...model.line, look: "pencil" },
      ...crossOn(model.cross, wide * 0.12),
    ],
    pills: [
      { says: "Hook the end", to: hookTop, badge: 1 },
      { says: `Tick ${marking.at}`, to: model.tick.to, badge: 2 },
      { says: "Square a line", to: { x: model.line.from.x, y: wide * 0.8, z: thick }, badge: 3 },
      { says: "X the offcut", to: model.cross, badge: 4 },
    ],
    notes: [
      `${marking.yours ? "Your" : "A"} tape, pencil and ${marking.square ? SQUARE_NAMES[marking.square] : "square"}.`,
      "Measure from the end you checked is square. The line goes right across, along the square.",
    ],
  });
};
