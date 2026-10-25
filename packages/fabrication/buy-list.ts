import type { BuyLine, BuyList, CutPlan, Step, StepTool } from "./build.ts";
import type { Price, Sheet, Timber } from "./stock.ts";
import { TOOL_NAMES, type Tool } from "./tools.ts";

// A Build's buy list: how many of each thing to buy, in whole packs, at the prices the parameters
// give. A line with no price is listed and counted, never guessed.

/** One line: the packs that cover what's needed, and their cost when the price is known. */
export const buyLine = (line: {
  item: string;
  kind: BuyLine["kind"];
  stock?: string;
  for: string;
  needed: number;
  price: Price | undefined;
}): BuyLine => {
  const packOf = line.price?.packOf ?? 1;
  const packs = Math.ceil(line.needed / packOf);
  const { price, ...rest } = line;
  if (!price) return { ...rest, packOf, packs };
  return {
    ...rest,
    packOf,
    packs,
    price: {
      pence: price.pence,
      ...(price.shop === undefined ? {} : { shop: price.shop }),
      ...(price.link === undefined ? {} : { link: price.link }),
    },
    total: packs * price.pence,
  };
};

/** The lengths and sheets the cut plan uses, each with what it's for. */
export const stockLines = (options: {
  cutPlan: CutPlan;
  timbers: readonly Timber[];
  sheets: readonly Sheet[];
  /** What each part is, by its label. */
  names: ReadonlyMap<string, string>;
}): BuyLine[] => {
  const usedFor = (labels: readonly string[]) =>
    [...new Set(labels)]
      .map((label) => options.names.get(label)?.toLowerCase() ?? label)
      .join(", ");
  return [
    ...options.cutPlan.timber.map((plan) =>
      buyLine({
        item: `${plan.stock}, ${plan.stockLength / 1000} m`,
        kind: "timber",
        stock: plan.stock,
        for: usedFor(plan.lengths.flatMap((length) => length.cuts.map((cut) => cut.label))),
        needed: plan.lengths.length,
        price: options.timbers.find((timber) => timber.name === plan.stock)?.price,
      }),
    ),
    ...options.cutPlan.sheets.map((plan) =>
      buyLine({
        item: `${plan.stock}, ${plan.sheetLength} × ${plan.sheetWidth}`,
        kind: "sheet",
        stock: plan.stock,
        for: usedFor(plan.sheets.flatMap((sheet) => sheet.pieces.map((piece) => piece.label))),
        needed: plan.sheets.length,
        price: options.sheets.find((sheet) => sheet.name === plan.stock)?.price,
      }),
    ),
  ];
};

/**
 * The tools the owner chose to buy from the Tools tab (#763), a line each with the steps it's
 * for, while the steps need one and none is to hand: once they have it, it's bought. Drill bits
 * from a set the owner has are the sizes it's missing ("7 mm drill bit").
 */
export const toolsToBuy = (steps: readonly Step[], buying: readonly Tool[]): BuyLine[] =>
  buying.flatMap((tool) => {
    const uses = steps.flatMap((step) =>
      [...step.tools, ...step.safety]
        .filter((each) => each.tool === tool)
        .map((each) => ({ step: step.number, each })),
    );
    const missing = uses.filter(({ each }) => !each.toHand);
    const bits = missing.length > 0 ? [] : bitsMissing(uses.map(({ each }) => each));
    const needing =
      missing.length > 0 ? missing : uses.filter(({ each }) => bitsMissing([each]).length > 0);
    if (needing.length === 0) return [];
    const numbers = [...new Set(needing.map(({ step }) => step))];
    return [
      buyLine({
        item:
          bits.length === 0
            ? TOOL_NAMES[tool]
            : `${bits.join(" and ")} mm drill bit${bits.length === 1 ? "" : "s"}`,
        kind: "tool",
        for: `${numbers.length === 1 ? "step" : "steps"} ${numbers.join(", ")}`,
        needed: Math.max(1, bits.length),
        price: undefined,
      }),
    ];
  });

/** The sizes of drill bits the owner's set is known not to have, each once, the largest first. */
const bitsMissing = (tools: readonly StepTool[]) =>
  [
    ...new Set(
      tools
        .flatMap((tool) => (tool.bits ?? []).filter((bit) => bit.have === false))
        .map((bit) => bit.mm),
    ),
  ].sort((a, b) => b - a);

/** The list, with the priced lines' total; lines needing none are left off. */
export const buyListOf = (lines: readonly BuyLine[]): BuyList => {
  const needed = lines.filter((line) => line.needed > 0);
  return {
    lines: needed,
    total: needed.reduce((sum, line) => sum + (line.total ?? 0), 0),
    unpriced: needed.filter((line) => line.total === undefined).length,
  };
};
