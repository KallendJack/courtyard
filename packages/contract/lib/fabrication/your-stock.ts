import { z } from "zod";
import { ChangeId } from "../change-id.ts";
import { THING_FIELD_MAX_CHARACTERS, ThingCount } from "../things.ts";
import type { BuildBuyLine } from "./derived.ts";

// Your stock (#760): what the owner has for making besides their tools, Things of kind material
// (timber, sheets, filament) or fixing (screws, bolts, castors) at the owner's level, so every Build
// sees them. Have it on a buy-list line saves it there; every buy list leaves off what it covers.

/** The kinds of Thing Your stock keeps. */
export const StockKind = z.enum(["material", "fixing"]);
export type StockKind = z.infer<typeof StockKind>;

/** What Your stock keeps a buy-list line's item as: what's cut is a material, what's fitted a fixing. */
export const stockKindOf = (kind: BuildBuyLine["kind"]): StockKind | undefined => {
  switch (kind) {
    case "timber":
    case "sheet":
    case "filament":
      return "material";
    case "fitted":
    case "fixing":
      return "fixing";
    case "tool":
      return undefined;
  }
};

/**
 * Have it on a buy-list line: its item as the line names it, its kind, and how many the owner has,
 * which is at least what the Build uses. A count lower than what Your stock has already is no
 * change.
 */
export const HaveIt = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give what you have.")
    .max(THING_FIELD_MAX_CHARACTERS, `Keep its name to ${THING_FIELD_MAX_CHARACTERS} characters.`)
    .refine((text) => !/[\r\n]/.test(text), "Keep its name to one line."),
  kind: StockKind,
  count: ThingCount,
});
export type HaveIt = z.infer<typeof HaveIt>;

/** Have it saved, and the change that saved it (`null` when git couldn't keep it), which Undo names. */
export const StockSaved = z.object({ change: z.nullable(ChangeId) });
export type StockSaved = z.infer<typeof StockSaved>;

/** Undo of Have it, by its change. */
export const StockUndo = z.object({ change: ChangeId });
export type StockUndo = z.infer<typeof StockUndo>;
