import type { CloseUp, CloseUpFace } from "../close-up.ts";
import { area, box, boxFaces, drawn } from "./drawing.ts";

// Driving a screw (#813; Paper, 2 · Agreed, "Fabrication · Driving a screw: clutch and end zone ·
// Fold (#772)"): the end zone of a piece, where a screw can split it (the pilot rule's 25 mm,
// #789), shaded at each end, a spot in it to drill first and one elsewhere to just screw; and the
// first time a long screw is driven, the clutch ring on the drill driver, from the side.

/** The piece screwed into, its section, and how far from each end the zone runs. */
export type Driving = {
  readonly piece: { readonly wide: number; readonly thick: number; readonly name: string };
  readonly zone: number;
};

export const drivingModel = ({ piece, zone }: Driving) => {
  const length = Math.max(10 * zone, 4 * piece.wide);
  return {
    piece: box(0, 0, 0, length, piece.wide, piece.thick),
    zones: [
      { x: 0, w: zone },
      { x: length - zone, w: zone },
    ],
    drillFirst: { x: zone / 2, y: piece.wide / 2, z: piece.thick },
    justScrew: { x: length / 2, y: piece.wide / 2, z: piece.thick },
  };
};

/** A rectangle on the page, `x`, `y` its top left. */
const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/**
 * A drill driver from the side, its bit to the left, `k` page mm to its mm, its top left at
 * `left`, `top`: the bit, the chuck, the clutch ring behind it, the body, the grip and battery.
 */
const drillFaces = (left: number, top: number, k: number): CloseUpFace[] => {
  const at = (points: { x: number; y: number }[]) =>
    points.map((point) => ({ x: left + point.x * k, y: top + point.y * k }));
  return [
    { fill: "steel", points: at(rect(0, 22, 60, 4)) },
    { fill: "tool", points: at(rect(60, 10, 40, 28)) },
    { fill: "ring", points: at(rect(100, 4, 18, 40)) },
    { fill: "tool", points: at(rect(118, 0, 132, 50)) },
    {
      fill: "tool",
      shade: "side",
      points: at([
        { x: 170, y: 50 },
        { x: 215, y: 50 },
        { x: 225, y: 130 },
        { x: 185, y: 130 },
      ]),
    },
    { fill: "tool", points: at(rect(160, 130, 90, 30)) },
  ];
};

/** The drill's height on the page, in its own mm, and where its clutch ring's top is. */
const DRILL_HIGH = 160;
const RING = { x: 109, y: 4 };

/** The close-up, with the clutch when `clutch`, on the owner's drill driver when it's `yours`. */
export const drivingCloseUp = (driving: Driving & { clutch: boolean; yours: boolean }): CloseUp => {
  const model = drivingModel(driving);
  const { thick, wide } = driving.piece;
  return drawn({
    type: "driving-screw",
    title: "Driving a screw",
    faces: [
      ...boxFaces(model.piece, "timber"),
      ...model.zones.map((zone) => area(zone.x, 0, zone.w, wide, thick, "drill-first")),
      // The far end's cut face, in the zone too.
      {
        fill: "drill-first",
        shade: "end",
        points: [
          { x: model.piece.w, y: 0, z: thick },
          { x: model.piece.w, y: wide, z: thick },
          { x: model.piece.w, y: wide, z: 0 },
          { x: model.piece.w, y: 0, z: 0 },
        ],
      },
    ],
    spots: [model.drillFirst, model.justScrew],
    pills: [
      { says: "Drill first", to: model.drillFirst, tone: "warn" },
      { says: "Just screw", to: model.justScrew, tone: "fine" },
    ],
    notes: [
      `Red: ${driving.zone} mm, 2 fingers, from each cut end. A screw there can split it: drill a pilot hole first.`,
      ...(driving.clutch
        ? [
            `The clutch is the ring with numbers behind the bit, on ${driving.yours ? "your" : "a"} drill driver. Clicks and stops? Turn it to a higher number, or the drill picture.`,
          ]
        : []),
    ],
    ...(driving.clutch
      ? {
          extra: ({ left, top, right }) => {
            const k = (right - left) / 400;
            const above = top - (DRILL_HIGH + 30) * k;
            return {
              faces: drillFaces(left, above, k),
              pills: [{ says: "Clutch ring", to: { x: left + RING.x * k, y: above + RING.y * k } }],
            };
          },
        }
      : {}),
  });
};
