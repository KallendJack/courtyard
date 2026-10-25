import { describe, expect, it } from "vitest";
import type { Build, Finding } from "../build.ts";
import { derivePrinted } from "./index.ts";

// A part recipe as a model writes it (#702): checked before anything is made, so what can't be
// made is refused with a finding naming why, and the part isn't made.

const SCREW = {
  name: "4 mm screws",
  diameter: { value: 4, unit: "mm", source: { kind: "measured" } },
};

const part = (recipe: unknown, extra: Record<string, unknown> = {}): Build => {
  const derived = derivePrinted("printed-part")({ part: "Test part", recipe, ...extra });
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

const refusal = (build: Build) =>
  build.findings.find(
    (finding): finding is Extract<Finding, { kind: "cannot-make" }> =>
      finding.kind === "cannot-make",
  );

const PLATE = { kind: "plate", width: 60, depth: 40, thickness: 5 };

describe("a part recipe", () => {
  it("is made when every feature is known and on the part", () => {
    const build = part({
      base: PLATE,
      features: [{ kind: "hole", face: "top", at: { u: 30, v: 20 }, screw: SCREW }],
    });
    expect(refusal(build)).toBeUndefined();
    expect(build.print?.recipe?.features).toHaveLength(1);
  });

  it("refuses a feature of a kind no recipe knows, naming it, and isn't made", () => {
    const build = part({ base: PLATE, features: [{ kind: "knurl", face: "top" }] });
    expect(build.print?.recipe).toBeNull();
    expect(refusal(build)?.problems).toEqual([
      "Feature 1 is a knurl, which no recipe knows: use hole, slot, pocket, fillet, chamfer, text.",
    ]);
  });

  it("refuses a hole bigger than its face, and isn't made", () => {
    const build = part({
      base: PLATE,
      features: [
        {
          kind: "hole",
          face: "front",
          at: { u: 30, v: 2.5 },
          screw: { ...SCREW, diameter: { ...SCREW.diameter, value: 6 } },
        },
      ],
    });
    expect(build.print?.recipe).toBeNull();
    expect(refusal(build)?.problems).toEqual([
      "The hole for the 4 mm screws (6.4 mm) is bigger than the front it's on: 6.4 × 6.4 mm on a face of 60 × 5 mm.",
    ]);
  });

  it("refuses a hole running off its face", () => {
    const build = part({
      base: PLATE,
      features: [{ kind: "hole", face: "top", at: { u: 1, v: 20 }, screw: SCREW }],
    });
    expect(refusal(build)?.problems[0]).toMatch(/runs off the top/);
  });

  it("refuses a pocket that runs out of its face where it isn't open", () => {
    const pocket = (open: string[]) =>
      part({
        base: { kind: "box", width: 30, depth: 30, height: 20 },
        features: [
          {
            kind: "pocket",
            face: "top",
            at: { u: 15, v: 10 },
            object: {
              name: "tin",
              width: { value: 20, unit: "mm", source: { kind: "measured" } },
              height: { value: 25, unit: "mm", source: { kind: "measured" } },
              depth: { value: 10, unit: "mm", source: { kind: "measured" } },
            },
            open,
          },
        ],
      });
    expect(refusal(pocket([]))?.problems[0]).toMatch(/runs out of the top down/);
    expect(refusal(pocket(["down"]))).toBeUndefined();
  });

  it("finds a wall thinner than two lines of the nozzle, and still makes it", () => {
    const build = part({
      base: { kind: "box", width: 20.8, depth: 30, height: 20 },
      features: [
        {
          kind: "pocket",
          face: "top",
          object: {
            name: "tin",
            width: { value: 20, unit: "mm", source: { kind: "measured" } },
            height: { value: 20, unit: "mm", source: { kind: "measured" } },
            depth: { value: 10, unit: "mm", source: { kind: "measured" } },
          },
        },
      ],
    });
    expect(build.print?.recipe).not.toBeNull();
    expect(build.findings).toContainEqual({
      kind: "wall-too-thin",
      where: "The wall left of the tin",
      mm: 0.2,
      least: 0.8,
    });
  });

  it("finds a part bigger than the plate", () => {
    const build = part({ base: { kind: "plate", width: 300, depth: 40, thickness: 5 } });
    expect(build.print?.fits).toBe(false);
    expect(build.findings).toContainEqual({
      kind: "too-big-for-plate",
      size: { length: 300, depth: 40, height: 5 },
      plate: { width: 256, depth: 256, height: 256 },
    });
  });

  it("refuses a fillet or chamfer of half the part or more, which would leave nothing", () => {
    for (const feature of [
      { kind: "fillet", radius: 20 },
      { kind: "chamfer", size: 20 },
    ]) {
      const build = part({ base: PLATE, features: [feature] });
      expect(build.print?.recipe).toBeNull();
      expect(refusal(build)?.problems[0]).toMatch(/of 20 mm is half the part's 40 mm or more/);
    }
    expect(
      refusal(part({ base: PLATE, features: [{ kind: "fillet", radius: 19.9 }] })),
    ).toBeUndefined();
  });

  it("is refused with more lettering than makes in seconds: 10 lines, 200 letters in all", () => {
    const line = (text: string) => ({
      kind: "text",
      face: "top",
      text,
      size: 5,
      depth: 1,
      style: "cut",
    });
    const base = { kind: "box", width: 1000, depth: 1000, height: 100 };
    const derived = (features: unknown[]) =>
      derivePrinted("printed-part")({ part: "Sign", recipe: { base, features } });
    expect(derived(Array.from({ length: 10 }, () => line("x".repeat(20)))).ok).toBe(true);
    expect(derived(Array.from({ length: 11 }, () => line("Tools")))).toEqual({
      ok: false,
      error: [
        "recipe.features: A part has at most 10 lines of lettering, and this has 11: put the rest on another part.",
      ],
    });
    expect(derived(Array.from({ length: 3 }, () => line("x".repeat(80))))).toEqual({
      ok: false,
      error: [
        "recipe.features: A part has at most 200 letters of lettering in all, and this has 240: make it shorter, or put some on another part.",
      ],
    });
  });

  it("is refused unread when a feature's kind is longer than any kind's name", () => {
    const derived = derivePrinted("printed-part")({
      part: "Test part",
      recipe: { base: PLATE, features: [{ kind: "k".repeat(41) }] },
    });
    expect(derived.ok).toBe(false);
  });

  it("is refused unread when its base isn't one of the four", () => {
    const derived = derivePrinted("printed-part")({
      part: "Test part",
      recipe: { base: { kind: "sphere", diameter: 20 } },
    });
    expect(derived.ok).toBe(false);
  });
});
