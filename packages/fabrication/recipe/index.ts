import { BuildRecipe } from "@courtyard/contract";
import { workOutBench } from "../bench/index.ts";
import { type Build, type BuildSetting, err, type Result } from "../build.ts";
import { benchFromRecipe } from "./bench.ts";
import { workOutRecipe } from "./work-out.ts";

// A Build's recipe (ADR 0039, #769) in, everything its Build shows out. A recipe is checked first
// (`BuildRecipe`, in the contract: its sizes and counts within their bounds, every ID once, every
// reference to the right kind), so one over its bounds is refused with the reason.

/**
 * A recipe worked out: refused with each thing wrong, by where it is in the recipe, or its Build.
 * Any recipe's parts, cut plan, buy list and stock findings are worked out from its pieces, groups
 * and joints (#770). A framed bench's is still worked out by the bench's own code, steps and all,
 * until any recipe's steps are worked out from its joints (#772).
 */
export const deriveRecipe = (
  input: unknown,
  setting: BuildSetting = {},
): Result<Build, string[]> => {
  const parsed = BuildRecipe.safeParse(input);
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "recipe"}: ${issue.message}`),
    );
  }
  const bench = benchFromRecipe(parsed.data);
  if (bench) return workOutBench(bench, setting);
  return workOutRecipe(parsed.data, setting.have);
};
