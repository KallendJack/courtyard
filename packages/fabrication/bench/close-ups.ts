import type { CloseUp } from "../build.ts";
import { type Shape, whole } from "./frame.ts";
import type { Castors } from "./parameters.ts";

// Each assembly step's close-up: a flat view of what it makes, its key sizes as dimension lines
// and a dot where each fixing goes. Two screws a joint, one above the other and a little apart
// (staggered), so they don't split the wood along one grain line.

/** How far a screw sits in from the end of a piece, mm. */
const SCREW_INSET = 50;
/** The most a sheet's screws are apart along an edge, mm. */
const SCREW_EVERY = 300;

/** How many screws hold a sheet along an edge this long: at least two. */
export const screwsAlong = (length: number) => Math.max(2, Math.floor(length / SCREW_EVERY) + 1);

/** Where those screws go along the edge, from its start. */
const screwPlaces = (length: number) => {
  const count = screwsAlong(length);
  const span = length - 2 * SCREW_INSET;
  return Array.from({ length: count }, (_, at) => SCREW_INSET + (span * at) / (count - 1));
};

/** Two screws through a rail into a leg, staggered across the joint. */
const jointScrews = (legX: number, legWidth: number, railY: number, railHeight: number) => [
  { x: legX + legWidth / 3, y: railY + railHeight / 4 },
  { x: legX + (2 * legWidth) / 3, y: railY + (3 * railHeight) / 4 },
];

const line = (x1: number, y1: number, x2: number, y2: number) => ({
  from: { x: x1, y: y1 },
  to: { x: x2, y: y2 },
  mm: Math.round(Math.hypot(x2 - x1, y2 - y1) * 10) / 10,
});

/** How far in from each end of its base a castor sits, mm. */
export const CASTOR_INSET = 10;

/** A castor base from above, with its castors' plates and bolt holes. */
export const baseCloseUp = (s: Shape, castors: Castors): CloseUp => {
  const plateLength = castors.plate.length.value;
  const plateWidth = castors.plate.width.value;
  const inset = CASTOR_INSET;
  const plateY = (s.wideWidth - plateWidth) / 2;
  const plates = [inset, s.frameDepth - inset - plateLength];
  const corner = 10;
  const bolts = castors.boltsEach;
  return {
    title: "One castor base, from below",
    width: s.frameDepth,
    height: s.wideWidth,
    pieces: [
      { label: "E", x: 0, y: 0, w: s.frameDepth, h: s.wideWidth },
      ...plates.map((x) => ({ label: "castor", x, y: plateY, w: plateLength, h: plateWidth })),
    ],
    dimensions: [line(0, 0, s.frameDepth, 0), line(0, s.wideWidth, inset, s.wideWidth)],
    fixings: plates.flatMap((x) =>
      [
        { x: x + corner, y: plateY + corner },
        { x: x + plateLength - corner, y: plateY + plateWidth - corner },
        { x: x + plateLength - corner, y: plateY + corner },
        { x: x + corner, y: plateY + plateWidth - corner },
      ].slice(0, bolts),
    ),
    notes: [`A castor ${inset} mm in from each end, centred across the base.`],
  };
};

/** One end frame, laid flat as it's built: its legs, and the end rails across them. */
export const endFrameCloseUp = (s: Shape): CloseUp => {
  const lowerY = s.leg - s.shelfHeight - s.wide;
  const legs = [0, s.endRail - s.thick];
  return {
    title: "One end frame",
    width: s.endRail,
    height: s.leg,
    pieces: [
      ...legs.map((x) => ({ label: "A", x, y: 0, w: s.thick, h: s.leg })),
      { label: "C", x: 0, y: 0, w: s.endRail, h: s.wide },
      { label: "C", x: 0, y: lowerY, w: s.endRail, h: s.wide },
    ],
    dimensions: [
      line(0, 0, s.endRail, 0),
      line(0, 0, 0, s.leg),
      line(s.endRail, lowerY + s.wide, s.endRail, s.leg),
    ],
    fixings: legs.flatMap((x) => [
      ...jointScrews(x, s.thick, 0, s.wide),
      ...jointScrews(x, s.thick, lowerY, s.wide),
    ]),
    notes: [
      "Top rail flush with the leg tops.",
      `Bottom rail ${whole(s.shelfHeight)} up from the floor end.`,
      "2 screws a joint, one above the other.",
    ],
  };
};

/** A long side: the end frames' legs, and the long rails joining them. */
export const longSideCloseUp = (s: Shape): CloseUp => {
  const lowerY = s.leg - s.shelfHeight - s.wide;
  const legs = [0, s.frameLength - s.wide];
  return {
    title: "The front, the long rails on",
    width: s.frameLength,
    height: s.leg,
    pieces: [
      ...legs.map((x) => ({ label: "A", x, y: 0, w: s.wide, h: s.leg })),
      { label: "B", x: 0, y: 0, w: s.frameLength, h: s.wide },
      { label: "B", x: 0, y: lowerY, w: s.frameLength, h: s.wide },
    ],
    dimensions: [
      line(0, 0, s.frameLength, 0),
      line(s.wide + s.thick, s.leg / 2, s.frameLength - s.wide - s.thick, s.leg / 2),
    ],
    fixings: legs.flatMap((x) => [
      ...jointScrews(x, s.wide, 0, s.wide),
      ...jointScrews(x, s.wide, lowerY, s.wide),
    ]),
    notes: [
      "Rails flush with the frame's ends and the leg tops.",
      `${whole(s.between)} between the end frames.`,
    ],
  };
};

/** A sheet from above, with its screws along each edge it rests on. */
export const sheetCloseUp = (options: {
  title: string;
  label: string;
  length: number;
  width: number;
  /** The edges it's screwed along, as lines across the sheet: along its length, or across it. */
  along: readonly number[];
  across: readonly number[];
  note: string;
}): CloseUp => ({
  title: options.title,
  width: options.length,
  height: options.width,
  pieces: [{ label: options.label, x: 0, y: 0, w: options.length, h: options.width }],
  dimensions: [line(0, 0, options.length, 0), line(0, 0, 0, options.width)],
  fixings: [
    ...options.along.flatMap((y) => screwPlaces(options.length).map((x) => ({ x, y }))),
    ...options.across.flatMap((x) => screwPlaces(options.width).map((y) => ({ x, y }))),
  ],
  notes: [options.note],
});

/** A brace panel on the end frame's outside, screwed to the legs. */
export const braceCloseUp = (s: Shape): CloseUp => ({
  title: "One end brace, from outside",
  width: s.endRail,
  height: s.braceHeight,
  pieces: [{ label: "J", x: 0, y: 0, w: s.endRail, h: s.braceHeight }],
  dimensions: [line(0, 0, s.endRail, 0), line(0, 0, 0, s.braceHeight)],
  fixings: [s.thick / 2, s.endRail - s.thick / 2].flatMap((x) => [
    { x, y: SCREW_INSET },
    { x, y: s.braceHeight - SCREW_INSET },
  ]),
  notes: ["Top edge flush with the leg tops, bottom edge with the lower rails' undersides."],
});

export const SHEET_SCREWS_PER_BRACE = 4;

// The moves a beginner may never have made (#777), each drawn close: the tape's hook over the
// length's end, and the square's stock against its edge. The tools are only pictures, their
// sizes a usual tape's and square's; every size marked is the Build's own.

/** How much of a length a marking close-up shows, either side of what it's about. */
const NEAR = 150;
/** Room above and below a length, for the tool on it. */
const ROOM = 30;

/** The tape hooked over the length's square end, from the side: the hook is the tape's 0. */
export const tapeHookCloseUp = (label: string, thick: number): CloseUp => ({
  title: "The tape's hook over the end",
  width: NEAR,
  height: thick + 2 * ROOM,
  pieces: [
    { label, x: 0, y: ROOM, w: NEAR, h: thick },
    // The tape's blade along the top, and its hook down over the end.
    { label: "tape", x: -3, y: ROOM - 4, w: NEAR + 3, h: 4 },
    { label: "tape", x: -3, y: ROOM - 4, w: 3, h: 16 },
  ],
  dimensions: [line(0, ROOM + thick, 100, ROOM + thick)],
  fixings: [],
  notes: [
    "The hook is the tape's 0: hook it tight over the end you checked.",
    "Pull the tape straight along one edge, not across the face.",
  ],
});

/** The square at a tick, from above: its stock tight on the edge, its blade across the face. */
export const squareStockCloseUp = (label: string, wide: number): CloseUp => ({
  title: "The square's stock against the edge",
  width: 2 * NEAR,
  height: wide + 2 * ROOM,
  pieces: [
    { label, x: 0, y: ROOM, w: 2 * NEAR, h: wide },
    // The stock along the near edge, off the face, and the blade from it across the face.
    { label: "square", x: NEAR, y: ROOM - 20, w: NEAR, h: 20 },
    { label: "square", x: NEAR, y: ROOM, w: 25, h: wide + ROOM / 2 },
  ],
  // The line drawn along the blade's edge, right across the face.
  dimensions: [line(NEAR, ROOM, NEAR, ROOM + wide)],
  fixings: [],
  notes: [
    "Hold the stock tight against the edge and slide it until the blade touches the tick.",
    `Draw along the blade, right across the ${whole(wide)} mm face.`,
  ],
});

/** How much of a drill bit shows above the wood, in a pilot hole's close-up. */
const BIT_ABOVE = 40;
/** A pilot hole's width, mm: a 3 mm bit for the frame's screws. */
export const PILOT = 3;

/**
 * A pilot hole drilled through a rail into a leg, from the side: the bit in to `depth`, a mark on
 * it where it meets the wood.
 */
export const pilotCloseUp = (s: Shape, depth: number): CloseUp => {
  const width = 2 * s.wide;
  const bit = width / 2 - PILOT / 2;
  return {
    title: "A pilot hole's depth",
    width,
    height: BIT_ABOVE + s.thick + s.wide,
    pieces: [
      { label: "C", x: 0, y: BIT_ABOVE, w: width, h: s.thick },
      { label: "A", x: 0, y: BIT_ABOVE + s.thick, w: width, h: s.wide },
      { label: "bit", x: bit, y: 0, w: PILOT, h: BIT_ABOVE + depth },
      // The depth mark: a strip of tape round the bit, at the wood once it's deep enough.
      { label: "bit", x: bit - 6, y: BIT_ABOVE - 6, w: PILOT + 12, h: 6 },
    ],
    dimensions: [line(width - 10, BIT_ABOVE, width - 10, BIT_ABOVE + depth)],
    fixings: [],
    notes: [
      `Mark the bit ${whole(depth)} mm from its tip, as long as the screw.`,
      "Stop drilling when the mark reaches the wood.",
    ],
  };
};

// Fitting a castor (#783): the hole drilled through the plate's own, the bolt's head held while
// its nut is turned, and one bolt taken apart, so it's plain which side each piece goes. The
// tools are only pictures, drawn as their shape; the plate, base, bolt, washer and nut are the
// Build's own.

/** How much of the base shows either side of a castor's plate, from the side. */
const BESIDE = 40;
/** A bolt head's height, as drawn. */
const HEAD = 4;

/** The base upside down, a castor's plate on it and the bit through the plate's hole, from the side. */
export const plateDrillCloseUp = (s: Shape, castors: Castors): CloseUp => {
  const plate = castors.plate.thickness.value;
  const plateLength = castors.plate.length.value;
  const hole = castors.bolt.diameter.value + 1;
  const width = plateLength + 2 * BESIDE;
  const below = BIT_ABOVE + plate + s.wideThick;
  return {
    title: "Drilling through the plate's hole",
    width,
    height: below + ROOM,
    pieces: [
      { label: "castor", x: BESIDE, y: BIT_ABOVE, w: plateLength, h: plate },
      { label: "E", x: 0, y: BIT_ABOVE + plate, w: width, h: s.wideThick },
      // The bit in the plate's first hole, out through the base below.
      { label: "bit", x: BESIDE + 10 - hole / 2, y: 0, w: hole, h: below + ROOM / 2 },
    ],
    dimensions: [line(width - 10, BIT_ABOVE, width - 10, below)],
    fixings: [],
    notes: [
      `A ${hole} mm bit, straight down through the plate's own hole and the base.`,
      "One hole, then its bolt, loosely, then the next.",
    ],
  };
};

/** What holds a bolt's head or turns its nut, as the close-ups draw it. */
export type Holder = "open-spanner" | "adjustable" | "pliers" | "socket";

/** How far a spanner's handle reaches from the head to the castor's body, as drawn. */
const REACH = 110;

/**
 * Tightening a castor's bolt, from above and from below (Paper, 2 · Agreed, "Fabrication ·
 * Castors in 3D, your kit · Fold (#783)"): on top, the head held with its tool's handle resting
 * against the castor's body, so it can't spin; underneath, the nut turned clockwise.
 */
export const tightenCloseUp = (
  castors: Castors,
  hold: { head: Holder; nut: Holder; size: number | undefined; notes: readonly string[] },
): CloseUp => {
  const across = hold.size ?? 2 * castors.bolt.diameter.value;
  const x = 24;
  const head = 44;
  const nut = head + 100;
  const body = { x: x + REACH, y: head - 30, w: 50, h: 60 };
  return {
    title: "Tighten",
    width: body.x + body.w + 5,
    height: nut + 40,
    pieces: [{ label: "castor", ...body }],
    dimensions: [],
    fixings: [],
    shapes: [
      { kind: hold.head, x, y: head, jaw: across, length: REACH, turn: 0 },
      { kind: "hex", x, y: head, across },
      { kind: hold.nut, x, y: nut, jaw: across, length: REACH, turn: 0 },
      { kind: "hex", x, y: nut, across },
      { kind: "clockwise", x, y: nut, r: 2 * across },
    ],
    labels: [
      { x: 0, y: 10, says: "On top", heading: true },
      { x: x + 40, y: head + 24, says: "rests on castor" },
      { x: 0, y: nut - 34, says: "Underneath", heading: true },
      { x: x + 40, y: nut + 24, says: "turn the nut" },
    ],
    notes: hold.notes,
  };
};

/** How far apart a bolt's pieces are drawn, taken apart. */
const APART = 10;

/**
 * One castor bolt taken apart, from the side (#783): the castor's side on top (the bolt's head
 * and the plate), then the base, then underneath (the washer and the nut), each named, so it's
 * plain which side the washer and the nut go. The washers are the Build's own: one a bolt goes
 * under the nut, against the wood, and a second under the head.
 */
export const boltApartCloseUp = (s: Shape, castors: Castors, size: number | undefined): CloseUp => {
  const across = size ?? 2 * castors.bolt.diameter.value;
  const bolt = castors.bolt.diameter.value;
  const plate = castors.plate.thickness.value;
  const washer = castors.washer.thickness.value;
  const nut = castors.nut.height.value;
  const washerWidth = 1.8 * across;
  const middle = 60;
  const half = 35;
  const named = middle + half + 10;
  const label = (y: number, says: string) => ({ x: named, y: y + 3, says });

  const headY = 18;
  const topWasher = castors.washer.perBolt > 1 ? headY + HEAD + APART : undefined;
  const plateY = (topWasher === undefined ? headY + HEAD : topWasher + washer) + APART;
  const baseY = plateY + plate + APART;
  const under = baseY + s.wideThick + 14;
  const nutWasher = castors.washer.perBolt > 0 ? under + 6 : undefined;
  const nutY = nutWasher === undefined ? under + 6 : nutWasher + washer + APART;
  const washerAt = (y: number) => ({
    label: "washer",
    x: middle - washerWidth / 2,
    y,
    w: washerWidth,
    h: washer,
  });
  return {
    title: "One bolt, apart",
    width: named + 60,
    height: nutY + nut + 8,
    pieces: [
      // The castor's body stands on its plate, beside the bolt's head.
      { label: "castor", x: middle - half, y: plateY - 24, w: 22, h: 24 },
      { label: "castor", x: middle - half, y: plateY, w: 2 * half, h: plate },
      { label: "E", x: middle - half, y: baseY, w: 2 * half, h: s.wideThick },
      // The bolt's shank, through the plate and the base, to past the nut.
      { label: "bolt", x: middle - bolt / 2, y: headY + HEAD, w: bolt, h: nutY + nut + 3 - headY },
      { label: "bolt", x: middle - across / 2, y: headY, w: across, h: HEAD },
      ...(topWasher === undefined ? [] : [washerAt(topWasher)]),
      ...(nutWasher === undefined ? [] : [washerAt(nutWasher)]),
      { label: "nut", x: middle - across / 2, y: nutY, w: across, h: nut },
    ],
    dimensions: [],
    fixings: [],
    labels: [
      { x: 0, y: 9, says: "Top · castor side", heading: true },
      label(headY, "bolt head"),
      ...(topWasher === undefined ? [] : [label(topWasher, "washer")]),
      label(plateY, "plate"),
      label(baseY + s.wideThick / 2, "base"),
      { x: 0, y: under, says: "Underneath", heading: true },
      ...(nutWasher === undefined ? [] : [label(nutWasher, "washer")]),
      label(nutY + nut / 2, "nut"),
    ],
    notes: [
      castors.washer.perBolt === 0
        ? "No washers: the nut goes on against the wood."
        : castors.washer.perBolt === 1
          ? "The washer only under the nut, against the wood."
          : "A washer under the head, and one under the nut, against the wood.",
    ],
  };
};
