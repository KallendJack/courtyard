import { BuildRecipe } from "@courtyard/contract";
import { describe, expect, it } from "vitest";
import { goldenBench } from "../bench/fixtures/golden.ts";
import { workOutBench } from "../bench/index.ts";
import { BenchParameters } from "../bench/parameters.ts";
import type { Build, BuildSetting } from "../build.ts";
import { benchRecipe } from "./bench.ts";
import { goldenBenchRecipe } from "./fixtures/golden-bench.ts";
import { deriveRecipe } from "./index.ts";
import { deriveBench, starterRecipe } from "./starters.ts";

// The recipe language (#769): the golden bench written as a recipe gives exactly the template's
// Build, worked out by the template's own code from its parameters, and a recipe over its bounds,
// or pointing at what isn't there, is refused with the reason.

const fromRecipe = (recipe: unknown, setting?: BuildSetting): Build => {
  const derived = deriveRecipe(recipe, setting);
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

/** The template's Build, worked out from its parameters without a recipe. */
const fromTemplate = (parameters: unknown, setting?: BuildSetting): Build => {
  const derived = workOutBench(BenchParameters.parse(parameters), setting);
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

const refused = (recipe: unknown): string[] => {
  const derived = deriveRecipe(recipe);
  if (derived.ok) throw new Error("The recipe was worked out.");
  return derived.error;
};

describe("the golden bench as a recipe", () => {
  it("gives the template's parts, cut plan, buy list, findings and steps", () => {
    const recipe = fromRecipe(goldenBenchRecipe);
    const template = fromTemplate(goldenBench);

    expect(recipe.parts).toEqual(template.parts);
    expect(recipe.cutPlan).toEqual(template.cutPlan);
    expect(recipe.buyList).toEqual(template.buyList);
    expect(recipe.findings).toEqual(template.findings);
    expect(recipe.steps).toEqual(template.steps);
    expect(recipe).toEqual(template);
  });

  it("gives the same Build worked out with the owner's tools and a step started", () => {
    const setting: BuildSetting = {
      tools: ["Hand saw", "Mitre saw", "Drill / driver", "Tape, pencil", "Square"],
      kept: [{ step: "cut-timber", tool: "hand-saw" }],
      sizes: [{ name: "Mitre saw", size: "120 × 60 mm" }],
    };
    expect(fromRecipe(goldenBenchRecipe, setting)).toEqual(fromTemplate(goldenBench, setting));
  });

  it("gives the template's Build on its legs, written by hand without the castors", () => {
    const { stock, pieces, joints } = goldenBenchRecipe;
    const onLegs = {
      ...goldenBenchRecipe,
      stock: stock.filter((item) => item.kind !== "castor"),
      pieces: pieces.filter((piece) => piece.id !== "castor-bases"),
      joints: joints.filter(
        (joint) =>
          joint.kind !== "bolted" && !("joins" in joint && joint.joins[1] === "castor-bases"),
      ),
    };
    expect(fromRecipe(onLegs)).toEqual(fromTemplate({ ...goldenBench, castors: null }));
  });

  it.each([
    ["on its legs", { castors: null }],
    ["with no shelf", { shelf: { ...goldenBench.shelf, on: false } }],
    ["braced only at the back", { braces: { ...goldenBench.braces, ends: false } }],
    ["unbraced", { braces: { ...goldenBench.braces, ends: false, rear: false } }],
    [
      "with its brackets on the sheet screws",
      { fixings: { ...goldenBench.fixings, bracketScrews: undefined } },
    ],
    ["somewhere damp", { damp: true }],
  ])("gives the template's Build %s, as its starter writes it", (_bench, change) => {
    const parameters = { ...goldenBench, ...change };
    expect(fromRecipe(benchRecipe(BenchParameters.parse(parameters)))).toEqual(
      fromTemplate(parameters),
    );
  });

  it("is what the bench's starter writes from the golden bench's parameters", () => {
    const starter = starterRecipe("framed-bench", goldenBench);
    expect(starter.ok && BuildRecipe.parse(starter.value)).toEqual(
      BuildRecipe.parse(goldenBenchRecipe),
    );
  });

  it("is what the bench template now works out, through its starter", () => {
    const derived = deriveBench(goldenBench);
    expect(derived.ok && derived.value).toEqual(fromTemplate(goldenBench));
  });
});

describe("a recipe over its bounds", () => {
  it("is refused for a size over the most, saying the most", () => {
    const long = { ...goldenBenchRecipe.size.length, value: 5000 };
    expect(
      refused({ ...goldenBenchRecipe, size: { ...goldenBenchRecipe.size, length: long } }),
    ).toEqual(["size.length: The length is 5000 mm: it must be more than 0 and at most 3000 mm."]);
  });

  it("is refused for a kerf over 10 mm and an overhang over 300", () => {
    const [top, ...rest] = goldenBenchRecipe.pieces;
    const errors = refused({
      ...goldenBenchRecipe,
      kerf: { ...goldenBenchRecipe.kerf, value: 25 },
      pieces: [{ ...top, overhang: { ...top.overhang, value: 400 } }, ...rest],
    });
    expect(errors).toEqual([
      "kerf: The kerf is 25 mm: it must be at most 10 mm.",
      "pieces.0.overhang: The overhang is 400 mm: it must be at most 300 mm.",
    ]);
  });

  it("is refused for more joints than a recipe has", () => {
    const joint = goldenBenchRecipe.joints[0];
    expect(
      refused({ ...goldenBenchRecipe, joints: Array.from({ length: 33 }, () => joint) }),
    ).toEqual(["joints: A recipe has at most 32 joints."]);
  });

  it("is refused for a timber longer than any sold", () => {
    const [timber, ...rest] = goldenBenchRecipe.stock;
    expect(
      refused({
        ...goldenBenchRecipe,
        stock: [{ ...timber, length: { ...timber.length, value: 9000 } }, ...rest],
      }),
    ).toEqual([
      "stock.0.length: 45 × 95 C16's length is 9000 mm: it must be more than 0 and at most 6000 mm.",
    ]);
  });
});

describe("a recipe that doesn't hold together", () => {
  it("is refused for a joint holding what isn't in it", () => {
    expect(
      refused({
        ...goldenBenchRecipe,
        joints: [
          ...goldenBenchRecipe.joints,
          { kind: "screwed", joins: ["legs", "drawer"], fixing: "5-80-screws" },
        ],
      }),
    ).toEqual([
      `joints.9.joins.1: "drawer" isn't in the recipe: a joint holds two pieces or groups.`,
    ]);
  });

  it("is refused for a panel cut from a timber", () => {
    const [top, ...rest] = goldenBenchRecipe.pieces;
    expect(
      refused({ ...goldenBenchRecipe, pieces: [{ ...top, stock: "45-95-c16" }, ...rest] }),
    ).toEqual([`pieces.0.stock: "45-95-c16" is a timber: a panel is cut from a sheet.`]);
  });

  it("is refused for one name given to two things", () => {
    const [top, ...rest] = goldenBenchRecipe.pieces;
    expect(refused({ ...goldenBenchRecipe, pieces: [{ ...top, id: "legs" }, ...rest] })).toContain(
      `pieces.0.id: "legs" names two things: give each its own.`,
    );
  });

  it("is refused for pocket holes and drawers in plain words, with what to make instead", () => {
    expect(
      refused({
        ...goldenBenchRecipe,
        joints: [{ kind: "pocket-hole", joins: ["legs", "end-frames"], fixing: "5-80-screws" }],
      }),
    ).toEqual([
      "joints.0.kind: Pocket holes aren't in a recipe yet: screw timber into timber instead.",
    ]);
    expect(
      refused({
        ...goldenBenchRecipe,
        groups: [...goldenBenchRecipe.groups, { kind: "drawers", id: "d", stock: "18-mm-plywood" }],
      }),
    ).toEqual([
      "groups.5.kind: Drawers aren't in a recipe yet: shelves in a box or frame, holding storage boxes, instead.",
    ]);
  });

  it("is refused for a joint the language doesn't have, saying the ones it has", () => {
    expect(
      refused({
        ...goldenBenchRecipe,
        joints: [{ kind: "nailed", joins: ["legs", "end-frames"], fixing: "5-80-screws" }],
      }),
    ).toEqual([
      `joints.0.kind: "nailed" isn't a joint a recipe has: it has screwed, sheet-screwed, bracket, bolted or printed.`,
    ]);
  });

  it("is refused for a piece joined to itself", () => {
    const [, ...rest] = goldenBenchRecipe.joints;
    expect(
      refused({
        ...goldenBenchRecipe,
        joints: [{ kind: "screwed", joins: ["legs", "legs"], fixing: "5-80-screws" }, ...rest],
      }),
    ).toEqual([`joints.0.joins: "legs" is joined to itself: a joint holds two pieces or groups.`]);
  });

  it("is refused, until any recipe is worked out (#770), when it isn't the bench's arrangement", () => {
    const { groups } = goldenBenchRecipe;
    expect(
      refused({
        ...goldenBenchRecipe,
        groups: [...groups, { kind: "box", id: "crate", stock: "18-mm-plywood", open: "top" }],
      }),
    ).toEqual([
      "recipe: Only a framed bench's recipe can be worked out so far, and this has a box (crate).",
    ]);
  });

  it("is refused, until then, when it's a bench's pieces held another way", () => {
    const loose = { ...goldenBenchRecipe, joints: goldenBenchRecipe.joints.slice(0, -1) };
    expect(refused(loose)).toEqual([
      "recipe: Only a framed bench's recipe can be worked out so far, and this joins its pieces another way than a bench's.",
    ]);
  });
});
