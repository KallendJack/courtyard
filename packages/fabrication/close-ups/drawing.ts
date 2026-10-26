import type { Box } from "../build.ts";
import type {
  CloseUp,
  CloseUpAnswers,
  CloseUpFace,
  CloseUpPill,
  CloseUpStroke,
  CloseUpType,
} from "../close-up.ts";

// How a close-up by type is drawn (#813): its pieces in 3D, in mm (`x` along, `y` back, `z` up),
// seen from above one corner, the way the wood lies, then laid flat for the app to draw as it is.
// Its pills sit in a column to the right, each in the order of what it points at, top to bottom,
// so no two leaders cross.

/** A point in a close-up's 3D, mm. */
export type At3 = { readonly x: number; readonly y: number; readonly z: number };
type Point = { readonly x: number; readonly y: number };

const COS = Math.cos(Math.PI / 6);
const tenth = (mm: number) => Math.round(mm * 10) / 10;

/** Where a point lands on the page: right for along, left for back, up for up. */
export const flat = (at: At3): Point => ({ x: (at.x - at.y) * COS, y: (at.x + at.y) / 2 - at.z });

export const box = (x: number, y: number, z: number, w: number, d: number, h: number): Box => ({
  x,
  y,
  z,
  w,
  d,
  h,
});

type Fill = CloseUpFace["fill"];
type Face3 = { points: readonly At3[]; fill: Fill; shade?: NonNullable<CloseUpFace["shade"]> };

/** A box's three faces seen from above its near corner: its top, its far end and its front side. */
export const boxFaces = (b: Box, fill: Fill): Face3[] => {
  const top = b.z + b.h;
  const right = b.x + b.w;
  const near = b.y + b.d;
  return [
    {
      fill,
      points: [
        { x: b.x, y: b.y, z: top },
        { x: right, y: b.y, z: top },
        { x: right, y: near, z: top },
        { x: b.x, y: near, z: top },
      ],
    },
    {
      fill,
      shade: "end",
      points: [
        { x: right, y: b.y, z: top },
        { x: right, y: near, z: top },
        { x: right, y: near, z: b.z },
        { x: right, y: b.y, z: b.z },
      ],
    },
    {
      fill,
      shade: "side",
      points: [
        { x: b.x, y: near, z: top },
        { x: right, y: near, z: top },
        { x: right, y: near, z: b.z },
        { x: b.x, y: near, z: b.z },
      ],
    },
  ];
};

/** A flat area on a top (a zone, the green): four corners at height `z`. */
export const area = (x: number, y: number, w: number, d: number, z: number, fill: Fill): Face3 => ({
  fill,
  points: [
    { x, y, z },
    { x: x + w, y, z },
    { x: x + w, y: y + d, z },
    { x, y: y + d, z },
  ],
});

/** A pencil cross on a top, `size` each way from its middle. */
export const crossOn = (at: At3, size: number): Stroke3[] => [
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

export type Stroke3 = { from: At3; to: At3; look: CloseUpStroke["look"] };
type Pill3 = { says: string; to: At3; badge?: number; tone?: CloseUpPill["tone"] };

/**
 * A close-up by type from what it draws in 3D: faces far to near, strokes, screw spots and pills;
 * `extra` is drawn flat on the page, placed from where the 3D lands (a drill from
 * the side).
 */
export const drawn = (options: {
  type: CloseUpType;
  title: string;
  faces: readonly Face3[];
  strokes?: readonly Stroke3[];
  spots?: readonly At3[];
  /** Its words, each a pill in the column off the drawing, never on the wood: a piece's name too. */
  pills: readonly Pill3[];
  /**
   * Pieces named on the drawing rather than in a pill (#826, the end frames' board), each from its
   * point in its wood's colour: "rail" past the rail's end.
   */
  names?: readonly { says: string; at: At3 }[];
  notes: readonly string[];
  /** By eye or measured, and whether to drill first (#826), when it has spots or a mark. */
  answers?: CloseUpAnswers;
  extra?: (place: { left: number; top: number; right: number }) => {
    faces: CloseUpFace[];
    pills: { says: string; to: Point; tone?: CloseUpPill["tone"] }[];
  };
}): CloseUp => {
  const faces = options.faces.map((face) => ({ ...face, points: face.points.map(flat) }));
  const strokes = (options.strokes ?? []).map((stroke) => ({
    look: stroke.look,
    from: flat(stroke.from),
    to: flat(stroke.to),
  }));
  const spots = (options.spots ?? []).map(flat);
  const all = [...faces.flatMap((face) => face.points), ...strokes.flatMap((s) => [s.from, s.to])];
  const left = Math.min(...all.map((point) => point.x));
  const top = Math.min(...all.map((point) => point.y));
  const right = Math.max(...all.map((point) => point.x));
  const extra = options.extra?.({ left, top, right });
  const flatFaces: CloseUpFace[] = [...faces, ...(extra?.faces ?? [])];
  const every = [...all, ...flatFaces.flatMap((face) => face.points)];
  const minX = Math.min(...every.map((point) => point.x));
  const minY = Math.min(...every.map((point) => point.y));
  const wide = Math.max(...every.map((point) => point.x)) - minX;
  const high = Math.max(...every.map((point) => point.y)) - minY;
  // A margin round it, and the pills' column to its right, as wide as the drawing reads them.
  const margin = Math.max(wide, high) * 0.06;
  const at = (point: Point): Point => ({
    x: tenth(point.x - minX + margin),
    y: tenth(point.y - minY + margin),
  });
  const width = wide + 2 * margin;
  const height = high + 2 * margin;
  const column = width + Math.max(width, height) * 0.08;
  const pointed: { says: string; to: Point; badge?: number; tone?: CloseUpPill["tone"] }[] = [
    ...options.pills.map((pill) => ({ ...pill, to: flat(pill.to) })),
    ...(extra?.pills ?? []),
  ]
    .map((pill) => ({ ...pill, to: at(pill.to) }))
    .sort((a, b) => a.to.y - b.to.y);
  const pills: CloseUpPill[] = pointed.map((pill, row) => ({
    x: tenth(column),
    y: tenth((height * (row + 0.5)) / pointed.length),
    says: pill.says,
    to: pill.to,
    ...(pill.badge === undefined ? {} : { badge: pill.badge }),
    ...(pill.tone === undefined ? {} : { tone: pill.tone }),
  }));
  return {
    title: options.title,
    type: options.type,
    // Room for the column: about three-quarters of the drawing again.
    width: tenth(column + Math.max(width, height) * 0.75),
    height: tenth(height),
    pieces: [],
    dimensions: [],
    fixings: spots.map(at),
    notes: options.notes,
    faces: flatFaces.map((face) => ({ ...face, points: face.points.map(at) })),
    strokes: strokes.map((stroke) => ({ ...stroke, from: at(stroke.from), to: at(stroke.to) })),
    pills,
    ...(options.names === undefined
      ? {}
      : {
          labels: options.names.map((name) => ({
            ...at(flat(name.at)),
            says: name.says,
            tone: "wood" as const,
          })),
        }),
    ...(options.answers === undefined ? {} : { answers: options.answers }),
  };
};
