import { BenchParameters } from "../bench/parameters.ts";
import { type Build, type BuildSetting, err, ok, type Result } from "../build.ts";
import { benchRecipe, type RecipeInput } from "./bench.ts";
import { deriveRecipe } from "./index.ts";

// The starters (ADR 0039, #769): tested recipes a Build starts from, each written from its
// template's parameters. The framed bench is the first, and its template now loads its recipe.

const STARTERS = {
  "framed-bench": (parameters: unknown): Result<RecipeInput, string[]> => {
    const parsed = BenchParameters.safeParse(parameters);
    if (!parsed.success) {
      return err(
        parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "parameters"}: ${issue.message}`,
        ),
      );
    }
    return ok(benchRecipe(parsed.data));
  },
} as const;

export type Starter = keyof typeof STARTERS;

/** A starter's recipe, from its template's parameters, or why they aren't its. */
export const starterRecipe = (
  starter: Starter,
  parameters: unknown,
): Result<RecipeInput, string[]> => STARTERS[starter](parameters);

/**
 * The framed bench: its parameters in, loaded as its recipe, and everything the recipe's Build
 * shows out. Parameters that aren't a bench (a size with no source, a bench too low for its
 * castors) are refused with what's wrong. Its steps follow the owner's tools when they're given,
 * and keep the ways the steps started were done (#777).
 */
export const deriveBench = (
  input: unknown,
  setting: BuildSetting = {},
): Result<Build, string[]> => {
  const recipe = starterRecipe("framed-bench", input);
  return recipe.ok ? deriveRecipe(recipe.value, setting) : recipe;
};
