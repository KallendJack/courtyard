import type { KeptWay } from "../build.ts";
import {
  type BoltThrough,
  boltApartCloseUp,
  type Holder,
  tightenCloseUp,
} from "../close-ups/bolt-through.ts";
import type { SpannerKit, Tool } from "../tools.ts";
import { baseCloseUp, CASTOR_INSET } from "./close-ups.ts";
import type { Shape } from "./frame.ts";
import { type Castors, castorFixingNames, spannerFor } from "./parameters.ts";
import { act, type Draft, type DraftTool } from "./preparing.ts";

// Fitting the castors to their bases, after the frames, so a spanner still to get doesn't hold up
// the day (#783; Paper, 2 · Agreed, "Fabrication · Castors in 3D, your kit · Fold (#783)"). Each
// hole is drilled through the plate's own hole, one at a time, and bolted loosely before the
// next, so the holes can't be off. It opens on four short lines and nothing else (packages/
// fabrication/README.md, "How a step reads"); its two close-ups show tightening and one bolt
// apart. The extras (the drill's clutch, a hole that's off, starting the nut by hand, how tight
// is tight) are its tips (#789).

/** A castor's bolt through its plate and the base, as its close-ups draw it (#813). */
const castorBolt = (castors: Castors, s: Shape): BoltThrough => ({
  bolt: castors.bolt.diameter.value,
  plate: {
    name: "castor",
    length: castors.plate.length.value,
    thick: castors.plate.thickness.value,
    high: s.castor,
  },
  piece: { label: "E", thick: s.wideThick },
  washers: { count: castors.washer.perBolt, thick: castors.washer.thickness.value },
  nut: castors.nut.height.value,
});

/** The castors' bolts, washers and nuts, each a bolt through a plate. */
const castorFixings = (castors: Castors, names: ReturnType<typeof castorFixingNames>) => {
  const bolts = 4 * castors.boltsEach;
  return [
    { name: names.bolts, count: bolts, joint: "bolt-through" as const },
    { name: names.washers, count: bolts * castors.washer.perBolt, joint: "bolt-through" as const },
    { name: names.nuts, count: bolts, joint: "bolt-through" as const },
  ];
};

/** What the castor step's lines are, kept with a step started on them (#783). */
export const CASTOR_LINES = "through-plate";

/** What holds each bolt's head and turns its nut, from the owner's kit, and the step's chips. */
export type CastorTools = {
  /** None when the owner has nothing that will: the chip says what's needed, missing. */
  head: Holder | undefined;
  nut: Holder | undefined;
  chips: DraftTool[];
};

/**
 * The tools that hold a castor bolt's head and turn its nut, from the owner's kit (#783): the
 * nut with a socket, else an adjustable, else a spanner; the head with what's left, a spanner,
 * an adjustable or pliers. One adjustable is one tool, never both. A tool the owner hasn't got is
 * never named as theirs: what's missing is a chip not to hand.
 */
export const castorTools = (kit: SpannerKit, size: number | undefined): CastorTools => {
  const spanner = size === undefined ? "Spanner" : `${size} mm spanner`;
  const socket = size === undefined ? "Socket" : `${size} mm socket`;
  const nut: Holder | undefined = kit.socket
    ? "socket"
    : kit.adjustables > 0
      ? "adjustable"
      : kit.spanners > 0
        ? "open-spanner"
        : undefined;
  const spanners = kit.spanners - (nut === "open-spanner" ? 1 : 0);
  const adjustables = kit.adjustables - (nut === "adjustable" ? 1 : 0);
  const head: Holder | undefined =
    spanners > 0
      ? "open-spanner"
      : adjustables > 0
        ? "adjustable"
        : kit.pliers
          ? "pliers"
          : undefined;
  const named: Readonly<Record<Holder, string>> = {
    "open-spanner": spanner,
    adjustable: "Adjustable spanner",
    socket,
    pliers: `Pliers or ${spanner.toLowerCase()}`,
  };
  const chip = (name: string, toHand: boolean): DraftTool => ({ tool: "spanner", name, toHand });
  if (nut === undefined && head === undefined) {
    return { head, nut, chips: [chip(`${spanner} × 2`, false)] };
  }
  const chips =
    head === nut && head !== undefined
      ? [chip(`${named[head]} × 2`, true)]
      : [
          nut === undefined ? chip(spanner, false) : chip(named[nut], true),
          head === undefined ? chip(`${spanner} or pliers`, false) : chip(named[head], true),
        ];
  return { head, nut, chips };
};

export const castorsDraft = (options: {
  castors: Castors;
  shape: Shape;
  boltLength: number;
  toHand: ReadonlySet<Tool>;
  kit: SpannerKit;
  /** The steps started, and the ways (or lines) they were started with. */
  started: readonly string[];
  kept: readonly KeptWay[];
}): Draft => {
  const { castors, shape: s } = options;
  // Started before its lines were drilled through the plate, it keeps the lines it had.
  const asStarted =
    options.started.includes("fit-castors") &&
    !options.kept.some((way) => way.step === "fit-castors" && way.tool === CASTOR_LINES);
  if (asStarted) return castorsAsStarted(options);
  const names = castorFixingNames(castors, options.boltLength);
  const size = spannerFor(castors);
  const bit = castors.bolt.diameter.value + 1;
  const tools = castorTools(options.kit, size);
  const workmate = options.toHand.has("folding-workbench");
  const drill: DraftTool = {
    // The drill and its bit as one chip; when one's missing, that's the one it stands for.
    tool: options.toHand.has("drill-driver") ? "drill-bits" : "drill-driver",
    name: `Drill, ${bit} mm bit`,
    toHand: options.toHand.has("drill-driver") && options.toHand.has("drill-bits"),
  };
  // The holes after the first two: "Then the other two." for four.
  const rest = castors.boltsEach - 2;
  const then =
    rest === 1 ? " Then the last one." : rest > 1 ? ` Then the other ${NUMBER_WORDS[rest]}.` : "";
  const pliers = tools.head === "pliers";
  const washer = castors.washer.perBolt > 0;
  return {
    id: "fit-castors",
    on: true,
    title: "Fit the castors to the bases",
    minutes: 30,
    parts: ["E"],
    lines: CASTOR_LINES,
    tools: [drill, ...tools.chips],
    bits: [{ mm: bit, for: `the M${castors.bolt.diameter.value} bolts` }],
    safety: ["safety-glasses"],
    fixings: castorFixings(castors, names),
    batch: "One castor at a time, placed by eye: each hole drilled and bolted before the next.",
    actions: [
      act(
        `${workmate ? "Base in the Workmate's jaws." : "Base upside down on two offcuts."} Castor upside down on its end: same gap both sides, a fingernail from the end.`,
        `E ${workmate ? "in the jaws" : "on offcuts"}; castor ${CASTOR_INSET} from the end, centred.`,
      ),
      act(
        `Drill one hole through the plate with the ${bit} mm bit. Bolt it loosely.`,
        `${bit} mm through one plate hole; bolt loosely.`,
      ),
      ...(castors.boltsEach > 1
        ? [
            act(
              `Drill the next hole through the plate. Bolt it.${then}`,
              "Each next hole through the plate; bolt it.",
            ),
          ]
        : []),
      act(
        pliers
          ? "Tighten each: pliers on the head, their handles against the castor. Turn the nut underneath."
          : "Tighten each: spanner on the head, its handle against the castor. Turn the nut underneath.",
        "Head held against the castor; turn the nut.",
      ),
    ],
    tips: [
      "If the drill seems to stop, turn its collar to the drill symbol: the numbers are for driving screws.",
      `A hole that's off? Widen it sideways with the same bit${washer ? " (the washer covers it)" : ""}.`,
      "Start each nut by hand, a few turns, before the spanner.",
      `Tight is when ${washer ? "the washer" : "the nut"} bites into the wood, then about a quarter turn more. A lock nut is stiff all the way.`,
    ],
    closeUps: [
      tightenCloseUp(castorBolt(castors, s), {
        head: tools.head ?? "open-spanner",
        nut: tools.nut ?? "open-spanner",
        size,
        yours: tools.nut !== undefined,
      }),
      boltApartCloseUp(castorBolt(castors, s), size),
    ],
    check: {
      says: "Each castor turns and swivels freely, and every nut is tight.",
      photo: "Both bases from below, castors on.",
    },
    words: ["clearance hole", "lock nut"],
  };
};

/** Counts said as words in a line: "the other two". */
const NUMBER_WORDS = ["", "one", "two", "three", "four", "five", "six"] as const;

/**
 * The castor step as it was before #783 (marking all four holes first), for a Build that started
 * it then: a step started keeps its lines, so its ticks stay on the lines they were ticked on.
 */
const castorsAsStarted = (options: {
  castors: Castors;
  shape: Shape;
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
    bits: [
      { mm: castors.bolt.diameter.value + 1, for: `the M${castors.bolt.diameter.value} bolts` },
    ],
    safety: ["safety-glasses"],
    fixings: castorFixings(castors, names),
    batch: "One castor at a time: mark, drill, bolt, then the next.",
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
    // Its fixing drawn as its type too (#813): a close-up isn't a line, so its ticks stay put.
    closeUps: [
      baseCloseUp(s, castors),
      boltApartCloseUp(castorBolt(castors, s), spannerFor(castors)),
    ],
    check: {
      says: "Each castor turns and swivels freely, and every nut is tight.",
      photo: "Both bases from below, castors on.",
    },
    words: ["clearance hole", "lock nut"],
  };
};
