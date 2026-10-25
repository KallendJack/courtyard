import { baseCloseUp, CASTOR_INSET } from "./close-ups.ts";
import type { Shape } from "./frame.ts";
import { boltStack, type Castors, castorFixingNames, spannerFor } from "./parameters.ts";
import { act, type Draft } from "./preparing.ts";
import { castorWalk } from "./walk-throughs.ts";

// Fitting the castors to their bases, after the frames, so a spanner still to get doesn't hold up
// the day (#783). Each hole is drilled through the plate's own hole, one at a time, and bolted
// loosely before the next, so the holes can't be off; marking all four first is how they were.

export const castorsDraft = (options: {
  castors: Castors;
  shape: Shape;
  /** The castor bolts' length to use: the parameters', or the length to use when theirs are short. */
  boltLength: number;
}): Draft => {
  const { castors, shape: s } = options;
  const names = castorFixingNames(castors, options.boltLength);
  const size = spannerFor(castors);
  const spanner = size === undefined ? "spanner" : `${size} mm spanner`;
  const socket = size === undefined ? "socket" : `${size} mm socket`;
  const washers = castors.washer.perBolt;
  const stack = boltStack(castors);
  const bites = washers > 0 ? "the washer" : "the nut";
  return {
    id: "fit-castors",
    on: true,
    title: "Fit the castors to the bases",
    minutes: 30,
    parts: ["E"],
    tools: [
      "tape-measure",
      "drill-driver",
      "drill-bits",
      {
        tool: "spanner",
        name: `${size === undefined ? "Spanner" : spanner} × 2 (or spanner + ${socket})`,
      },
    ],
    safety: ["safety-glasses"],
    fixings: [
      { name: names.bolts, count: 4 * castors.boltsEach },
      { name: names.washers, count: 4 * castors.boltsEach * washers },
      { name: names.nuts, count: 4 * castors.boltsEach },
    ],
    actions: [
      act(
        `Lay a base (E) upside down on two offcuts, so the drill can come out underneath. Set a castor on it ${CASTOR_INSET} mm in from one end, centred across it.`,
        `E upside down; castor ${CASTOR_INSET} from the end, centred.`,
      ),
      act(
        `Drill a ${castors.bolt.diameter.value + 1} mm clearance hole straight through the base, through one of the plate's own holes, so the hole lines up with it. If the drill seems to stop, its clutch is slipping: turn the collar behind the chuck to the drill symbol.`,
        `${castors.bolt.diameter.value + 1} mm through one plate hole.`,
      ),
      act(
        `Push a bolt down through ${washers > 1 ? "a washer, " : ""}the plate's hole and the base. Put ${washers > 0 ? "a washer and " : ""}a lock nut on underneath, and start the nut by hand, so the castor can't move.`,
        `${stack.charAt(0).toUpperCase()}${stack.slice(1)}, by hand.`,
      ),
      act(
        `Drill each next hole the same way, through the plate's hole, and bolt it loosely. Then the other castor, ${CASTOR_INSET} mm in from the other end, and the other base.`,
        "Each next hole through the plate, bolted loosely.",
      ),
      act(
        `Tighten each nut: hold the bolt's head still with a ${spanner}, or pliers, and turn the nut with another ${spanner} or a ${socket}. An adjustable spanner works too: wind it snug onto the nut. Stop when ${bites} bites into the wood, then about a quarter turn more. Lock nuts are stiff all the way: that's normal.`,
        `Head held, ${size === undefined ? "spanner" : `${size} mm`} on the nut: ${washers > 0 ? "washer" : "nut"} bites, then ¼ turn.`,
      ),
      act(
        `If a hole is off, widen it sideways with the same bit${washers > 0 ? " (the washer covers it)" : ""}, or turn the plate 90° and drill fresh holes through it.`,
        "Hole off? Widen it sideways, or turn the plate 90°.",
      ),
    ],
    closeUp: baseCloseUp(s, castors),
    walkThrough: castorWalk(s, castors, options.boltLength),
    check: {
      says: "Each castor turns and swivels freely, and every nut is tight.",
      photo: "Both bases from below, castors on.",
    },
    words: ["clearance hole", "lock nut"],
  };
};
