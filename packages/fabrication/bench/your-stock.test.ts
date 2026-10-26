import { describe, expect, it } from "vitest";
import type { Build, BuildSetting } from "../build.ts";
import { goldenBench } from "./fixtures/golden.ts";
import { deriveBench } from "./index.ts";

// Your stock (#760): what the owner has for making comes off the buy list, so it lists only what's
// left to buy. The golden bench's list, worked out by hand in `bench.test.ts`, totals £177.02.

const built = (setting: BuildSetting): Build => {
  const derived = deriveBench(goldenBench, setting);
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

const line = (build: Build, item: string) => build.buyList.lines.find((each) => each.item === item);

describe("the buy list less Your stock", () => {
  it("drops a line the owner has enough of: a case of 100 covers the 32 screws", () => {
    const build = built({ stock: [{ name: "5 × 80 screws", count: 100 }] });

    expect(line(build, "5 × 80 screws")).toBeUndefined();
    expect(build.buyList.had.map((each) => [each.item, each.needed])).toEqual([
      ["5 × 80 screws", 32],
    ]);
    expect(build.buyList.lines).toHaveLength(10);
    expect(build.buyList.total).toBe(17702 - 520);
    expect(build.buyList.unpriced).toBe(1);
  });

  it("buys only the shortfall of a line partly covered, in whole packs", () => {
    const build = built({
      stock: [
        { name: "45 × 95 C16, 2.4 m", count: 2 },
        { name: "4 × 40 screws", count: 20 },
      ],
    });

    // Five lengths at £6.80 less the two to hand: three.
    expect(line(build, "45 × 95 C16, 2.4 m")).toMatchObject({
      needed: 3,
      packs: 3,
      have: 2,
      total: 2040,
    });
    // 43 less 20 is 23, still one box of 100.
    expect(line(build, "4 × 40 screws")).toMatchObject({
      needed: 23,
      packs: 1,
      have: 20,
      total: 420,
    });
    expect(build.buyList.had).toEqual([]);
    expect(build.buyList.total).toBe(17702 - 3400 + 2040);
  });

  it("reads the owner's names loosely: 5x80 screws are 5 × 80 screws", () => {
    const build = built({ stock: [{ name: "5x80  Screws", count: 32 }] });

    expect(line(build, "5 × 80 screws")).toBeUndefined();
  });

  it("never takes a tool to buy off, nor a fixing of another size", () => {
    const build = built({ stock: [{ name: "5 × 70 screws", count: 100 }] });

    expect(line(build, "5 × 80 screws")).toMatchObject({ needed: 32 });
    expect(build.buyList.had).toEqual([]);
  });

  it("has the steps say where a fixing comes from: from your Diall case", () => {
    const build = built({ stock: [{ name: "5 × 80 screws", count: 100, where: "Diall case" }] });
    const fixings = build.steps.flatMap((step) => step.fixings);

    expect(fixings.filter((fixing) => fixing.name === "5 × 80 screws")).not.toEqual([]);
    for (const fixing of fixings) {
      expect(fixing.from).toBe(fixing.name === "5 × 80 screws" ? "Diall case" : undefined);
    }
  });

  it("is the whole list with no stock", () => {
    const build = built({});

    expect(build.buyList.lines).toHaveLength(11);
    expect(build.buyList.had).toEqual([]);
    expect(build.buyList.lines.every((each) => each.have === undefined)).toBe(true);
  });
});
