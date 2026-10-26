import type { Box } from "../build.ts";
import type { CloseUp } from "../close-up.ts";
import { type At3, box, boxFaces, drawn, type Stroke3 } from "./drawing.ts";

// An angle bracket in a corner (#813; Paper, 2 · Agreed, "Fabrication · Bracket close-up, any
// build · Fold (#772)"): the L pulled out of the corner it goes in, so it's plain which way it
// sits, 2 screws into each piece, their holes marked through the bracket by eye.

/** A steel angle bracket's thickness, mm: a usual one's. */
const STEEL = 2;

/** A bracket's arm from its name, "40 mm angle brackets"; a usual 40 when it doesn't say. */
export const bracketArm = (name: string) => Number(/(\d+)\s*mm/.exec(name)?.[1] ?? 40);

/**
 * A corner a bracket goes in: the piece standing up, the face the bracket sits on `across` wide
 * and the piece `deep` behind it; the piece it stands on, `across` wide and `thick`; and the
 * bracket's arm. Each piece is named as the step names it.
 */
export type Corner = {
  readonly upright: { readonly across: number; readonly deep: number; readonly name: string };
  readonly flat: { readonly across: number; readonly thick: number; readonly name: string };
  readonly arm: number;
};

/** A bracket's width on a face this wide: half its arm, inside the face's edges. */
const widthOn = (arm: number, face: number) => Math.min(arm / 2, face * 0.8);

/**
 * The corner in place: the upright standing on the flat piece, the bracket's plates tight in the
 * corner (up the upright's face, along the flat piece's top), and its 4 holes, 2 in each.
 */
export const bracketModel = (corner: Corner) => {
  const { upright: up, flat: under, arm } = corner;
  const width = widthOn(arm, up.across);
  // Only as much of each piece round the corner as the bracket needs, so it reads at its size:
  // the face it's on and each piece's thickness are their own.
  const height = 2 * arm;
  const deep = Math.min(up.deep, 2 * arm);
  const across = Math.min(under.across, up.across + 1.5 * arm);
  const flat = box(-arm / 2, (up.across - across) / 2, 0, deep + 2.5 * arm, across, under.thick);
  const upright = box(0, 0, under.thick, deep, up.across, height);
  const face = deep;
  const floor = under.thick;
  const side = (up.across - width) / 2;
  const middle = up.across / 2;
  return {
    upright,
    flat,
    plates: [box(face, side, floor, STEEL, width, arm), box(face, side, floor, arm, width, STEEL)],
    holes: [
      ...[0.35, 0.75].map((up) => ({ x: face, y: middle, z: floor + up * arm })),
      ...[0.35, 0.75].map((along) => ({ x: face + along * arm, y: middle, z: floor })),
    ],
  };
};

/** A way along an axis, as a bracket's arm runs from its corner. */
export type Way = { readonly axis: "x" | "y" | "z"; readonly sign: 1 | -1 };

/**
 * A bracket's two plates in a Build's 3D view, in place (#813): from its corner `at`, each arm
 * `arm` long along its way, lying on the face the other arm's way leaves, and centred `along`
 * the corner's line.
 */
export const bracketBoxes = (options: {
  at: At3;
  ways: readonly [Way, Way];
  along: Way["axis"];
  arm: number;
  width: number;
}): Box[] => {
  const { at, ways, along, arm } = options;
  return ways.map((way, index) => {
    const lying = ways[1 - index] as Way;
    const from = { x: at.x, y: at.y, z: at.z };
    const size = { x: 0, y: 0, z: 0 };
    // Along its way, its arm; off the face, its steel; along the corner, its width.
    size[way.axis] = arm;
    if (way.sign < 0) from[way.axis] -= arm;
    size[lying.axis] = STEEL;
    if (lying.sign < 0) from[lying.axis] -= STEEL;
    size[along] = options.width;
    from[along] -= options.width / 2;
    const round = (mm: number) => Math.round(mm * 10) / 10;
    return box(round(from.x), round(from.y), round(from.z), size.x, size.y, size.z);
  });
};

/** A bracket's width on a face, as `bracketModel` sizes it. */
export const bracketWidth = widthOn;

/** Moved `by` out of the corner, towards the eye. */
const out = (at: At3, by: number): At3 => ({ ...at, x: at.x + by, z: at.z + by });
const outBox = (b: Box, by: number): Box => ({ ...b, x: b.x + by, z: b.z + by });

/** A cross on the upright's face (across and up) or the flat piece's top (along and across). */
const crossAt = (at: At3, onFace: boolean, size: number): Stroke3[] =>
  onFace
    ? [
        {
          from: { ...at, y: at.y - size, z: at.z - size },
          to: { ...at, y: at.y + size, z: at.z + size },
          look: "pencil",
        },
        {
          from: { ...at, y: at.y - size, z: at.z + size },
          to: { ...at, y: at.y + size, z: at.z - size },
          look: "pencil",
        },
      ]
    : [
        {
          from: { ...at, x: at.x - size, y: at.y - size },
          to: { ...at, x: at.x + size, y: at.y + size },
          look: "pencil",
        },
        {
          from: { ...at, x: at.x - size, y: at.y + size },
          to: { ...at, x: at.x + size, y: at.y - size },
          look: "pencil",
        },
      ];

/** The bracket pulled out of its corner, its screws further out on the way to their crosses. */
export const bracketCloseUp = (corner: Corner): CloseUp => {
  const model = bracketModel(corner);
  const apart = corner.arm;
  const reach = corner.arm;
  const size = corner.arm * 0.12;
  const face = model.upright.x + model.upright.w;
  const heads = model.holes.map((hole) =>
    hole.x === face
      ? { ...out(hole, apart), x: hole.x + apart + reach }
      : { ...out(hole, apart), z: hole.z + apart + reach },
  );
  const [standing, lying] = model.plates.map((plate) => outBox(plate, apart));
  return drawn({
    type: "bracket",
    title: "One bracket, apart",
    faces: [
      ...boxFaces(model.flat, "timber"),
      ...boxFaces(model.upright, "timber"),
      ...(lying ? boxFaces(lying, "steel") : []),
      ...(standing ? boxFaces(standing, "steel") : []),
    ],
    strokes: [
      ...model.holes.flatMap((hole) => crossAt(hole, hole.x === face, size)),
      ...model.holes.map((hole, at) => ({
        from: heads[at] as At3,
        to: hole,
        look: "path" as const,
      })),
    ],
    spots: heads,
    pills: [
      {
        says: "Tight in corner",
        to: out({ x: face, y: corner.upright.across / 2, z: model.flat.h }, apart),
        badge: 1,
      },
      { says: "Mark the holes", to: model.holes[2] as At3, badge: 2 },
      { says: "2 screws each", to: heads[1] as At3, badge: 3 },
    ],
    labels: [
      { at: { x: 0, y: 0, z: model.upright.z + model.upright.h }, says: corner.upright.name },
      {
        at: { x: model.flat.x + model.flat.w, y: model.flat.y + model.flat.d, z: 0 },
        says: corner.flat.name,
      },
    ],
    notes: [
      "Push the bracket tight into the corner, then mark through its holes.",
      "2 screws into each piece. By eye: no measuring.",
    ],
  });
};
