import type { BuyLine, BuyList, CutPlan, Step } from "./build.ts";
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
 * for, while the steps need one and none is to hand: once they have it, it's bought.
 */
export const toolsToBuy = (steps: readonly Step[], buying: readonly Tool[]): BuyLine[] =>
  buying.flatMap((tool) => {
    const needing = steps.filter((step) =>
      [...step.tools, ...step.safety].some((each) => each.tool === tool && !each.toHand),
    );
    if (needing.length === 0) return [];
    const numbers = needing.map((step) => step.number);
    return [
      buyLine({
        item: TOOL_NAMES[tool],
        kind: "tool",
        for: `${numbers.length === 1 ? "step" : "steps"} ${numbers.join(", ")}`,
        needed: 1,
        price: undefined,
      }),
    ];
  });

/** The list, with the priced lines' total; lines needing none are left off. */
export const buyListOf = (lines: readonly BuyLine[]): BuyList => {
  const needed = lines.filter((line) => line.needed > 0);
  return {
    lines: needed,
    total: needed.reduce((sum, line) => sum + (line.total ?? 0), 0),
    unpriced: needed.filter((line) => line.total === undefined).length,
  };
};
