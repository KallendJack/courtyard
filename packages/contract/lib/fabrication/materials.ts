import { z } from "zod";
import { SourcedSize } from "../sourced/size.ts";

// What a Build's parts are cut from and fixed with, and the tools its steps can need (#704, #769):
// shared by a template's parameters and a recipe, so `packages/fabrication` re-exports them by
// their own names (`Timber`, `Sheet`, `Tool`…) and nowhere else defines them.

/** A name, as a stock, a fixing or a shop has. */
export const Words = z.string().trim().min(1).max(80);

/** A pack's price, in pence, and where it's from. */
export const BuildPrice = z.object({
  pence: z.number().int().nonnegative(),
  /** How many come in one pack: a set of 4 castors, a box of 100 screws. */
  packOf: z.number().int().positive().default(1),
  shop: Words.optional(),
  link: z.url().max(2000).optional(),
});
export type BuildPrice = z.infer<typeof BuildPrice>;

/** The stock options a slot can be offered (`packages/fabrication`'s `options.ts`), by name. */
export const BuildStockOptionId = z.enum([
  "c16-45x95",
  "cls-38x89",
  "treated-47x100",
  "c16-45x145",
  "plywood-18",
  "osb-18",
  "mdf-18",
]);
export type BuildStockOptionId = z.infer<typeof BuildStockOptionId>;

/**
 * An option's price from its shop's page, and the size it's sold in at that price where that isn't
 * the option's own (a 3 m length, a half sheet). A stock swapped out keeps its price and size here,
 * so picking it again puts it back as it was.
 */
export const BuildOptionPrice = BuildPrice.extend({
  /** A timber's length, or a sheet's. */
  length: SourcedSize.optional(),
  /** A sheet's width; a timber's section is its option's. */
  width: SourcedSize.optional(),
});
export type BuildOptionPrice = z.infer<typeof BuildOptionPrice>;

/** The options' prices, each from its shop's page, so each option's cost can be shown. */
export const BuildOptionPrices = z.partialRecord(BuildStockOptionId, BuildOptionPrice);
export type BuildOptionPrices = z.infer<typeof BuildOptionPrices>;

/** A timber sold in lengths: its section and its length. */
export const BuildTimber = z.object({
  name: Words,
  /** The stock option it is, when it's one; else it's matched by its section and name. */
  option: BuildStockOptionId.optional(),
  thickness: SourcedSize,
  width: SourcedSize,
  length: SourcedSize,
  price: BuildPrice.optional(),
});
export type BuildTimber = z.infer<typeof BuildTimber>;

/** A sheet material: its thickness and the sheet's size. */
export const BuildSheet = z.object({
  name: Words,
  /** The stock option it is, when it's one; else it's matched by its thickness and name. */
  option: BuildStockOptionId.optional(),
  thickness: SourcedSize,
  width: SourcedSize,
  length: SourcedSize,
  price: BuildPrice.optional(),
});
export type BuildSheet = z.infer<typeof BuildSheet>;

/** Screws or brackets, bought by the pack. */
export const BuildFixing = z.object({ name: Words, price: BuildPrice.optional() });
export type BuildFixing = z.infer<typeof BuildFixing>;

/**
 * The tools and safety kit a step can need, which the owner's tools to hand are set against. Kit
 * is a tool like any other here, so a missing pair of glasses is listed as a missing saw is.
 */
export const BuildToolId = z.enum([
  "tape-measure",
  "pencil",
  "square",
  "hand-saw",
  "circular-saw",
  "mitre-saw",
  "folding-workbench",
  "long-end-support",
  "clamps",
  "drill-driver",
  "drill-bits",
  "countersink-bit",
  "spanner",
  "spirit-level",
  "sandpaper",
  "safety-glasses",
  "ear-defenders",
]);
export type BuildToolId = z.infer<typeof BuildToolId>;
