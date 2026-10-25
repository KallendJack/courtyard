import { baseCloseUp } from "./close-ups.ts";
import type { Shape } from "./frame.ts";
import { type Castors, castorFixingNames } from "./parameters.ts";
import { act, type Draft } from "./preparing.ts";

// Fitting the castors to their bases, the first step after cutting on a bench with castors.

export const castorsDraft = (options: {
  castors: Castors;
  shape: Shape;
  /** The castor bolts' length to use: the parameters', or the length to use when theirs are short. */
  boltLength: number;
}): Draft => {
  const { castors, shape: s } = options;
  const names = castorFixingNames(castors, options.boltLength);
  return {
    id: "fit-castors",
    on: true,
    title: "Fit the castors to the bases",
    minutes: 30,
    parts: ["E"],
    tools: ["tape-measure", "pencil", "drill-driver", "drill-bits", "spanner"],
    safety: ["safety-glasses"],
    fixings: [
      { name: names.bolts, count: 4 * castors.boltsEach },
      { name: names.washers, count: 4 * castors.boltsEach * castors.washer.perBolt },
      { name: names.nuts, count: 4 * castors.boltsEach },
    ],
    actions: [
      act(
        "Set a castor on the base 10 mm in from each end, centred across it, and mark its holes.",
        "10 from each end, centred.",
      ),
      act(
        `Drill a ${castors.bolt.diameter.value + 1} mm clearance hole straight through at each mark.`,
        `${castors.bolt.diameter.value + 1} mm through.`,
      ),
      act(
        "Push each bolt up through a washer, the castor plate and the base, then add a washer and a lock nut, and tighten with the spanner.",
        "Washer, plate, base, washer, nut.",
      ),
    ],
    closeUp: baseCloseUp(s, castors),
    check: {
      says: "Each castor turns and swivels freely, and every nut is tight.",
      photo: "Both bases from below, castors on.",
    },
    words: ["clearance hole", "lock nut"],
  };
};
