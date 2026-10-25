import type { CloseUp } from "../build.ts";
import { type Shape, whole } from "./frame.ts";
import type { Castors } from "./parameters.ts";

// Each assembly step's close-up: a flat view of what it makes, its key sizes as dimension lines
// and a dot where each fixing goes. Two screws a joint, one above the other and a little apart
// (staggered), so they don't split the wood along one grain line.

/** A pilot hole's width, mm: a 3 mm bit for the bench's screws. */
export const PILOT = 3;

/** How far a sheet's screw sits in from the end of an edge, mm: two fingers. */
export const SCREW_INSET = 50;
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

/**
 * Two screws through a rail into a leg, on a diagonal across where they overlap: one near the top
 * corner, one near the opposite bottom corner.
 */
const jointScrews = (legX: number, legWidth: number, railY: number, railHeight: number) => [
  { x: legX + legWidth / 3, y: railY + railHeight / 4 },
  { x: legX + (2 * legWidth) / 3, y: railY + (3 * railHeight) / 4 },
];

/**
 * The closest a joint's screw comes to a piece's end, mm: the rail's end over the leg's edge, or
 * the leg's top under the rail's.
 */
export const jointFromEnd = (legWidth: number, railHeight: number) =>
  Math.min(legWidth / 3, railHeight / 4);

/**
 * Where a rail's screws can go (#789): only where it sits on the leg, the strip a leg offcut on
 * the rail's end draws. Two crosses in it, by eye; the strip's width is the one size.
 */
export const screwSpotsCloseUp = (s: Shape): CloseUp => {
  const width = 3 * s.thick;
  return {
    title: "Mark your screw spots",
    width,
    height: s.wide + s.thick,
    pieces: [
      { label: "A", x: 0, y: 0, w: s.thick, h: s.wide + s.thick },
      { label: "C", x: 0, y: 0, w: width, h: s.wide },
    ],
    dimensions: [line(0, s.wide + s.thick / 2, s.thick, s.wide + s.thick / 2)],
    fixings: jointScrews(0, s.thick, 0, s.wide),
    notes: [
      "By eye: anywhere where the rail sits on the leg, a fingertip from the edges.",
      "On a diagonal, so the wood doesn't split, each driven straight down.",
    ],
  };
};

const line = (x1: number, y1: number, x2: number, y2: number) => ({
  from: { x: x1, y: y1 },
  to: { x: x2, y: y2 },
  mm: Math.round(Math.hypot(x2 - x1, y2 - y1) * 10) / 10,
});

/** A castor base from above, with its castors' plates and bolt holes. */
export const baseCloseUp = (s: Shape, castors: Castors): CloseUp => {
  const plateLength = castors.plate.length.value;
  const plateWidth = castors.plate.width.value;
  const inset = 10;
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
      "2 screws a joint, on a diagonal, by eye.",
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
