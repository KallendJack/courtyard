import type { Action, CloseUp, CutPlan, Way } from "../build.ts";
import type { Word } from "../glossary.ts";
import { TOOL_NAMES, type Tool } from "../tools.ts";

// The bench's first steps, before anything is joined: check the stock, mark it and cut it. They
// read the cut plan, and the cutting step reads the tools to hand: a hand saw on a folding
// workbench, or a circular saw once there is one.

/** A step as the template writes it, before it's numbered and its tools are checked. */
export type Draft = {
  on: boolean;
  title: string;
  minutes: number;
  helper?: boolean;
  parts: readonly string[];
  /** The parts it puts on the Build: its parts, unless it only prepares or checks them. */
  adds?: readonly string[];
  ways?: readonly Way[];
  tools: readonly Tool[];
  safety?: readonly Tool[];
  fixings?: readonly { name: string; count: number }[];
  actions: readonly Action[];
  closeUp?: CloseUp;
  check: { says: string; photo: string };
  words?: readonly Word[];
};

/** One action: how to do it, for a beginner, and just the numbers. */
export const act = (howTo: string, numbers: string): Action => ({ howTo, numbers });

/** Lengths cut the same way, together: 4 lengths of "B 1450, A 750". */
const lengthGroups = (cutPlan: CutPlan) =>
  cutPlan.timber.flatMap((plan) => {
    const groups = new Map<string, number>();
    for (const length of plan.lengths) {
      const cuts = length.cuts.map((cut) => `${cut.label} ${cut.length}`).join(", ");
      groups.set(cuts, (groups.get(cuts) ?? 0) + 1);
    }
    return [...groups].map(([cuts, count]) => ({ stock: plan.stock, cuts, count }));
  });

/** The saws the timber can be cut with, best first: the first to hand is the one in use. */
const SAWS = ["circular-saw", "hand-saw"] as const satisfies readonly Tool[];

const sawInUse = (toHand: ReadonlySet<Tool>) => SAWS.find((saw) => toHand.has(saw)) ?? "hand-saw";

const sawWays = (toHand: ReadonlySet<Tool>): Way[] => {
  const using = sawInUse(toHand);
  // As the board has them: the simplest first.
  return [...SAWS].reverse().map((saw) => ({
    name: TOOL_NAMES[saw],
    using: saw === using,
    toHand: toHand.has(saw),
  }));
};

const cutting = (hasCircularSaw: boolean): Pick<Draft, "tools" | "safety" | "actions"> =>
  hasCircularSaw
    ? {
        tools: ["circular-saw", "clamps", "square", "tape-measure", "pencil"],
        safety: ["safety-glasses", "ear-defenders"],
        actions: [
          act(
            "Clamp the length to something solid with the line just past its edge. Set the blade about 5 mm deeper than the timber, line it up on the waste side of the line and cut in one steady push, letting the offcut fall clear.",
            "Circular saw, blade 5 mm past the timber, waste side.",
          ),
        ],
      }
    : {
        tools: ["hand-saw", "folding-workbench", "square", "tape-measure", "pencil"],
        safety: ["safety-glasses"],
        actions: [
          act(
            "Clamp the length in the folding workbench's jaws with the line just past the edge. Saw on the waste side of the line, and hold the offcut so it doesn't snap off.",
            "Hand saw, in the jaws, waste side.",
          ),
        ],
      };

export const preparingSteps = (cutPlan: CutPlan, toHand: ReadonlySet<Tool>): Draft[] => {
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
      on: true,
      title: "Mark the lengths",
      minutes: 20,
      parts: timberLabels,
      adds: [],
      tools: ["tape-measure", "pencil", "square"],
      actions: lengthGroups(cutPlan).map((group) =>
        act(
          `On ${group.count === 1 ? "one length" : `${group.count} lengths`} of ${group.stock}, measure and square a line across for each piece in turn: ${group.cuts}. Leave ${cutPlan.kerf} mm between pieces for the saw's cut.`,
          `${group.count} × ${group.stock}: ${group.cuts}`,
        ),
      ),
      check: {
        says: "Every line square across the face, each length's pieces marked from one end.",
        photo: "One marked length, close up.",
      },
      words: ["kerf", "square"],
    },
    {
      on: true,
      title: "Cut and label the timber",
      minutes: 40,
      parts: timberLabels,
      adds: [],
      ways: sawWays(toHand),
      ...cutting(sawInUse(toHand) === "circular-saw"),
      check: {
        says: "Each piece within 1 mm of its length, and its letter on it.",
        photo: "The pieces in rows by letter.",
      },
      words: ["waste side", "offcut"],
    },
  ];
};
