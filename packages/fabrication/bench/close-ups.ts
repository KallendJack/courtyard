import type { CloseUp, MarkedLength, WalkStep } from "../build.ts";
import type { Technique } from "../close-ups/techniques.ts";
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

/**
 * How a leg lies for the end frames, seen from its end (#826; Paper, 2 · Agreed, "Fabrication ·
 * End frames in 3D, your kit · Fold (#785, #788)"): on its edge, tall and thin, like this; not
 * flat, struck through.
 */
export const legEndOnCloseUp = (s: Shape): CloseUp => {
  const gap = s.wide;
  const flatX = s.thick + gap;
  const flatY = s.wide - s.thick;
  return {
    title: "Leg end on",
    width: flatX + s.wide,
    height: s.wide + 40,
    pieces: [
      { label: "", x: 0, y: 0, w: s.thick, h: s.wide },
      { label: "", x: flatX, y: flatY, w: s.wide, h: s.thick },
    ],
    dimensions: [],
    fixings: [],
    notes: ["Each leg on its edge, tall and thin, so the rails lie across its narrow face."],
    labels: [
      { x: 0, y: s.wide + 25, says: "like this", key: true },
      { x: flatX, y: s.wide + 25, says: "not flat" },
    ],
    strokes: [{ from: { x: flatX, y: s.wide }, to: { x: flatX + s.wide, y: flatY }, look: "edge" }],
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

// What "show me how" walks through the first time a step needs a move a beginner may never have
// made (#777): marking a length, in the order it's done, and marking a joint's screw spots
// (#789). The moves are drawn by the close-ups' types (#813): measure and mark, a screwed overlap.

/** A length's section as it lies flat: how wide its face is, and how thick. */
export type Section = { readonly wide: number; readonly thick: number };

/** Marking the first length's first piece, as measure and mark draws it (#813). */
export const markingTechnique = (
  length: MarkedLength | undefined,
  sectionOf: (stock: string) => Section,
): Technique[] => {
  const first = length?.cuts[0];
  if (length === undefined || first === undefined) return [];
  const piece = { ...sectionOf(length.stock), name: first.label };
  return [{ type: "measure-mark", piece, at: first.length }];
};

/** Marking a length, as the first is marked: the tape, a tick, the square, the line. */
export const markingWalk = (length: MarkedLength | undefined): WalkStep[] => {
  const first = length?.cuts[0];
  if (first === undefined) return [];
  return [
    {
      title: "Tape",
      says: "Hook the tape over the end you checked and pull it straight along one edge.",
      closeUp: null,
    },
    {
      title: "Tick",
      says: `At ${first.length}, make a small V in pencil, its point on the mark: a dot gets lost, a V points.`,
      closeUp: null,
    },
    {
      title: "Square",
      says: "Put the square's stock tight against the edge, and slide it until its blade touches the V's point.",
      closeUp: null,
    },
    {
      title: "Line",
      says: "Hold the square still and draw along its blade, right across the face: that's the line you cut to.",
      closeUp: null,
    },
  ];
};

/**
 * Marking a joint's screw spots, the first time a rail is screwed to a leg (#789): no tape, as the
 * screws only have to hit the leg hidden under the rail. An offcut draws where it is.
 */
export const screwSpotsWalk = (): WalkStep[] => [
  {
    title: "The leg's edge",
    says: "Lay an offcut of leg timber on the rail's end, flush with it, and draw along its inside edge. The strip it covered is where the leg is underneath.",
    closeUp: null,
  },
  {
    title: "Two crosses",
    says: "Draw 2 pencil crosses in the strip, on a diagonal: one near the top corner, one near the opposite bottom corner.",
    closeUp: null,
  },
  {
    title: "A fingertip in",
    says: "By eye: each cross about a fingertip from the strip's edges. It only has to hit the leg, and the diagonal keeps the wood from splitting.",
    closeUp: null,
  },
];
