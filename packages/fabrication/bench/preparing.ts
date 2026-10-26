import type { Action, CloseUp, CutPlan, KeptWay, MarkedLength, WalkStep, Way } from "../build.ts";
import { type Capacities, capacityFor, type TooBig, tooBig } from "../capacity.ts";
import type { FixingType } from "../close-up.ts";
import type { Technique } from "../close-ups/techniques.ts";
import { markedLengths } from "../cut-plan.ts";
import type { Word } from "../glossary.ts";
import { TOOL_NAMES, type Tool } from "../tools.ts";
import { markingTechnique, markingWalk, type Section } from "./close-ups.ts";

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
  /** Whether its spots are drilled first, by the pilot rule, said on its close-ups (#826). */
  drills?: { first: boolean; bit?: number };
  /** Its fixings, each with the type of close-up that shows it made (#813), which it must show. */
  fixings?: readonly { name: string; count: number; joint: FixingType }[];
  /** The techniques it uses (#813): drawn in full the first time the steps use each. */
  techniques?: readonly Technique[];
  /** How to batch it, in a few words (#789). */
  batch: string;
  /** At most four (#789): anything more is another step, or a tip. */
  actions: readonly Action[];
  tips?: readonly string[];
  closeUp?: CloseUp;
  /** Its close-ups when it has more than one: a fixing tightened, and taken apart (#783). */
  closeUps?: readonly CloseUp[];
  walkThrough?: readonly WalkStep[];
  check: { says: string; photo: string };
  words?: readonly Word[];
};

/** One action: how to do it, for a beginner, and just the numbers. */
export const act = (howTo: string, numbers: string): Action => ({ howTo, numbers });

/** A shop's cut end is often out of square, and the first piece is measured from it. */
const squareEnd = act(
  "Check the end is square. If it isn't, saw 10 mm off it first.",
  "End square? If not, trim it.",
);

/** A piece cut again and again from a length, said once: "C 460 four times". */
const TIMES = ["", "", " twice", " three times", " four times", " five times", " six times"];

/**
 * One length's pieces, one at a time (#789): each measured from the fresh end the last cut left,
 * so a saw cut never shifts a mark and there's no sum to follow. The cut plan still shows the
 * whole length.
 */
const marking = (length: MarkedLength, at: number): Action => {
  const lengths = length.count === 1 ? "one length" : `${length.count} lengths`;
  const runs: [string, number][] = [];
  for (const { label, length: mm } of length.cuts) {
    const last = runs.at(-1);
    if (last?.[0] === `${label} ${mm}`) last[1] += 1;
    else runs.push([`${label} ${mm}`, 1]);
  }
  const pieces = runs.map(([cut, n]) => `${cut}${TIMES[n] ?? ` ${n} times`}`).join(", then ");
  // How a piece is marked is Show me how's walk-through; the first line says where it starts.
  return {
    howTo: `On ${lengths} of ${length.stock}: ${pieces}, ${at === 0 ? "each from the fresh end" : "the same way"}.`,
    numbers: `${length.count} × ${length.stock}: ${pieces}`,
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

/** Each piece's letter on it as it comes off, whichever saw cut it: said with the cut. */
const LABEL = "Pencil its letter on it.";

/**
 * A length held at one end sags at the other as the cut goes through, which pinches the saw and
 * snaps the last of the cut, so the long end rests on something level with where it's held.
 */
const longEnd = (holding: string) =>
  act(`Rest the long end on something as high as ${holding}.`, "Long end supported, level.");

/** Each saw's three lines: held, the long end supported, the cut and its letter. */
const CUTTING: Readonly<
  Record<Saw, Pick<Draft, "safety" | "actions"> & { tools: readonly Tool[] }>
> = {
  "mitre-saw": {
    tools: ["mitre-saw", "long-end-support", "square", "tape-measure", "pencil"],
    safety: ["safety-glasses", "ear-defenders"],
    actions: [
      act(
        "Length on the saw's bed, tight to the fence, the line just past the slot.",
        "On the bed, against the fence.",
      ),
      longEnd("the saw's bed"),
      act(
        `Blade on the waste side. Cut, and let it stop before you lift it. ${LABEL}`,
        "Mitre saw, waste side, blade stopped before lifting. Letter on it.",
      ),
    ],
  },
  "circular-saw": {
    tools: ["circular-saw", "clamps", "long-end-support", "square", "tape-measure", "pencil"],
    safety: ["safety-glasses", "ear-defenders"],
    actions: [
      act(
        "Clamp the length down, the line just past the edge.",
        "Clamped down, line just past the edge.",
      ),
      longEnd("what it's clamped to"),
      act(
        `Blade 5 mm deeper than the timber, on the waste side. One steady push. ${LABEL}`,
        "Circular saw, blade 5 mm past the timber, waste side. Letter on it.",
      ),
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
        "Clamp the length in the folding workbench's jaws, the line just past the edge.",
        "In the jaws, line just past the edge.",
      ),
      longEnd("the jaws"),
      act(
        `Saw on the waste side, holding the offcut near the end. ${LABEL}`,
        "Hand saw, waste side. Letter on it.",
      ),
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
 * are too wide for your mitre saw: hand saw for these." How that saw cuts, and any capacity
 * assumed, are tips (#826).
 */
const handedLine = (
  { stock, saw: other, why }: HandedOn,
  options: {
    cutPlan: CutPlan;
    saw: Saw;
    sectionOf: (stock: string) => Section;
    nameOf: (label: string) => string;
  },
): { action: Action; tips: string[] } => {
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
  const limit = `${why.limit.value} mm ${why.way}`;
  const line = isAssumed
    ? `Your ${yours} may not cut ${limit}: ${using} for the ${these}.`
    : `The ${these} are too ${why.way} for your ${yours}: ${using} for these.`;
  const assumed = `Your ${yours}'s cutting capacity isn't known, so it's assumed to cut ${limit}. Say what it cuts at 90°, from its label, to check.`;
  const numbers = `${labels.join(", ")}: ${using}${isAssumed ? " (capacity assumed)" : `, too ${why.way}`}.`;
  return {
    action: act(line, numbers),
    tips: [...(isAssumed ? [assumed] : []), OTHER_SAW[other]],
  };
};

/** Several actions said as one line. */
const joined = (actions: readonly Action[]): Action => ({
  howTo: actions.map((action) => action.howTo).join(" "),
  numbers: actions.map((action) => action.numbers).join(" "),
});

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
  const handedLines = handed.map((each) => handedLine(each, options));
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
            `${plan.lengths.length === 1 ? "One length" : `${plan.lengths.length} lengths`} of ${plan.stock}, ${plan.stockLength} long, none badly bent or split.`,
            `${plan.stock} × ${plan.lengths.length}`,
          ),
        ),
        ...(sheetPieces.length === 0
          ? []
          : [
              act(
                "The sheet cut by the shop to the cut plan: measure each piece.",
                "Each sheet piece measured.",
              ),
            ]),
      ],
      tips: sheetPieces.length === 0 ? [] : [`The sheet's pieces: ${sheetPieces.join(", ")}.`],
      check: {
        says: "Everything on the buy list is here.",
        photo: "Everything laid out on the floor.",
      },
      batch: "All at once, laid out on the floor.",
    },
    {
      id: "mark-lengths",
      on: true,
      title: "Mark the lengths",
      minutes: 20,
      parts: timberLabels,
      adds: [],
      tools: ["tape-measure", "pencil", "square"],
      batch: "One piece at a time, with the next step: mark it, cut it, then mark the next.",
      actions: [squareEnd, ...marked.map(marking)],
      // How the end is checked, behind Show me how (#826): the line says only what to do.
      tips: [
        "To check an end, hold the square's stock tight against the edge and look along its blade: a gap means it's out. Square a line 10 mm in and saw to it.",
      ],
      walkThrough: markingWalk(first),
      techniques: markingTechnique(first, options.sectionOf),
      check: {
        says: "Every line square across the face, each piece measured from a square end.",
        photo: "One marked length, close up.",
      },
      words: ["square"],
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
      batch: "One piece at a time: cut each as soon as it's marked.",
      // The cuts handed on to another saw, in one line, so the step stays at four.
      actions: [
        ...cutting.actions,
        ...(handedLines.length === 0 ? [] : [joined(handedLines.map((each) => each.action))]),
      ],
      tips: [
        "A sawhorse, a stool or the stack of timber will do for the long end. One that sags pinches the saw and snaps the last of the cut.",
        ...new Set(handedLines.flatMap((each) => each.tips)),
      ],
      check: {
        says: "Each piece within 1 mm of its length, and its letter on it.",
        photo: "The pieces in rows by letter.",
      },
      words: ["waste side", "offcut"],
    },
  ];
};
