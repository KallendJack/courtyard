import type { SizeSource, SourcedSize } from "@courtyard/contract";
import type { CheckedRecipe } from "./recipe.ts";

// What a printed part's Build has of its own (#702), out of build.ts (over 400 lines).

/** A printer's plate, or how far it reaches up, mm. */
export type PrintSize = { readonly width: number; readonly depth: number; readonly height: number };

/** A size the Print tab lists: its name, as it says it, and its source when it's an object's. */
export type PrintLine = {
  readonly name: string;
  readonly says: string;
  readonly source: SizeSource | null;
};

/**
 * A printed part's own (#702): the plate it's for and whether it fits, its clearance and nozzle,
 * the sizes to list, and the recipe it's made from, checked, which the worker makes into a solid.
 */
export type BuildPrint = {
  readonly plate: PrintSize;
  readonly fits: boolean;
  readonly clearance: SourcedSize;
  readonly nozzle: SourcedSize;
  readonly sizes: readonly PrintLine[];
  /** `null` when it can't be made (a `cannot-make` finding says why). */
  readonly recipe: CheckedRecipe | null;
};
