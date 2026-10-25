import { describe, expect, it } from "vitest";
import { goldenShim } from "./fixtures/golden.ts";
import { derivePrinted } from "./index.ts";
import { makePart } from "./make.ts";
import type { CheckedRecipe } from "./recipe.ts";

// What a checked recipe can't be made into (#702): a pocket or slot with no part there, a part of
// nothing, and a part manifold fails on. Each is refused with its reason, so a file is only ever
// made of one closed solid. Lettering, which needs the font from a file, is the worker's test
// (`apps/worker/test/fabrication-print.test.ts`).

const SCREW = {
  name: "3 mm screws",
  diameter: { value: 3, unit: "mm", source: { kind: "measured" } },
};
const TIN = {
  name: "tin",
  width: { value: 20, unit: "mm", source: { kind: "measured" } },
  height: { value: 10, unit: "mm", source: { kind: "measured" } },
  depth: { value: 10, unit: "mm", source: { kind: "measured" } },
};
const CYLINDER = { kind: "cylinder", diameter: 40, height: 30 };
const BRACKET = { kind: "l-bracket", width: 40, depth: 50, height: 50, thickness: 5 };

/** A recipe as a model writes it, checked: it throws if the check refuses it. */
const checked = (recipe: unknown): CheckedRecipe => {
  const derived = derivePrinted("printed-part")({ part: "Test part", recipe });
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  const made = derived.value.print?.recipe;
  if (!made) throw new Error(JSON.stringify(derived.value.findings));
  return made;
};

describe("a part made from its recipe", () => {
  it("refuses a pocket in an L-bracket's top, where it would cut nothing", async () => {
    const made = await makePart(
      checked({ base: BRACKET, features: [{ kind: "pocket", face: "top", object: TIN }] }),
    );
    expect(made.ok ? [] : made.error).toEqual([
      "The pocket for the tin isn't all in the part there: an L-bracket is solid right across only on its bottom and back, so put it there.",
    ]);
  });

  it("makes the pocket in the L-bracket's back, which is solid", async () => {
    const made = await makePart(
      checked({
        base: { ...BRACKET, thickness: 15 },
        features: [{ kind: "pocket", face: "back", object: TIN }],
      }),
    );
    expect(made.ok && made.value.watertight).toBe(true);
  });

  it("refuses a slot off the round of a cylinder, in its box's corner", async () => {
    const made = await makePart(
      checked({
        base: CYLINDER,
        features: [{ kind: "slot", face: "top", at: { u: 4, v: 4 }, length: 4, screw: SCREW }],
      }),
    );
    expect(made.ok ? [] : made.error).toEqual([
      "The slot for the 3 mm screws misses the part: move it onto it.",
    ]);
  });

  it("refuses a part that comes out as nothing, rather than an empty file", async () => {
    const recipe = checked({ base: { kind: "plate", width: 20, depth: 10, thickness: 3 } });
    // A fillet of half its depth, which the recipe's check refuses before this.
    const made = await makePart({ ...recipe, features: [{ kind: "fillet", radius: 5 }] });
    expect(made).toEqual({
      ok: false,
      error: ["It comes out as nothing to print: check its sizes."],
    });
  });

  it("refuses a part manifold fails on, and makes the next part as ever", async () => {
    const recipe = checked({ base: { kind: "box", width: 10, depth: 10, height: 10 } });
    const huge = 1e300;
    const failed = await makePart({
      ...recipe,
      base: { kind: "box", width: huge, depth: huge, height: huge },
      features: [{ kind: "fillet", radius: 1 }],
    });
    expect(failed).toEqual({
      ok: false,
      error: [
        "It couldn't be made: making its solid failed. Make it simpler, with fewer features or less lettering.",
      ],
    });
    const shim = derivePrinted("castor-shim")(goldenShim);
    const next =
      shim.ok && shim.value.print?.recipe ? await makePart(shim.value.print.recipe) : null;
    expect(next?.ok && next.value.watertight).toBe(true);
  });
});
