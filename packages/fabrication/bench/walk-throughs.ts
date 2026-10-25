import type { MarkedLength, WalkStep } from "../build.ts";
import {
  type Holder,
  PILOT,
  pilotCloseUp,
  plateDrillCloseUp,
  squareStockCloseUp,
  tapeHookCloseUp,
  tightenCloseUp,
} from "./close-ups.ts";
import type { Shape } from "./frame.ts";
import type { Castors } from "./parameters.ts";

// What "show me how" walks through the first time a step needs a move a beginner may never have
// made (#777): marking a length, in the order it's done, and how deep a pilot hole goes. Each
// with its close-up where one shows the move, from the Build's own numbers.

/** A length's section as it lies flat: how wide its face is, and how thick. */
export type Section = { readonly wide: number; readonly thick: number };

/** Marking a length, as the first is marked: the tape, a tick, the square, the line. */
export const markingWalk = (length: MarkedLength | undefined, section: Section): WalkStep[] => {
  const first = length?.cuts[0];
  if (first === undefined) return [];
  return [
    {
      title: "Tape",
      says: "Hook the tape over the end you checked and pull it straight along one edge.",
      closeUp: tapeHookCloseUp(first.label, section.thick),
    },
    {
      title: "Tick",
      says: `At ${first.length}, make a small V in pencil, its point on the mark: a dot gets lost, a V points.`,
      closeUp: null,
    },
    {
      title: "Square",
      says: "Put the square's stock tight against the edge, and slide it until its blade touches the V's point.",
      closeUp: squareStockCloseUp(first.label, section.wide),
    },
    {
      title: "Line",
      says: "Hold the square still and draw along its blade, right across the face: that's the line you cut to.",
      closeUp: null,
    },
  ];
};

/** A screw's length from its name as shops give it, "5 × 80 screws"; none when it doesn't say. */
export const screwLength = (name: string): number | undefined => {
  const [, length] = /×\s*(\d+(?:\.\d+)?)/.exec(name) ?? [];
  return length === undefined ? undefined : Number(length);
};

/** How deep a pilot hole goes, the first time the steps drill one: as long as the screw. */
export const pilotWalk = (s: Shape, screws: string): WalkStep[] => {
  const depth = screwLength(screws);
  return [
    {
      title: "Pilot holes",
      says:
        depth === undefined
          ? `Drill each pilot hole with the ${PILOT} mm bit, as deep as a screw is long, so the screw doesn't split the wood.`
          : `Wrap a strip of tape round the ${PILOT} mm bit ${depth} mm from its tip, a screw's length, and stop drilling when the tape reaches the wood. A pilot hole stops the screw splitting the wood.`,
      closeUp: depth === undefined ? null : pilotCloseUp(s, depth),
    },
  ];
};

/**
 * Fitting a castor (#783): each hole drilled through the plate's own, so it can't be off, and
 * each bolt tightened with its head held, so it doesn't spin. What the step's four lines leave
 * out is here: the drill's clutch, a hole that's off, starting the nut by hand and how tight.
 */
export const castorWalk = (
  s: Shape,
  castors: Castors,
  hold: { head: Holder | undefined; nut: Holder | undefined; size: number | undefined },
): WalkStep[] => {
  const { size } = hold;
  const spanner = size === undefined ? "a spanner" : `a ${size} mm spanner`;
  const holding: Readonly<Record<Holder, string>> = {
    "open-spanner": `${spanner}, its handle`,
    adjustable: "the adjustable spanner, its handle",
    pliers: "the pliers, their handles",
    socket: "the socket, its handle",
  };
  const turning: Readonly<Record<Holder, string>> = {
    "open-spanner": spanner,
    adjustable: "the adjustable spanner, wound snug onto it",
    pliers: "the pliers",
    socket: size === undefined ? "a socket" : `a ${size} mm socket`,
  };
  const bites = castors.washer.perBolt > 0 ? "the washer" : "the nut";
  const sized = [hold.head, hold.nut].some((one) => one === "open-spanner" || one === "socket");
  const stamped =
    size !== undefined && sized ? [`A spanner's size is stamped on it: look for ${size}.`] : [];
  return [
    {
      title: "Drill through the plate",
      says: [
        "Drill through one of the plate's own holes, then bolt it loosely before the next, so every hole lines up with the plate.",
        "If the drill seems to stop, its clutch is slipping: turn the collar behind the chuck to the drill symbol.",
        `If a hole is off, widen it sideways with the same bit${castors.washer.perBolt > 0 ? " (the washer covers it)" : ""}, or turn the plate 90° and drill fresh holes through it.`,
      ].join(" "),
      closeUp: plateDrillCloseUp(s, castors),
    },
    {
      title: "Tighten",
      says: [
        "Start each nut by hand.",
        `Hold the head with ${holding[hold.head ?? "open-spanner"]} resting against the castor, so it can't spin, and turn the nut underneath with ${turning[hold.nut ?? "open-spanner"]}.`,
        `Stop when ${bites} bites into the wood, then about a quarter turn more. Lock nuts are stiff all the way: that's normal.`,
        ...stamped,
      ].join(" "),
      closeUp: tightenCloseUp(castors, {
        head: hold.head ?? "open-spanner",
        nut: hold.nut ?? "open-spanner",
        size,
        notes: [
          "Start the nut by hand.",
          `Stop when ${bites} bites, then a quarter turn.`,
          ...(size !== undefined && sized ? [`Look for ${size} stamped on it.`] : []),
        ],
      }),
    },
  ];
};
