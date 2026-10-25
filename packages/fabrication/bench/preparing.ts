import type { Action, CloseUp, CutPlan, KeptWay, MarkedLength, WalkStep, Way } from "../build.ts";
import { type Capacities, capacityFor, type TooBig, tooBig } from "../capacity.ts";
import type { Word } from "../glossary.ts";
import { TOOL_NAMES, type Tool } from "../tools.ts";
import { markingWalk, type Section } from "./walk-throughs.ts";

// The bench's first steps, before anything is joined: check the stock, mark it and cut it. They
// read the cut plan, and the cutting step reads the tools to hand: a hand saw on a folding
// workbench, or a circular or mitre saw once there is one (#777).

/**
 * A step's tool as the template writes it: the tool, or the tool with what this step calls it
 * ("Drill, 7 mm bit"), and whether it's to hand when the step knows better than the tool's own
 * (pliers holding a bolt's head, #783).
 */
export type DraftTool = Tool | { tool: Tool; name: string; toHand?: boolean };

/** A step as the template writes it, before it's numbered and its tools are checked. */
export type Draft = {
  /** What it does, as a slug: the step's ID, the same whichever steps the Build has. */
  id: string;
  on: boolean;
  title: string;
  minutes: number;
  helper?: boolean;
  parts: readonly string[];
  /** The parts it puts on the Build: its parts, unless it only prepares or checks them. */
  adds?: readonly string[];
  ways?: readonly Way[];
  /** What its lines are, when a step started keeps them (#783). */
  lines?: string;
  tools: readonly DraftTool[];
  /** The bits it drills with, when its tools have drill bits: 3 mm pilots unless it says. */
  bits?: readonly { mm: number; for: string }[];
  safety?: readonly Tool[];
  fixings?: readonly { name: string; count: number }[];
  actions: readonly Action[];
  closeUp?: CloseUp;
  walkThrough?: readonly WalkStep[];
  check: { says: string; photo: string };
  words?: readonly Word[];
};

/** One action: how to do it, for a beginner, and just the numbers. */
export const act = (howTo: string, numbers: string): Action => ({ howTo, numbers });

/** Lengths cut the same way, together, as they're marked: 4 lengths of B 1450 and A 750. */
export const markedLengths = (cutPlan: CutPlan): MarkedLength[] =>
  cutPlan.timber.flatMap((plan) => {
    const groups = new Map<string, MarkedLength>();
    for (const length of plan.lengths) {
      const key = length.cuts.map((cut) => `${cut.label} ${cut.length}`).join(", ");
      const same = groups.get(key);
      groups.set(key, {
        stock: plan.stock,
        stockLength: plan.stockLength,
        count: (same?.count ?? 0) + 1,
        kerf: cutPlan.kerf,
        cuts: length.cuts,
        offcut: length.offcut,
      });
    }
    return [...groups.values()];
  });

/**
 * Where each piece's end is ticked, from the length's square end: each piece's length on from
 * the last, with the saw's cut between.
 */
export const ticksOf = (length: MarkedLength) => {
  let at = 0;
  return length.cuts.map((cut, index) => {
    at += (index === 0 ? 0 : length.kerf) + cut.length;
    return { label: cut.label, length: cut.length, at };
  });
};

/**
 * A shop's cut end is often out of square, and every mark is measured from it: the step a
 * beginner misses.
 */
const squareEnd = act(
  "First check the end is square: hold the square's stock tight against the edge and look along its blade. If there's a gap, square a line 10 mm in and saw off the end, then measure from there.",
  "End square? If not, trim it.",
);

/** One length's marks, in the order they're made: the tape, a tick, the square, the line. */
const marking = (length: MarkedLength): Action => {
  const ticks = ticksOf(length);
  const lengths = length.count === 1 ? "one length" : `${length.count} lengths`;
  const each = ticks.map((tick) => `${tick.label} at ${tick.at}`).join(", ");
  return {
    howTo: `On ${lengths} of ${length.stock}, hook the tape over the end you checked and make a pencil tick at each piece's end: ${each}. Each counts the ${length.kerf} mm kerf the saw takes. Put the square on each tick, its stock against the edge, and draw the line across.`,
    numbers: `${length.count} × ${length.stock}: ticks at ${ticks.map((tick) => tick.at).join(", ")}`,
    length,
  };
};

/**
 * The saws the timber can be cut with, best first: a mitre saw cuts square every time, a circular
 * saw is quicker and straighter than a hand saw. The first to hand is the one in use.
 */
const SAWS = ["mitre-saw", "circular-saw", "hand-saw"] as const satisfies readonly Tool[];
export type Saw = (typeof SAWS)[number];

/** The step that cuts the timber, which the saw in use changes. */
export const CUT_STEP = "cut-timber";

/** The saw the timber is cut with: the one it was started with, else the best to hand. */
export const sawInUse = (toHand: ReadonlySet<Tool>, kept: readonly KeptWay[] = []): Saw => {
  const started = kept.find((way) => way.step === CUT_STEP)?.tool;
  return SAWS.find((saw) => saw === started) ?? SAWS.find((saw) => toHand.has(saw)) ?? "hand-saw";
};

const sawWays = (toHand: ReadonlySet<Tool>, using: Saw): Way[] =>
  // As the board has them: the simplest first.
  [...SAWS].reverse().map((saw) => ({
    tool: saw,
    name: TOOL_NAMES[saw],
    using: saw === using,
    toHand: toHand.has(saw),
  }));

/** Each piece's letter on it as it comes off, whichever saw cut it. */
const labelling = act(
  "As each piece comes off, write its letter on it in pencil, and stand it with the others of its letter.",
  "Letter on each piece.",
);

/**
 * A length held at one end sags at the other as the cut goes through, which pinches the saw and
 * snaps the last of the cut, so the long end rests on something level with where it's held.
 */
const longEnd = (holding: string) =>
  act(
    `Rest the long end on a support as high as ${holding} (a sawhorse, a stool or the stack of timber), so it stays level and can't sag and pinch the saw.`,
    "Long end supported, level.",
  );

const CUTTING: Readonly<
  Record<Saw, Pick<Draft, "safety" | "actions"> & { tools: readonly Tool[] }>
> = {
  "mitre-saw": {
    tools: ["mitre-saw", "long-end-support", "square", "tape-measure", "pencil"],
    safety: ["safety-glasses", "ear-defenders"],
    actions: [
      act(
        "Stand the mitre saw on something flat and solid, and lay the length on its bed, tight against the fence, with the line just past the blade's slot.",
        "On the bed, against the fence.",
      ),
      longEnd("the saw's bed"),
      act(
        "With the saw still, bring the blade down to line its edge up on the waste side of the line. Hold the length to the fence, your hand well clear, cut, and let the blade stop before you lift it.",
        "Mitre saw, waste side, blade stopped before lifting.",
      ),
      labelling,
    ],
  },
  "circular-saw": {
    tools: ["circular-saw", "clamps", "long-end-support", "square", "tape-measure", "pencil"],
    safety: ["safety-glasses", "ear-defenders"],
    actions: [
      act(
        "Clamp the length to the folding workbench, or something as solid, with the line just past its edge.",
        "Clamped down, line just past the edge.",
      ),
      longEnd("what it's clamped to"),
      act(
        "Set the blade about 5 mm deeper than the timber, line it up on the waste side of the line and cut in one steady push, letting the offcut fall clear.",
        "Circular saw, blade 5 mm past the timber, waste side.",
      ),
      labelling,
    ],
  },
  "hand-saw": {
    tools: [
      "hand-saw",
      "folding-workbench",
      "long-end-support",
      "square",
      "tape-measure",
      "pencil",
    ],
    safety: ["safety-glasses"],
    actions: [
      act(
        "Clamp the length in the folding workbench's jaws with the line just past the edge.",
        "In the jaws, line just past the edge.",
      ),
      longEnd("the jaws"),
      act(
        "Saw on the waste side of the line. Near the end of the cut, hold the offcut so it doesn't snap off.",
        "Hand saw, waste side.",
      ),
      labelling,
    ],
  },
};

/** How a saw that takes some of the timber's cuts, but not all, cuts the rest. */
const OTHER_SAW: Readonly<Record<Saw, string>> = {
  "mitre-saw": "Lay each on the mitre saw's bed against the fence, and cut on the waste side.",
  "circular-saw":
    "Clamp each length down with the line just past the edge, set the blade about 5 mm deeper than the timber, and cut on the waste side.",
  "hand-saw":
    "Clamp each length in the folding workbench's jaws with the line just past the edge, and saw on the waste side.",
};

/** "A, B and C". */
const listed = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** Timber cut with another saw than the one in use (#780): its stock, the saw taking it, and why. */
export type HandedOn = { readonly stock: string; readonly saw: Saw; readonly why: TooBig };

/**
 * The timber too big for the saw in use, each stock with the next best saw to hand that takes it
 * (the hand saw takes anything). A cut step started keeps its lines as they were (#777), so none
 * is handed on once it is.
 */
export const handedOn = (options: {
  cutPlan: CutPlan;
  toHand: ReadonlySet<Tool>;
  saw: Saw;
  capacities: Capacities;
  kept: readonly KeptWay[];
  sectionOf: (stock: string) => Section;
}): HandedOn[] => {
  const { saw, toHand, capacities } = options;
  if (options.kept.some((way) => way.step === CUT_STEP)) return [];
  /** Why a stock is too big for a saw, or `null` when it takes it. */
  const tooBigFor = (each: Saw, stock: string) =>
    each === "hand-saw" ? null : tooBig(capacityFor(capacities, each), options.sectionOf(stock));
  return options.cutPlan.timber.flatMap(({ stock }) => {
    const why = tooBigFor(saw, stock);
    if (why === null) return [];
    const other =
      SAWS.slice(SAWS.indexOf(saw) + 1).find(
        (each) => (each === "hand-saw" || toHand.has(each)) && tooBigFor(each, stock) === null,
      ) ?? "hand-saw";
    return [{ stock, saw: other, why }];
  });
};

/**
 * The line saying why a stock goes to another saw (#780): "The 145 castor bases and top support
 * are too wide for your mitre saw: hand saw for these." A saw whose capacity isn't given says
 * what's assumed.
 */
const handedLine = (
  { stock, saw: other, why }: HandedOn,
  options: {
    cutPlan: CutPlan;
    saw: Saw;
    sectionOf: (stock: string) => Section;
    nameOf: (label: string) => string;
  },
): Action => {
  const labels = [
    ...new Set(
      options.cutPlan.timber
        .filter((plan) => plan.stock === stock)
        .flatMap((plan) => plan.lengths.flatMap((length) => length.cuts.map((cut) => cut.label))),
    ),
  ].sort();
  const section = options.sectionOf(stock);
  const names = listed(labels.map((label) => options.nameOf(label).toLowerCase()));
  const these =
    why.way === "wide"
      ? `${Math.round(section.wide)} ${names}`
      : `${Math.round(section.thick)} mm thick ${names}`;
  const yours = TOOL_NAMES[options.saw].toLowerCase();
  const using = TOOL_NAMES[other].toLowerCase();
  const isAssumed = why.limit.source.kind === "assumed";
  const line = isAssumed
    ? `Your ${yours}'s cutting capacity isn't known, so it's assumed to cut ${why.limit.value} mm ${why.way}: ${using} for the ${these}. Say what it cuts at 90°, from its label, to check.`
    : `The ${these} are too ${why.way} for your ${yours}: ${using} for these.`;
  return act(
    `${line} ${OTHER_SAW[other]}`,
    `${labels.join(", ")}: ${using}${isAssumed ? " (capacity assumed)" : `, too ${why.way}`}.`,
  );
};

/** The tools of the saw in use, then those of any saw it hands cuts on to, each once. */
const sawTools = (saw: Saw, others: readonly Saw[]) => [
  ...new Set([saw, ...others].flatMap((each) => CUTTING[each].tools)),
];

/** The safety kit of the saw in use and of any saw it hands cuts on to, each once. */
const sawSafety = (saw: Saw, others: readonly Saw[]) => [
  ...new Set([saw, ...others].flatMap((each) => CUTTING[each].safety ?? [])),
];

/** The steps before anything is joined, the timber cut with `saw`. */
export const preparingSteps = (options: {
  cutPlan: CutPlan;
  toHand: ReadonlySet<Tool>;
  saw: Saw;
  /** The timber too big for `saw`, with the saw that cuts it instead (#780). */
  handed: readonly HandedOn[];
  /** A timber's section, by its stock's name, for the marking close-ups. */
  sectionOf: (stock: string) => Section;
  /** A part's name, by its label. */
  nameOf: (label: string) => string;
}): Draft[] => {
  const { cutPlan, toHand, saw, handed } = options;
  const others = handed.map((each) => each.saw);
  const cutting = CUTTING[saw];
  const marked = markedLengths(cutPlan);
  const first = marked[0];
  const timberLabels = [
    ...new Set(
      cutPlan.timber.flatMap((plan) =>
        plan.lengths.flatMap((length) => length.cuts.map((cut) => cut.label)),
      ),
    ),
  ].sort();
  const sheetPieces = cutPlan.sheets.flatMap((plan) =>
    plan.sheets.flatMap((sheet) =>
      sheet.pieces.map((piece) => `${piece.label} ${piece.along} × ${piece.across}`),
    ),
  );
  return [
    {
      id: "check-delivery",
      on: true,
      title: "Check what's arrived",
      minutes: 10,
      parts: [],
      adds: [],
      tools: ["tape-measure"],
      actions: [
        ...cutPlan.timber.map((plan) =>
          act(
            `Count the ${plan.stock}: you need ${plan.lengths.length} lengths of ${plan.stockLength}. Check none is badly bent or split.`,
            `${plan.stock} × ${plan.lengths.length}`,
          ),
        ),
        ...(sheetPieces.length === 0
          ? []
          : [
              act(
                `Have the shop cut the sheet to the cut plan, then measure each piece: ${sheetPieces.join(", ")}.`,
                sheetPieces.join(" · "),
              ),
            ]),
      ],
      check: {
        says: "Everything on the buy list is here.",
        photo: "Everything laid out on the floor.",
      },
    },
    {
      id: "mark-lengths",
      on: true,
      title: "Mark the lengths",
      minutes: 20,
      parts: timberLabels,
      adds: [],
      tools: ["tape-measure", "pencil", "square"],
      actions: [squareEnd, ...marked.map(marking)],
      walkThrough: first === undefined ? [] : markingWalk(first, options.sectionOf(first.stock)),
      check: {
        says: "Every line square across the face, each length's pieces marked from one end.",
        photo: "One marked length, close up.",
      },
      words: ["kerf", "square"],
    },
    {
      id: "cut-timber",
      on: true,
      title: "Cut and label the timber",
      minutes: 40,
      parts: timberLabels,
      adds: [],
      ways: sawWays(toHand, saw),
      tools: sawTools(saw, others),
      safety: sawSafety(saw, others),
      // The cuts handed on go before the labelling, which every piece gets.
      actions: [
        ...cutting.actions.slice(0, -1),
        ...handed.map((each) => handedLine(each, options)),
        ...cutting.actions.slice(-1),
      ],
      check: {
        says: "Each piece within 1 mm of its length, and its letter on it.",
        photo: "The pieces in rows by letter.",
      },
      words: ["waste side", "offcut"],
    },
  ];
};
