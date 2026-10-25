import { z } from "zod";

// A Build's stock options (#704): each timber and sheet it uses, with what it could be instead,
// the recommended first, each costed for this Build by `packages/fabrication` (its `options.ts`);
// and the owner's pick of one.

/** One stock a timber or sheet could be swapped for, costed for this Build. */
export const BuildStockChoice = z.object({
  option: z.string(),
  title: z.string(),
  stock: z.string(),
  why: z.string(),
  finish: z.enum(["rough", "smooth"]),
  says: z.array(z.object({ text: z.string(), tone: z.enum(["fine", "warn"]) })).readonly(),
  buys: z.string(),
  price: z
    .object({ pence: z.number(), shop: z.string().optional(), link: z.string().optional() })
    .optional(),
  total: z.number().optional(),
  picked: z.boolean(),
  recommended: z.boolean(),
});
export type BuildStockChoice = z.infer<typeof BuildStockChoice>;

/** A timber or sheet a Build uses, with its options, the recommended first. */
export const BuildStockOptions = z.object({
  stock: z.string(),
  name: z.string(),
  for: z.string(),
  choices: z.array(BuildStockChoice).readonly(),
});
export type BuildStockOptions = z.infer<typeof BuildStockOptions>;

/** One of a Build's timbers or sheets (by name, as its buy list gives it) swapped for an option. */
export const BuildStockPick = z.object({ stock: z.string().min(1), option: z.string().min(1) });
export type BuildStockPick = z.infer<typeof BuildStockPick>;
