import { describe, expect, it } from "vitest";
import type { Build } from "../build.ts";
import { goldenBench } from "./fixtures/golden.ts";
import { deriveBench } from "./index.ts";

// The framed bench, through the one function a caller has: parameters in, a Build out. The
// expected numbers are the ones worked out by hand for the real bench (#696), not recomputed.

const built = (parameters: unknown): Build => {
  const derived = deriveBench(parameters);
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

const partSizes = (build: Build) =>
  Object.fromEntries(
    build.parts.map((part) => [
      part.label,
      [part.count, part.length, part.width, part.thickness, part.material.stock],
    ]),
  );

describe("the golden bench's parts", () => {
  it("are the hand-worked parts, each cut to its size from its stock", () => {
    expect(partSizes(built(goldenBench))).toEqual({
      A: [4, 750, 95, 45, "45 × 95 C16"],
      B: [4, 1450, 95, 45, "45 × 95 C16"],
      C: [4, 460, 95, 45, "45 × 95 C16"],
      D: [1, 460, 95, 45, "45 × 95 C16"],
      E: [2, 550, 145, 45, "45 × 145 C16"],
      F: [1, 460, 145, 45, "45 × 145 C16"],
      G: [1, 1500, 600, 18, "18 mm plywood"],
      H: [1, 1166, 550, 18, "18 mm plywood"],
      J: [3, 460, 500, 18, "18 mm plywood"],
    });
  });

  it("leave 1170 between the end frames, so the 1166 shelf has 4 mm to spare", () => {
    const build = built(goldenBench);
    const ends = build.parts.find((part) => part.label === "C")?.boxes ?? [];
    const inner = ends.map((box) => box.x).sort((a, b) => a - b);
    const shelf = build.parts.find((part) => part.label === "H")?.boxes[0];

    // The upper and lower rails at each end share an x: the inner faces are the second pair's
    // start and the first pair's end.
    const left = (inner[0] ?? 0) + 45;
    const right = inner[2] ?? 0;
    expect(right - left).toBe(1170);
    expect(shelf?.x).toBe(left + 2);
    expect(shelf?.w).toBe(1166);
  });

  it("give a box for every piece, inside the bench's outline", () => {
    const build = built(goldenBench);
    for (const part of build.parts) {
      expect(part.boxes).toHaveLength(part.count);
      for (const box of part.boxes) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(1500);
        expect(box.y + box.d).toBeLessThanOrEqual(600);
        expect(box.z + box.h).toBeLessThanOrEqual(900);
      }
    }
    expect(build.size).toEqual({ length: 1500, depth: 600, height: 899.6 });
  });
});

describe("the golden bench's cut plan", () => {
  it("is the hand-checked plan, a 3 mm cut between pieces", () => {
    const plan = built(goldenBench).cutPlan;

    expect(
      plan.timber.map((timber) => [
        timber.stock,
        timber.lengths.map((length) => [
          length.cuts.map((cut) => `${cut.label} ${cut.length}`).join(" + "),
          length.used,
        ]),
      ]),
    ).toEqual([
      [
        "45 × 95 C16",
        [
          ["B 1450 + A 750", 2203],
          ["B 1450 + A 750", 2203],
          ["B 1450 + A 750", 2203],
          ["B 1450 + A 750", 2203],
          ["C 460 + C 460 + C 460 + C 460 + D 460", 2312],
        ],
      ],
      ["45 × 145 C16", [["E 550 + E 550 + F 460", 1566]]],
    ]);
    expect(plan.sheets).toHaveLength(1);
    expect(plan.sheets[0]?.sheets).toHaveLength(1);
    expect(plan.sheets[0]?.sheets[0]?.pieces.map((piece) => piece.label).sort()).toEqual([
      "G",
      "H",
      "J",
      "J",
      "J",
    ]);
  });
});

describe("the golden bench's buy list", () => {
  it("buys whole lengths, sheets and packs, and totals the priced lines", () => {
    const list = built(goldenBench).buyList;

    expect(list.lines.map((line) => [line.item, line.needed, line.packs, line.total])).toEqual([
      ["45 × 95 C16, 2.4 m", 5, 5, 3400],
      ["45 × 145 C16, 2.4 m", 1, 1, 1200],
      ["18 mm plywood, 2440 × 1220", 1, 1, 5000],
      ["Wheelwright TD60 castors", 4, 1, 4999],
      ["M6 × 50 bolts", 16, 16, 240],
      ["M6 washers", 32, 1, 365],
      ["M6 lock nuts", 16, 1, 350],
      ["5 × 80 screws", 32, 1, 520],
      ["40 mm angle brackets", 8, 8, 712],
      ["4 × 40 screws", 43, 1, 420],
    ]);
    expect(list.total).toBe(17206);
    expect(list.unpriced).toBe(0);
  });

  it("lists a line with no price and leaves it out of the total", () => {
    const { price: _price, ...unpriced } = goldenBench.fixings.brackets;
    const list = built({
      ...goldenBench,
      fixings: { ...goldenBench.fixings, brackets: unpriced },
    }).buyList;

    expect(list.lines.find((line) => line.item === "40 mm angle brackets")).toMatchObject({
      needed: 8,
    });
    expect(list.total).toBe(17206 - 712);
    expect(list.unpriced).toBe(1);
  });
});

describe("the making rules", () => {
  it("flag the M6 × 50 castor bolts as too short for what they pass through", () => {
    const found = built(goldenBench).findings.find(
      (finding) => finding.kind === "fixing-too-short",
    );

    // 4 plate + 45 base + 2 × 1.6 washers + 5 nut + 2 threads at 1 mm.
    expect(found).toMatchObject({ fixing: "M6 × 50 bolts", length: 50, needed: 59.2, use: 60 });
  });

  it("pass a bolt long enough", () => {
    const longer = {
      ...goldenBench,
      castors: {
        ...goldenBench.castors,
        bolt: {
          ...goldenBench.castors.bolt,
          length: { ...goldenBench.castors.bolt.length, value: 60 },
        },
      },
    };

    expect(built(longer).findings.map((finding) => finding.kind)).not.toContain("fixing-too-short");
  });

  it("list the tools the steps need that aren't to hand, with their steps", () => {
    const found = built(goldenBench).findings.find((finding) => finding.kind === "tools-missing");

    expect(found).toEqual({
      kind: "tools-missing",
      tools: [
        { tool: "spanner", name: "Spanner", steps: [4] },
        { tool: "spirit-level", name: "Spirit level", steps: [12] },
      ],
    });
  });

  it("list the assumed sizes, to check before cutting", () => {
    expect(built(goldenBench).findings.find((finding) => finding.kind === "assumed")).toEqual({
      kind: "assumed",
      sizes: ["kerf", "top.overhang"],
    });
  });

  it("refuse a size with no source", () => {
    const derived = deriveBench({ ...goldenBench, height: { value: 900, unit: "mm" } });

    expect(derived).toEqual({ ok: false, error: [expect.stringContaining("height.source")] });
  });

  it("refuse a size given as words", () => {
    const derived = deriveBench({ ...goldenBench, length: "1500 mm" });

    expect(derived.ok).toBe(false);
  });

  it("refuse a bench too low for its castors", () => {
    const derived = deriveBench({ ...goldenBench, height: { ...goldenBench.height, value: 120 } });

    expect(derived).toEqual({ ok: false, error: [expect.stringContaining("too low")] });
  });

  it("find a part too big for its stock, and leave it out of the plan", () => {
    const build = built({ ...goldenBench, length: { ...goldenBench.length, value: 2600 } });

    expect(build.findings).toContainEqual({
      kind: "too-big-for-stock",
      label: "B",
      stock: "45 × 95 C16",
    });
    expect(build.cutPlan.timber[0]?.lengths.flatMap((length) => length.cuts)).not.toContainEqual(
      expect.objectContaining({ label: "B" }),
    );
  });
});

describe("changing one parameter", () => {
  const changed = (before: Build, after: Build) =>
    Object.keys(partSizes(before)).filter(
      (label) =>
        JSON.stringify(partSizes(before)[label]) !== JSON.stringify(partSizes(after)[label]),
    );

  it("300 mm longer changes the long rails, the top and the shelf, and nothing else", () => {
    const before = built(goldenBench);
    const after = built({ ...goldenBench, length: { ...goldenBench.length, value: 1800 } });

    expect(changed(before, after)).toEqual(["B", "G", "H"]);
    expect(partSizes(after).B?.[1]).toBe(1750);
    expect(partSizes(after).G?.[1]).toBe(1800);
    expect(partSizes(after).H?.[1]).toBe(1466);
    expect(after.size.height).toBe(before.size.height);
  });

  it("castors 87 mm taller shorten the legs and the end braces by 87, and nothing else", () => {
    const before = built(goldenBench);
    const taller = {
      ...goldenBench,
      castors: {
        ...goldenBench.castors,
        height: { ...goldenBench.castors.height, value: 86.6 + 87 },
      },
    };
    const after = built(taller);

    expect(changed(before, after)).toEqual(["A", "J"]);
    expect(partSizes(after).A?.[1]).toBe(663);
    expect(partSizes(after).J?.[2]).toBe(413);
    expect(after.buyList.total).toBe(before.buyList.total);
  });

  it("taking the castors off drops the bases, the castors and their bolts, and lengthens the legs", () => {
    const after = built({ ...goldenBench, castors: null });

    expect(partSizes(after).A?.[1]).toBe(882);
    expect(partSizes(after).E).toBeUndefined();
    expect(after.buyList.lines.map((line) => line.item)).not.toContain("M6 × 50 bolts");
    expect(after.steps.map((step) => step.title)).not.toContain("Fit the castors to the bases");
    expect(after.size.height).toBe(900);
  });

  it("leaving the castors out is the same as taking them off, as a merge patch's null does (#697)", () => {
    const { castors: _castors, ...withoutCastors } = goldenBench;

    expect(built(withoutCastors)).toEqual(built({ ...goldenBench, castors: null }));
  });
});

describe("the golden bench's steps", () => {
  it("are the twelve steps in the order it's built, each with its parts", () => {
    expect(built(goldenBench).steps.map((step) => [step.number, step.title, step.parts])).toEqual([
      [1, "Check what's arrived", []],
      [2, "Mark the lengths", ["A", "B", "C", "D", "E", "F"]],
      [3, "Cut and label the timber", ["A", "B", "C", "D", "E", "F"]],
      [4, "Fit the castors to the bases", ["E"]],
      [5, "Make the two end frames", ["A", "C"]],
      [6, "Join the end frames with the long rails", ["B"]],
      [7, "Stand the frame on its bases", ["E"]],
      [8, "Fit the supports", ["F", "D"]],
      [9, "Fit the shelf", ["H"]],
      [10, "Fit the braces", ["J"]],
      [11, "Fit the top", ["G"]],
      [12, "Check the bench", []],
    ]);
  });

  it("cut with the hand saw on the folding workbench, until a circular saw is to hand", () => {
    const cutStep = (build: Build) => build.steps.find((step) => step.title.startsWith("Cut"));
    const handSaw = cutStep(built(goldenBench));
    const circular = cutStep(
      built({ ...goldenBench, tools: [...goldenBench.tools, "circular-saw", "ear-defenders"] }),
    );

    expect(handSaw?.tools.map((tool) => tool.tool)).toContain("folding-workbench");
    expect(handSaw?.actions[0]?.howTo).toContain("waste side");
    expect(handSaw?.actions[0]?.howTo).toContain("hold the offcut");
    expect(circular?.tools.map((tool) => tool.tool)).toContain("circular-saw");
    expect(circular?.safety.map((tool) => tool.tool)).toEqual(["safety-glasses", "ear-defenders"]);
    expect(circular?.actions[0]?.howTo).not.toEqual(handSaw?.actions[0]?.howTo);
  });

  it("say every action twice, show me how and just the numbers", () => {
    for (const step of built(goldenBench).steps) {
      expect(step.actions.length).toBeGreaterThan(0);
      for (const action of step.actions) {
        expect(action.howTo.length).toBeGreaterThan(action.numbers.length);
        expect(action.numbers.length).toBeGreaterThan(0);
      }
    }
  });

  it("make the end frames with their sizes, two screws a joint and a check for square", () => {
    const step = built(goldenBench).steps.find((step) => step.number === 5);

    expect(step?.fixings).toEqual([{ name: "5 × 80 screws", count: 16 }]);
    expect(step?.safety.map((tool) => tool.tool)).toEqual(["safety-glasses"]);
    expect(step?.closeUp?.dimensions.map((line) => line.mm)).toEqual([460, 750, 250]);
    expect(step?.closeUp?.fixings).toHaveLength(8);
    expect(step?.check.says).toBe(
      "Measure corner to corner both ways. The same within 2 mm means it's square.",
    );
    expect(step?.words).toEqual(["flush", "square", "pilot hole"]);
  });

  it("need a helper to stand the frame up", () => {
    const helped = built(goldenBench)
      .steps.filter((step) => step.helper)
      .map((step) => step.number);

    expect(helped).toEqual([6, 7]);
  });

  it("point every word they use into the glossary", () => {
    const build = built(goldenBench);
    const words = build.glossary.map((entry) => entry.word);

    for (const step of build.steps) for (const word of step.words) expect(words).toContain(word);
    expect(build.glossary.find((entry) => entry.word === "pilot hole")?.means).toBe(
      "A small hole drilled first, so the screw goes in straight and the wood doesn't split.",
    );
  });
});
