import { describe, expect, it } from "vitest";
import { goldenBench } from "../bench/fixtures/golden.ts";
import type { Build } from "../build.ts";
import { goldenHolster } from "../print/fixtures/golden.ts";
import { derivePrinted } from "../print/index.ts";
import { deriveBench } from "../recipe/starters.ts";

// The parts page and each step's uses (#778): like a flat pack's inventory, every piece and the
// fixings bag before the steps, and each step laying out exactly what it takes.

const built = (parameters: unknown): Build => {
  const derived = deriveBench(parameters);
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

/** The golden bench, and one with each choice that changes its steps the other way. */
const benches = () => [
  built(goldenBench),
  built({ ...goldenBench, castors: null }),
  built({
    ...goldenBench,
    shelf: { ...goldenBench.shelf, on: !goldenBench.shelf.on },
    braces: { ...goldenBench.braces, ends: true, rear: true },
  }),
];

/** Counts added up by name. */
const tally = (counted: readonly { name: string; count: number }[]) => {
  const sums = new Map<string, number>();
  for (const { name, count } of counted) sums.set(name, (sums.get(name) ?? 0) + count);
  return Object.fromEntries([...sums].sort(([a], [b]) => a.localeCompare(b)));
};

describe("each step's uses (#778)", () => {
  it("add up to the Build's parts exactly: every piece used once", () => {
    for (const build of benches()) {
      const used = build.steps.flatMap((step) =>
        step.uses.parts.map((part) => ({ name: part.label, count: part.count })),
      );
      expect(tally(used)).toEqual(
        tally(build.parts.map((part) => ({ name: part.label, count: part.count }))),
      );
    }
  });

  it("add up to the fixings bag exactly", () => {
    for (const build of benches()) {
      const used = build.steps.flatMap((step) => step.uses.fixings);
      expect(tally(used)).toEqual(tally(build.bag.flatMap((item) => item.of)));
    }
  });

  it("read as the step lays them out: the end frames' legs, rails and screws; the castors with their bolts", () => {
    const build = built(goldenBench);
    const uses = (id: string) => build.steps.find((step) => step.id === id)?.uses;

    expect(uses("end-frames")).toEqual({
      parts: [
        { label: "A", count: 4 },
        { label: "C", count: 4 },
      ],
      fixings: [{ name: "5 × 80 screws", count: 16 }],
    });
    expect(uses("fit-castors")?.fixings).toEqual([
      { name: "M6 × 60 bolts", count: 16 },
      { name: "M6 washers", count: 16 },
      { name: "M6 lock nuts", count: 16 },
      { name: "Wheelwright TD60 castors", count: 4 },
    ]);
    // Marking and cutting make the pieces; they put none on.
    expect(uses("cut-timber")).toEqual({ parts: [], fixings: [] });
  });
});

describe("the fixings bag (#778)", () => {
  it("has each fixing type by its count, a bolt with its washer and nut as one bolt set", () => {
    const bag = built(goldenBench).bag.map((item) => [item.kind, item.name, item.count]);

    expect(bag).toEqual([
      ["screw", "5 × 80 screws", 32],
      ["bolt-set", "M6 × 60 bolt sets", 16],
      ["bracket", "40 mm angle brackets", 12],
      ["screw", "4 × 30 screws", 48],
      ["screw", "4 × 40 screws", 43],
      ["castor", "Wheelwright TD60 castors", 4],
    ]);
    const bolts = built(goldenBench).bag.find((item) => item.kind === "bolt-set");
    expect(bolts?.of).toEqual([
      { name: "M6 × 60 bolts", count: 16 },
      { name: "M6 washers", count: 16 },
      { name: "M6 lock nuts", count: 16 },
    ]);
  });

  it("is a printed part's screws, and nothing for the filament", () => {
    const holster = derivePrinted("battery-holster")(goldenHolster);
    if (!holster.ok) throw new Error(holster.error.join("\n"));

    expect(holster.value.bag.map((item) => item.kind)).toEqual(["screw"]);
  });
});
