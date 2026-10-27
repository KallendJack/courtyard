import type { BuyList, Fitted, Part, Step } from "../build.ts";

// The parts page and each step's uses (#778; Paper, 2 · Agreed, "Fabrication · Parts page, any
// build · Fold 933×645 (#778)"), for any Build: like a flat pack's inventory, every piece and the
// fixings bag by count, and each step's strip of exactly the parts and fixings it takes, so the
// owner lays them out first. A part is used by the step that puts it on; something fitted (a
// castor) by the step that puts on what it's fitted to.

/**
 * What a step takes, to lay out before it starts: every piece of each part it puts on, and its
 * fixings and what it fits whole (castors), each by its count.
 */
export type Uses = {
  readonly parts: readonly { readonly label: string; readonly count: number }[];
  readonly fixings: readonly { readonly name: string; readonly count: number }[];
};

/**
 * A fixing in the bag, as the parts page draws it: by its kind, its name and count, and the
 * buy-list lines it is (a bolt set is the bolts, and the washers and nuts of their thread).
 */
export type BagItem = {
  readonly kind:
    | "screw"
    | "bracket"
    | "bolt-set"
    | "bolt"
    | "washer"
    | "nut"
    | "castor"
    | "fitted"
    | "other";
  readonly name: string;
  readonly count: number;
  readonly of: readonly { readonly name: string; readonly count: number }[];
};

/** A step as its template writes it, before its uses are worked out from what it puts on. */
export type StepDraft = Omit<Step, "uses">;

/** A step's uses: the pieces it puts on, every one of each part, and its fixings and fitted. */
const usesOf = (step: StepDraft, parts: readonly Part[], fitted: readonly Fitted[]): Uses => ({
  parts: step.adds.flatMap((label) => {
    const part = parts.find((each) => each.label === label);
    return part === undefined ? [] : [{ label, count: part.count }];
  }),
  fixings: [
    ...step.fixings.map(({ name, count }) => ({ name, count })),
    ...fitted
      .filter((each) => step.adds.includes(each.on))
      .map((each) => ({ name: each.name, count: each.boxes.length })),
  ],
});

/** The steps with their uses. */
export const withUses = (
  steps: readonly StepDraft[],
  parts: readonly Part[],
  fitted: readonly Fitted[],
): Step[] => steps.map((step) => ({ ...step, uses: usesOf(step, parts, fitted) }));

/** A bolt's, washer's or nut's thread, from its name as shops give it: "M6". */
const threadOf = (name: string) => /\bM(\d+)\b/i.exec(name)?.[0].toUpperCase();

const BOLT = /\bbolts?\b/i;
const WASHER = /\bwashers?\b/i;
const NUT = /\bnuts?\b/i;

/** What a fixing is drawn as, by the words in its name. */
const kindOf = (name: string, fitted: boolean): BagItem["kind"] => {
  if (/\bcastors?\b/i.test(name)) return "castor";
  if (fitted) return "fitted";
  if (/\bscrews?\b/i.test(name)) return "screw";
  if (/\bbrackets?\b/i.test(name)) return "bracket";
  if (BOLT.test(name)) return "bolt-set";
  if (WASHER.test(name)) return "washer";
  if (NUT.test(name)) return "nut";
  return "other";
};

/**
 * The fixings bag from the buy list: each fixing by its count, then what's fitted whole. A bolt
 * takes the washers and nuts of its thread with it, as one bolt set ("M6 × 60 bolt sets").
 */
export const bagOf = (buyList: BuyList): BagItem[] => {
  const lines = [
    ...buyList.lines.filter((line) => line.kind === "fixing"),
    ...buyList.lines.filter((line) => line.kind === "fitted"),
  ];
  const bolts = lines.filter((line) => line.kind === "fixing" && BOLT.test(line.item));
  /** The washers and nuts a bolt takes: of its thread, when only it has that thread. */
  const withBolt = (item: string) => {
    const thread = threadOf(item);
    if (!(WASHER.test(item) || NUT.test(item)) || thread === undefined) return undefined;
    const matching = bolts.filter((bolt) => threadOf(bolt.item) === thread);
    return matching.length === 1 ? matching[0] : undefined;
  };
  return lines.flatMap((line): BagItem[] => {
    const of = { name: line.item, count: line.needed };
    if (withBolt(line.item) !== undefined) return [];
    const kind = kindOf(line.item, line.kind === "fitted");
    if (kind !== "bolt-set") return [{ kind, name: line.item, count: line.needed, of: [of] }];
    const taken = lines.filter((each) => withBolt(each.item) === line);
    return [
      {
        kind: taken.length === 0 ? "bolt" : "bolt-set",
        name: taken.length === 0 ? line.item : line.item.replace(/\bbolts?\b/i, "bolt sets"),
        count: line.needed,
        of: [of, ...taken.map((each) => ({ name: each.item, count: each.needed }))],
      },
    ];
  });
};
