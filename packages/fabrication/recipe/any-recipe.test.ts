import { BuildRecipe } from "@courtyard/contract";
import { describe, expect, it } from "vitest";
import { goldenBench } from "../bench/fixtures/golden.ts";
import { workOutBench } from "../bench/index.ts";
import { BenchParameters } from "../bench/parameters.ts";
import type { Build, BuyList, Part } from "../build.ts";
import { goldenBenchRecipe } from "./fixtures/golden-bench.ts";
import { rack, sawStand, shelfBox } from "./fixtures/invented.ts";
import { pickRecipeStock, workOutRecipe } from "./work-out.ts";

// Any recipe worked out (#770): the golden bench through the general engine gives the template's
// numbers, and invented recipes (a box, a freestanding rack, a stand) give parts and lengths that
// add up, a cut plan that fits, a buy list that matches it, and the owner's stock used first.

const worked = (recipe: unknown, have: readonly string[] = []): Build => {
  const derived = workOutRecipe(BuildRecipe.parse(recipe), have);
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

const refused = (recipe: unknown): string[] => {
  const derived = workOutRecipe(BuildRecipe.parse(recipe));
  if (derived.ok) throw new Error("The recipe was worked out.");
  return derived.error;
};

const template = (): Build => {
  const derived = workOutBench(BenchParameters.parse(goldenBench));
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

/** The parts without what they do in words, which the template says its own way. */
const sized = (parts: readonly Part[]) => parts.map(({ does: _does, ...part }) => part);

/** The buy list's lines by item, without what each is for, which follows the steps' titles. */
const bought = (list: BuyList) =>
  list.lines.map(({ for: _for, ...line }) => line).sort((a, b) => a.item.localeCompare(b.item));

describe("the golden bench through the general engine", () => {
  const recipe = worked(goldenBenchRecipe);
  const bench = template();

  it("gives the template's parts, each at its size and place, and its castors", () => {
    expect(recipe.parts.map((part) => `${part.label} ${part.name} ×${part.count}`)).toEqual([
      "A Legs ×4",
      "B Long rails ×4",
      "C End rails ×4",
      "D Shelf support ×1",
      "E Castor bases ×2",
      "F Top support ×1",
      "G Top ×1",
      "H Shelf ×1",
      "J Braces ×3",
    ]);
    expect(sized(recipe.parts)).toEqual(sized(bench.parts));
    expect(recipe.fitted).toEqual(bench.fitted);
    expect(recipe.size).toEqual(bench.size);
  });

  it("gives the template's cut plan, to every cut and offcut", () => {
    expect(recipe.cutPlan).toEqual(bench.cutPlan);
  });

  it("gives the template's buy list: every count, pack, bolt length and total", () => {
    const needed = Object.fromEntries(recipe.buyList.lines.map((line) => [line.item, line.needed]));
    expect(needed).toMatchObject({
      "5 × 80 screws": 32,
      "40 mm angle brackets": 12,
      "4 × 30 screws": 48,
      // The recipe's 50 mm bolts are too short for all they pass through.
      "M6 × 60 bolts": 16,
      "M6 washers": 16,
      "M6 lock nuts": 16,
      // The shelf's 10, the braces' 12 and the top's 21.
      "4 × 40 screws": 43,
    });
    expect(bought(recipe.buyList)).toEqual(bought(bench.buyList));
    expect(recipe.buyList.total).toBe(bench.buyList.total);
    expect(recipe.buyList.unpriced).toBe(bench.buyList.unpriced);
  });

  it("gives the template's findings, but the tools its steps need (#772), then the checks' (#771)", () => {
    const checks = ["sags", "tips", "racks", "screw-length", "clashes"];
    expect(recipe.findings.filter((finding) => !checks.includes(finding.kind))).toEqual(
      bench.findings.filter((finding) => finding.kind !== "tools-missing"),
    );
    // Its load isn't said, so its shelf is checked under the heaviest, and sags 1 mm over the
    // 460 mm between its rails; its 4 × 40 sheet screws go 22 mm into the rails, short of 6
    // diameters.
    expect(recipe.findings.filter((finding) => checks.includes(finding.kind))).toEqual([
      expect.objectContaining({ kind: "sags", name: "Shelf", span: 460, sag: 1, allowed: 0.8 }),
      ...["shelf to long rails", "braces to end frames", "top to long rails"].map((joint) =>
        expect.objectContaining({ kind: "screw-length", joint, fixes: ["Use 4 × 45 screws"] }),
      ),
    ]);
  });

  it("offers the template's options for each stock, each costed the same", () => {
    const costed = (build: Build) =>
      build.options.map(({ for: _for, ...stock }) => ({
        ...stock,
        choices: stock.choices.map(({ title, buys, total, picked, recommended, says }) => ({
          title,
          buys,
          total,
          picked,
          recommended,
          says,
        })),
      }));
    // The wide timber has only the one option, so it's offered none.
    expect(recipe.options.map((stock) => stock.stock)).toEqual(["45 × 95 C16", "18 mm plywood"]);
    expect(costed(recipe)).toEqual(costed(bench));
  });
});

/** Each part as its letter, name, count and cut size. */
const listed = (build: Build) =>
  build.parts.map(
    (part) => `${part.label} ${part.name} ×${part.count}: ${part.length} × ${part.width}`,
  );

/** How many of each thing the buy list buys. */
const needs = (build: Build) =>
  Object.fromEntries(build.buyList.lines.map((line) => [line.item, line.needed]));

/**
 * The cut plan fits: every length's cuts and saw cuts add up within it, every sheet's pieces sit
 * on it without overlapping, and every piece of every part is cut once, at its size.
 */
const fits = (build: Build) => {
  const { kerf } = build.cutPlan;
  const cut: { label: string; length: number; width?: number }[] = [];
  for (const timber of build.cutPlan.timber) {
    for (const length of timber.lengths) {
      const used =
        length.cuts.reduce((sum, each) => sum + each.length, 0) + kerf * (length.cuts.length - 1);
      expect(length.used).toBeCloseTo(used);
      expect(length.used).toBeLessThanOrEqual(timber.stockLength);
      expect(length.offcut).toBeCloseTo(timber.stockLength - used);
      cut.push(...length.cuts);
    }
  }
  for (const plan of build.cutPlan.sheets) {
    for (const sheet of plan.sheets) {
      sheet.pieces.forEach((piece, index) => {
        expect(piece.x + piece.along).toBeLessThanOrEqual(plan.sheetLength);
        expect(piece.y + piece.across).toBeLessThanOrEqual(plan.sheetWidth);
        for (const other of sheet.pieces.slice(index + 1)) {
          const apart =
            piece.x + piece.along + kerf <= other.x + 1e-9 ||
            other.x + other.along + kerf <= piece.x + 1e-9 ||
            piece.y + piece.across + kerf <= other.y + 1e-9 ||
            other.y + other.across + kerf <= piece.y + 1e-9;
          expect(apart).toBe(true);
        }
        const [length, width] = piece.turned
          ? [piece.across, piece.along]
          : [piece.along, piece.across];
        cut.push({ label: piece.label, length, width });
      });
    }
  }
  for (const part of build.parts) {
    const pieces = cut.filter((each) => each.label === part.label);
    expect(pieces).toHaveLength(part.count);
    for (const piece of pieces) {
      expect(piece.length).toBe(part.length);
      if (piece.width !== undefined) expect(piece.width).toBe(part.width);
    }
  }
};

describe("a box with two shelves on cleats", () => {
  const box = worked(shelfBox);

  it("is a back, two sides, a top and bottom between them, and its shelves and cleats", () => {
    expect(listed(box)).toEqual([
      "A Cupboard back ×1: 800 × 900",
      "B Cupboard top and bottom ×2: 764 × 382",
      "C Lower shelf ×1: 760 × 382",
      "D Upper shelf ×1: 760 × 382",
      "E Cupboard sides ×2: 382 × 900",
      "F Lower shelf cleats ×2: 382 × 50",
      "G Upper shelf cleats ×2: 382 × 50",
    ]);
    // The 864 inside, less the two shelves, in three equal spaces of 276.
    expect(box.parts[2]?.boxes[0]?.z).toBe(294);
    expect(box.parts[3]?.boxes[0]?.z).toBe(588);
    expect(box.size).toEqual({ length: 800, depth: 400, height: 900 });
  });

  it("has a cut plan that fits, and buys the sheets it plans and a screw for every edge", () => {
    fits(box);
    const sheets = box.cutPlan.sheets[0]?.sheets.length;
    expect(needs(box)).toEqual({
      "18 mm plywood, 2440 × 1220": sheets,
      // The back's into the sides (4 each) and top and bottom (3 each), the sides' into the top
      // and bottom (2 each), and 2 through each cleat into its side.
      "4 × 40 screws": 30,
    });
    expect(box.buyList.total).toBe((sheets ?? 0) * 5000 + 420);
  });

  it("takes a worktop screwed down into its sides' and back's edges", () => {
    const overhang = { value: 20, unit: "mm", source: { kind: "measured" } } as const;
    const topped = {
      ...shelfBox,
      pieces: [{ kind: "panel", id: "worktop", stock: "18-mm-plywood", place: "top", overhang }],
    };
    const screwed = worked({
      ...topped,
      joints: [{ kind: "sheet-screwed", joins: ["worktop", "cupboard"], fixing: "4-40-screws" }],
    });
    expect(screwed.parts.find((part) => part.name === "Worktop")).toMatchObject({
      length: 800,
      width: 400,
    });
    fits(screwed);
    // Along the back's top edge (3 across the 800) and each side's (2 across the 400), never
    // into the box's own top under it.
    expect(needs(screwed)["4 × 40 screws"]).toBe((needs(worked(topped))["4 × 40 screws"] ?? 0) + 7);
  });
});

describe("a freestanding rack", () => {
  const built = worked(rack);

  it("is legs, long and end rails, a top, a shelf and a back brace", () => {
    expect(listed(built)).toEqual([
      "A Legs ×4: 982 × 89",
      "B Long rails ×4: 1160 × 89",
      "C End rails ×4: 284 × 89",
      "D Top ×1: 1200 × 400",
      "E Shelf ×1: 902 × 360",
      "F Brace ×1: 284 × 682",
    ]);
    expect(built.size).toEqual({ length: 1200, depth: 400, height: 1000 });
    expect(built.template).toBe("recipe");
  });

  it("cuts its CLS from five lengths, with kerf and offcuts", () => {
    fits(built);
    expect(
      built.cutPlan.timber[0]?.lengths.map((length) => ({
        cuts: length.cuts.map((each) => `${each.label} ${each.length}`),
        offcut: length.offcut,
      })),
    ).toEqual([
      { cuts: ["B 1160", "B 1160"], offcut: 77 },
      { cuts: ["B 1160", "B 1160"], offcut: 77 },
      { cuts: ["A 982", "A 982", "C 284"], offcut: 146 },
      { cuts: ["A 982", "A 982", "C 284"], offcut: 146 },
      { cuts: ["C 284", "C 284"], offcut: 1829 },
    ]);
  });

  it("buys what the cut plan cuts and every joint's screws", () => {
    expect(needs(built)).toEqual({
      "38 × 89 CLS, 2.4 m": 5,
      "18 mm OSB, 2440 × 1220": 1,
      // Two where each rail sits on a leg or an end rail.
      "5 × 70 screws": 32,
      // The shelf's 8, the brace's 4 into the back rails, and the top's 14.
      "4 × 40 screws": 26,
    });
    expect(built.buyList.total).toBe(5 * 630 + 3200 + 480 + 420);
  });

  it("cuts the owner's own offcuts first, so it buys a length fewer", () => {
    const offcuts = {
      kind: "timber",
      id: "cls-offcuts",
      name: "38 × 89 CLS offcut",
      thickness: rack.stock[0].thickness,
      width: rack.stock[0].width,
      length: { value: 1200, unit: "mm", source: { kind: "measured" } },
      have: 2,
    };
    const had = worked({ ...rack, stock: [...rack.stock, offcuts] });
    fits(had);
    expect(had.cutPlan.timber.map((plan) => [plan.stock, plan.lengths.length])).toEqual([
      ["38 × 89 CLS offcut", 2],
      ["38 × 89 CLS", 4],
    ]);
    expect(had.cutPlan.timber[0]?.lengths.map((length) => length.cuts)).toEqual([
      [{ label: "B", length: 1160 }],
      [{ label: "B", length: 1160 }],
    ]);
    expect(needs(had)["38 × 89 CLS, 2.4 m"]).toBe(4);
    expect(needs(had)).not.toHaveProperty(["38 × 89 CLS offcut, 1.2 m"]);
  });

  it("buys no sheet when the owner has one, and only the lengths they don't have", () => {
    const [timber, sheet, ...rest] = rack.stock;
    const had = worked({
      ...rack,
      stock: [{ ...timber, have: 2 }, { ...sheet, have: 1 }, ...rest],
    });
    expect(needs(had)).toEqual({
      "38 × 89 CLS, 2.4 m": 3,
      "5 × 70 screws": 32,
      "4 × 40 screws": 26,
    });
  });

  it("bolts any two pieces that meet: its end rails through the legs", () => {
    const [, ...joints] = rack.joints;
    const m8 = (value: number) => ({
      value,
      unit: "mm",
      source: { kind: "specified", reference: "M8" },
    });
    const bolted = worked({
      ...rack,
      joints: [
        {
          kind: "bolted",
          joins: ["end-frames", "legs"],
          each: 1,
          bolt: { diameter: m8(8), pitch: m8(1.25), length: m8(100) },
          washer: { thickness: m8(1.6), perBolt: 2 },
          nut: { height: m8(6.5) },
        },
        ...joints,
      ],
    });
    const bolts = bolted.buyList.lines.find((line) => line.item.startsWith("M8 ×"));
    // One where each end rail meets a leg, through the rail's 38 and the leg's 89.
    expect(bolts).toMatchObject({ item: "M8 × 140 bolts", needed: 8 });
    expect(bolts?.length?.through).toEqual([
      { what: "end rail", mm: 38 },
      { what: "leg", mm: 89 },
      { what: "M8 washer", mm: 1.6 },
      { what: "M8 washer", mm: 1.6 },
      { what: "M8 lock nut", mm: 6.5 },
      { what: "two threads", mm: 2.5 },
    ]);
    expect(needs(bolted)).toMatchObject({
      "M8 washers": 16,
      "M8 lock nuts": 8,
      "5 × 70 screws": 16,
    });
  });

  it("takes an option picked for its timber, priced from the recipe's options", () => {
    const picked = pickRecipeStock(
      { ...rack, prices: { "c16-45x95": { pence: 680, shop: "Woodstore" } } },
      { stock: "38 × 89 CLS", option: "c16-45x95" },
    );
    if (!picked.ok) throw new Error(picked.error.join("\n"));
    const swapped = worked(picked.value);
    expect(swapped.parts[0]).toMatchObject({
      name: "Legs",
      thickness: 45,
      width: 95,
      material: { kind: "timber", stock: "45 × 95 C16" },
    });
    expect(needs(swapped)["45 × 95 C16, 2.4 m"]).toBeGreaterThan(0);
    // The CLS keeps its price among the options, so picking it again puts it back.
    expect(picked.value.prices["cls-38x89"]).toMatchObject({ pence: 630 });
  });
});

describe("a saw stand on castors", () => {
  const stand = worked(sawStand);

  it("stands on bases with a castor under each end", () => {
    expect(listed(stand)).toEqual([
      "A Legs ×4: 662 × 95",
      "B Long rails ×4: 900 × 95",
      "C Bases ×2: 500 × 145",
      "D Top ×1: 900 × 500",
    ]);
    expect(stand.fitted).toEqual([
      expect.objectContaining({ name: "Rollwell 75 castors", on: "C" }),
    ]);
    expect(stand.fitted[0]?.boxes).toHaveLength(4);
    expect(stand.size).toEqual({ length: 900, depth: 500, height: 800 });
    fits(stand);
  });

  it("buys bolts long enough for all they pass through, and two brackets a rolling leg", () => {
    expect(needs(stand)).toEqual({
      "45 × 95 C16, 2.4 m": 4,
      "45 × 145 C16, 2.4 m": 1,
      "18 mm plywood, 2440 × 1220": 1,
      "Rollwell 75 castors": 4,
      "5 × 80 screws": 16,
      "40 mm angle brackets": 8,
      // The brackets' 32, on the sheet screws as none were given, and the top's 8.
      "4 × 40 screws": 40,
      "M6 × 60 bolts": 16,
      "M6 washers": 16,
      "M6 lock nuts": 16,
    });
    const bolts = stand.buyList.lines.find((line) => line.item === "M6 × 60 bolts");
    expect(bolts?.length?.needed).toBe(56.6);
    // The price given was for the 40 mm bolts, so the 60s have none yet.
    expect(bolts?.total).toBeUndefined();
  });
});

describe("a recipe that can't be placed", () => {
  it("is refused for a shelf in a box on rails", () => {
    const [box, lower, upper] = shelfBox.groups;
    expect(refused({ ...shelfBox, groups: [box, { ...lower, rests: "rails" }, upper] })).toEqual([
      "groups.1: A shelf in a box rests on cleats.",
    ]);
  });

  it("is refused for a joint between pieces that don't touch", () => {
    expect(
      refused({
        ...rack,
        joints: [
          ...rack.joints,
          { kind: "screwed", joins: ["shelf", "legs"], fixing: "5-70-screws" },
        ],
      }),
    ).toEqual([`joints.5: "shelf" and "legs" don't meet: a joint holds two pieces that touch.`]);
  });

  it("is refused when too low for its top and what it stands on", () => {
    const low = { ...sawStand.size.height, value: 120 };
    expect(refused({ ...sawStand, size: { ...sawStand.size, height: low } })).toContain(
      "The build is too low for its top and what it stands on.",
    );
  });

  it("is refused for standing on both legs and a box", () => {
    const both = {
      ...rack,
      stock: [...rack.stock, shelfBox.stock[0]],
      groups: [...rack.groups, shelfBox.groups[0]],
    };
    expect(refused(both)).toEqual([
      "recipe: A recipe stands on one set of legs or one box, and this has 2.",
    ]);
  });
});
