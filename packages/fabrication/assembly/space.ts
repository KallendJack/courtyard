import type { Box } from "../build.ts";
import { bracketBoxes, bracketWidth } from "../close-ups/bracket.ts";
import { box } from "../recipe/geometry.ts";

// The whole Build as one (#835): every part and every fixing drawn to its real size keeps its own
// space. A bolt through a castor's plate and its base leaves its washers, its nut and its end on
// the base's top; a leg standing there can't sit flat. So a castor goes a fingernail in from its
// base's end, or along the base until its nuts clear what stands on it; or, where it can't, on
// coach screws up from below, which stay in the wood; or neither, and the clash says why.

/** How far in from its base's end a castor's plate goes when nothing's in the way: a fingernail. */
export const CASTOR_INSET = 10;
/** How far in from a plate's edges its bolt holes are, mm, as the close-ups draw them. */
export const HOLE_INSET = 10;
/** How far a washer's edge stays from what stands beside it, so the leg goes on by eye, mm. */
const CLEAR = 5;
/** How far a castor moves along its base each try, so the step says a round number, mm. */
const STEP = 5;
/** Where two boxes only touch, mm: a face on a face isn't a clash. */
const NEAR = 0.05;
/**
 * The least a screw's point goes into what it grips, in its diameters: EN 1995-1-1's least
 * point-side penetration, as the screw check uses.
 */
const GRIP = 6;
/** How far short of the far face a screw's point stays, so nothing comes through, mm. */
const TIP_IN = 5;
/** Coach screw lengths sold, mm. */
const COACH_LENGTHS = [25, 30, 40, 50, 60, 70, 75, 80, 100] as const;

/** Something that takes up space once it's all built: a part, a castor, or a fixing's end. */
export type Taken = { readonly name: string; readonly boxes: readonly Box[] };

/** A bolt through a plate and a piece of wood: its sizes, and what it passes through. */
export type ThroughBolt = {
  readonly diameter: number;
  readonly length: number;
  readonly washers: number;
  readonly washer: number;
  readonly nut: number;
  /** The plate's thickness, under the wood. */
  readonly plate: number;
};

/** Two that take the same space, by name. */
export type Clash = { readonly what: string; readonly with: string };

/** Whether two boxes share space, more than touching. */
export const overlaps = (a: Box, b: Box) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > NEAR &&
  Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y) > NEAR &&
  Math.min(a.z + a.h, b.z + b.h) - Math.max(a.z, b.z) > NEAR;

/** Everything that takes another's space, each pair once, in the order they're given. */
export const clashesOf = (taken: readonly Taken[]): Clash[] =>
  taken.flatMap((one, at) =>
    taken
      .slice(at + 1)
      .filter((other) => one.boxes.some((a) => other.boxes.some((b) => overlaps(a, b))))
      .map((other) => ({ what: one.name, with: other.name })),
  );

/** A plate's holes, its first `count` corners in the close-ups' order, `HOLE_INSET` in. */
export const holesIn = (plate: Box, count: number) =>
  [
    { x: plate.x + HOLE_INSET, y: plate.y + HOLE_INSET },
    { x: plate.x + plate.w - HOLE_INSET, y: plate.y + plate.d - HOLE_INSET },
    { x: plate.x + plate.w - HOLE_INSET, y: plate.y + HOLE_INSET },
    { x: plate.x + HOLE_INSET, y: plate.y + plate.d - HOLE_INSET },
  ].slice(0, count);

/** A washer's width across: twice its bolt's, as ISO 7089's are near enough. */
export const washerAcross = (bolt: ThroughBolt) => 2 * bolt.diameter;

/**
 * What a plate's bolts leave on its base's top: at each hole, a washer wide, the washers and nut,
 * and the bolt's end past them, whichever stands higher.
 */
export const nutsOn = (plate: Box, base: Box, bolt: ThroughBolt, count: number): Box[] => {
  const across = washerAcross(bolt);
  const stack = bolt.washers * bolt.washer + bolt.nut;
  const end = bolt.length - bolt.plate - base.h;
  const top = base.z + base.h;
  return holesIn(plate, count).map((hole) =>
    box(hole.x - across / 2, hole.y - across / 2, top, across, across, Math.max(stack, end)),
  );
};

/** A box grown by `by` each way across, so what stands within it is too close. */
const grown = (b: Box, by: number): Box => ({
  ...b,
  x: b.x - by,
  y: b.y - by,
  w: b.w + 2 * by,
  d: b.d + 2 * by,
});

/**
 * A castor's plate under its base, `inset` in from one end of it (`from`: 0 the start, 1 the
 * far end), its length along the base and centred across it.
 */
const plateAt = (
  base: Box,
  plate: { length: number; width: number },
  inset: number,
  from: 0 | 1,
) => {
  const alongY = base.d >= base.w;
  const long = alongY ? base.d : base.w;
  const start = from === 0 ? inset : long - inset - plate.length;
  const across = (wide: number) => (wide - plate.width) / 2;
  return alongY
    ? box(base.x + across(base.w), base.y + start, base.z, plate.width, plate.length, 0)
    : box(base.x + start, base.y + across(base.d), base.z, plate.length, plate.width, 0);
};

/** Where the castors under a base go: each plate's footprint, and how far in from its end. */
export type CastorPlaces = {
  readonly insets: readonly [number, number];
  readonly plates: readonly [Box, Box];
};

/**
 * The castors under a base, one at each end: a fingernail in, or moved along the base in round
 * steps until their nuts are clear of everything standing on it; none when they'd meet or pass
 * each other first. The plates' footprints are flat (their height is the castor's to give).
 */
export const castorPlaces = (options: {
  base: Box;
  plate: { readonly length: number; readonly width: number };
  bolt: ThroughBolt;
  count: number;
  /** What stands on the base's top: legs, a box's sides, brackets' arms. */
  standing: readonly Box[];
}): CastorPlaces | undefined => {
  const { base, plate, bolt, count, standing } = options;
  const long = Math.max(base.w, base.d);
  const clear = (at: Box) =>
    nutsOn(at, base, bolt, count).every((nut) =>
      standing.every((other) => !overlaps(grown(nut, CLEAR), other)),
    );
  const insetFrom = (from: 0 | 1) => {
    for (let inset = CASTOR_INSET; 2 * (inset + plate.length) <= long; inset += STEP) {
      if (clear(plateAt(base, plate, inset, from))) return inset;
    }
    return undefined;
  };
  const near = insetFrom(0);
  const far = insetFrom(1);
  if (near === undefined || far === undefined || near + far + 2 * plate.length > long) {
    return undefined;
  }
  return {
    insets: [near, far],
    plates: [plateAt(base, plate, near, 0), plateAt(base, plate, far, 1)],
  };
};

/**
 * Coach screws up through a castor's plate into its base, nothing through its top: the shortest
 * sold whose point grips at least 6 diameters and stays 5 mm in. None when the base is too thin.
 */
export const screwsFromBelow = (options: {
  diameter: number;
  plate: number;
  base: number;
}): number | undefined =>
  COACH_LENGTHS.find((length) => {
    const into = length - options.plate;
    return into >= GRIP * options.diameter && into <= options.base - TIP_IN;
  });

/** The base thickness coach screws of this diameter need, mm. */
export const baseForScrews = (diameter: number) => GRIP * diameter + TIP_IN;

/** How far along its arm a bracket's far screw is, as `bracketModel` puts its holes. */
const FAR_SCREW = 0.75;
/** How far in from the wood's edge a screw stays, mm. */
const EDGE = 5;

/** Whether a bracket's arm has room this long beside a foot: its far screw in the wood. */
export const armFits = (room: number, arm: number) => room >= FAR_SCREW * arm + EDGE;

/**
 * The brackets holding each foot (a leg's, a side's) to the base it stands on, two a foot, as
 * their plates in place: one on its face towards the Build's middle, one on its face towards the
 * base's nearer end, where nothing else stands; or, with no room for its far screw there, towards
 * the other foot. The bases run front to back.
 */
export const footBrackets = (options: {
  feet: readonly Box[];
  bases: readonly Box[];
  middle: { readonly x: number; readonly y: number };
  arm: number;
}): Box[] => {
  const { arm, middle } = options;
  return options.feet.flatMap((foot) => {
    const base = options.bases.find(
      (under) =>
        Math.abs(under.z + under.h - foot.z) < NEAR &&
        overlaps({ ...under, z: 0, h: 1 }, { ...foot, z: 0, h: 1 }),
    );
    const towards = foot.x + foot.w / 2 < middle.x ? 1 : -1;
    const front = foot.y + foot.d / 2 < middle.y;
    const room =
      base === undefined ? 0 : front ? foot.y - base.y : base.y + base.d - foot.y - foot.d;
    // Towards the nearer end where its arm fits, else towards the other foot.
    const out: 1 | -1 = armFits(room, arm) === front ? -1 : 1;
    return [
      ...bracketBoxes({
        at: { x: towards > 0 ? foot.x + foot.w : foot.x, y: foot.y + foot.d / 2, z: foot.z },
        ways: [
          { axis: "z", sign: 1 },
          { axis: "x", sign: towards },
        ],
        along: "y",
        arm,
        width: bracketWidth(arm, foot.d),
      }),
      ...bracketBoxes({
        at: { x: foot.x + foot.w / 2, y: out > 0 ? foot.y + foot.d : foot.y, z: foot.z },
        ways: [
          { axis: "z", sign: 1 },
          { axis: "y", sign: out },
        ],
        along: "x",
        arm,
        width: bracketWidth(arm, foot.w),
      }),
    ];
  });
};
