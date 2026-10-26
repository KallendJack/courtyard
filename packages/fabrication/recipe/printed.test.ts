import { BuildRecipe } from "@courtyard/contract";
import { describe, expect, it } from "vitest";
import type { Build, Part } from "../build.ts";
import { makePart } from "../print/make.ts";
import { sawStand } from "./fixtures/invented.ts";
import { workOutRecipe } from "./work-out.ts";

// Printed parts in a wooden build (#773): a holder or bracket is a piece the recipe names by which
// part, the stock it fits and where it goes; code sizes it from that stock, with the printer's
// clearance, so changing the timber resizes it.

const measured = (value: number) => ({ value, unit: "mm", source: { kind: "measured" } }) as const;

const screws = { kind: "fixing", id: "4-30-screws", name: "4 × 30 screws" } as const;

/** The saw stand with four holders its 45 × 95 drops into, and two brackets its top sits in. */
const withPrinted = (changes: { stock?: unknown[]; printer?: unknown } = {}) => ({
  ...sawStand,
  stock: changes.stock ?? [...sawStand.stock, screws],
  pieces: [
    ...sawStand.pieces,
    {
      kind: "printed",
      id: "timber-holders",
      part: "holder",
      fits: "45-95-c16",
      on: "long-rails",
      count: 4,
      screws: "4-30-screws",
    },
    {
      kind: "printed",
      id: "top-brackets",
      part: "bracket",
      fits: "18-mm-plywood",
      on: "legs",
      count: 2,
    },
  ],
  ...(changes.printer === undefined ? {} : { printer: changes.printer }),
});

const worked = (recipe: unknown): Build => {
  const derived = workOutRecipe(BuildRecipe.parse(recipe));
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

const part = (build: Build, name: string): Part => {
  const found = build.parts.find((each) => each.name === name);
  if (found === undefined) throw new Error(`No part called ${name}.`);
  return found;
};

const line = (found: Part, name: string) =>
  found.print?.sizes.find((size) => size.name === name)?.says;

describe("a holder sized from the timber it fits", () => {
  it("gets a pocket for 45 × 95 with the printer's clearance: 45.4 × 95.4 at 0.2", () => {
    const holders = part(worked(withPrinted()), "Timber holders");
    expect(holders.material.kind).toBe("printed");
    expect(holders.count).toBe(4);
    expect(line(holders, "Pocket")).toBe("45.4 × 95.4 mm");
    expect(holders.print?.clearance.value).toBe(0.2);
  });

  it("is made with that pocket, walls round it and a floor under it", async () => {
    const holders = part(worked(withPrinted()), "Timber holders");
    const recipe = holders.print?.recipe;
    if (!recipe) throw new Error("The holder can't be made.");
    const made = await makePart(recipe);
    if (!made.ok) throw new Error(made.error.join("\n"));
    // 95.4 + two 4 mm walls across, 45.4 + two walls front to back, 30.2 deep on a 4 mm floor.
    expect(made.value.size).toEqual({ length: 103.4, depth: 53.4, height: 34.2 });
    expect(made.value.watertight).toBe(true);
    expect([holders.length, holders.width, holders.thickness]).toEqual([103.4, 53.4, 34.2]);
  });

  it("resizes when the timber changes", () => {
    const stock = [...sawStand.stock, screws].map((item) =>
      item.id === "45-95-c16"
        ? {
            ...item,
            name: "38 × 89 CLS",
            thickness: measured(38),
            width: measured(89),
          }
        : item,
    );
    const holders = part(worked(withPrinted({ stock })), "Timber holders");
    expect(line(holders, "Pocket")).toBe("38.4 × 89.4 mm");
    expect([holders.length, holders.width]).toEqual([97.4, 46.4]);
  });

  it("allows the printer's own clearance once it's calibrated", () => {
    const printer = { clearance: { value: 0.3, unit: "mm", source: { kind: "measured" } } };
    const holders = part(worked(withPrinted({ printer })), "Timber holders");
    expect(line(holders, "Pocket")).toBe("45.6 × 95.6 mm");
  });
});

describe("a bracket sized from the sheet it fits", () => {
  it("gets a slot as thick as the plywood, with the clearance each side", () => {
    const brackets = part(worked(withPrinted()), "Top brackets");
    expect(line(brackets, "Slot")).toBe("18.4 mm");
    expect(brackets.count).toBe(2);
  });
});

describe("the Build carries them", () => {
  const build = worked(withPrinted());

  it("letters them after the parts that are cut, and leaves them out of the cut plan", () => {
    expect(build.parts.slice(-2).map((each) => each.name)).toEqual([
      "Timber holders",
      "Top brackets",
    ]);
    const cut = [...build.cutPlan.timber.flatMap((each) => each.lengths.flatMap((l) => l.cuts))];
    const printed = build.parts.filter((each) => each.material.kind === "printed");
    expect(cut.some((c) => printed.some((each) => each.label === c.label))).toBe(false);
  });

  it("buys the filament and the screws through them", () => {
    const filament = build.buyList.lines.find((each) => each.kind === "filament");
    expect(filament?.item).toBe("PLA filament, 1 kg reel");
    const screwLine = build.buyList.lines.find((each) => each.item === "4 × 30 screws");
    expect(screwLine?.needed).toBe(8);
  });

  it("says to print them first and fit them once what they go on is built", () => {
    const ids = build.steps.map((step) => step.id);
    expect(ids).toEqual([
      "print-timber-holders",
      "print-top-brackets",
      "fit-timber-holders",
      "fit-top-brackets",
    ]);
    expect(build.steps.map((step) => step.number)).toEqual([1, 2, 3, 4]);
    const fit = build.steps.find((step) => step.id === "fit-timber-holders");
    expect(fit?.adds).toEqual([part(build, "Timber holders").label]);
    expect(fit?.fixings).toEqual([{ name: "4 × 30 screws", count: 8 }]);
  });
});

describe("what a printed piece is refused for", () => {
  it("a holder for a sheet", () => {
    const recipe = withPrinted();
    const parsed = BuildRecipe.safeParse({
      ...recipe,
      pieces: recipe.pieces.map((piece) =>
        piece.kind === "printed" && piece.part === "holder"
          ? { ...piece, fits: "18-mm-plywood" }
          : piece,
      ),
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
      `"18-mm-plywood" is a sheet: a holder takes a timber's end.`,
    );
  });

  it("screws whose size isn't in their name", () => {
    const stock = [...sawStand.stock, { ...screws, name: "Wood screws" }];
    const derived = workOutRecipe(BuildRecipe.parse(withPrinted({ stock })));
    expect(derived.ok).toBe(false);
    if (derived.ok) return;
    expect(derived.error).toEqual([
      `pieces.3.screws: Say the screws' size in their name, as "4 × 30 screws", so the holes fit them.`,
    ]);
  });
});
