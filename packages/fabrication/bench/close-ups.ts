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
