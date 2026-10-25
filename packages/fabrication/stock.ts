import { SourcedSize } from "@courtyard/contract";
import { z } from "zod";

// What parts are cut from and fixed with, for any template. A template takes each of its slots'
// stock as a parameter (the frame's timber, the top's sheet), never a stock of its own, so a slot
// can be offered sawn C16, CLS or treated timber, or plywood, OSB or MDF, and the Build derived
// again (#704).

export const Words = z.string().trim().min(1).max(80);

/** A pack's price, in pence, and where it's from. */
export const Price = z.object({
  pence: z.number().int().nonnegative(),
  /** How many come in one pack: a set of 4 castors, a box of 100 screws. */
  packOf: z.number().int().positive().default(1),
  shop: Words.optional(),
  link: z.url().max(2000).optional(),
});
export type Price = z.infer<typeof Price>;

/** A timber sold in lengths: its section and its length. */
export const Timber = z.object({
  name: Words,
  thickness: SourcedSize,
  width: SourcedSize,
  length: SourcedSize,
  price: Price.optional(),
});
export type Timber = z.infer<typeof Timber>;

/** A sheet material: its thickness and the sheet's size. */
export const Sheet = z.object({
  name: Words,
  thickness: SourcedSize,
  width: SourcedSize,
  length: SourcedSize,
  price: Price.optional(),
});
export type Sheet = z.infer<typeof Sheet>;

/** Screws or brackets, bought by the pack. */
export const Fixing = z.object({ name: Words, price: Price.optional() });
export type Fixing = z.infer<typeof Fixing>;
