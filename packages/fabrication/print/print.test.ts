import { describe, expect, it } from "vitest";
import type { Build } from "../build.ts";
import { to3mf, toStl } from "./files.ts";
import { goldenHolster, goldenShim } from "./fixtures/golden.ts";
import { derivePrinted } from "./index.ts";
import { type Made, makePart } from "./make.ts";

// The golden printed parts (#702), through what a caller has: a template's parameters in, a Build
// out, and its recipe made into a solid. The expected sizes and volumes are worked out by hand
// from the parameters, not by the code under test.

const built = (template: Parameters<typeof derivePrinted>[0], parameters: unknown): Build => {
  const derived = derivePrinted(template)(parameters);
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

const made = async (build: Build): Promise<Made> => {
  const recipe = build.print?.recipe;
  if (!recipe) throw new Error(JSON.stringify(build.findings));
  const part = await makePart(recipe);
  if (!part.ok) throw new Error(part.error.join("\n"));
  return part.value;
};

/** Whether every edge of the mesh is shared by exactly two triangles, once each way: closed. */
const closedAllRound = ({ triangles }: Made) => {
  const edges = new Map<string, number>();
  for (let at = 0; at < triangles.length; at += 3) {
    const corners = [triangles[at], triangles[at + 1], triangles[at + 2]];
    for (let side = 0; side < 3; side += 1) {
      const key = `${corners[side]}>${corners[(side + 1) % 3]}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return [...edges].every(([key, count]) => {
    const [from, to] = key.split(">");
    return count === 1 && edges.get(`${to}>${from}`) === 1;
  });
};

/** A 48-sided hole's area, as the part's holes are cut. */
const holeArea = (diameter: number) => 24 * (diameter / 2) ** 2 * Math.sin((2 * Math.PI) / 48);

const withoutScrews = { ...goldenHolster, screws: null };

describe("the golden holster", () => {
  // 76 + 2 × 0.2 + 2 × 4 across, 115 + 0.2 + 4 front to back (open at the front), 66 + 0.2 + 4 up.
  const SIZE = { length: 84.4, depth: 119.2, height: 70.2 };

  it("is the battery's size with the clearance and walls round it", async () => {
    const build = built("battery-holster", goldenHolster);
    expect(build.size).toEqual(SIZE);
    expect((await made(build)).size).toEqual(SIZE);
  });

  it("is a box less a pocket of the battery's size with the clearance, closed all round", async () => {
    const part = await made(built("battery-holster", withoutScrews));
    const pocket = (76 + 0.4) * (115 + 0.2) * (66 + 0.2);
    expect(part.volume).toBeCloseTo(84.4 * 119.2 * 70.2 - pocket, 1);
    expect(part.watertight).toBe(true);
    expect(closedAllRound(part)).toBe(true);
  });

  it("allows the printer's clearance in its pocket: half a millimetre more each side at 0.5", async () => {
    const loose = await made(
      built("battery-holster", {
        ...withoutScrews,
        printer: { clearance: { value: 0.5, unit: "mm", source: { kind: "measured" } } },
      }),
    );
    expect(loose.size).toEqual({ length: 85, depth: 119.5, height: 70.5 });
    const pocket = (76 + 1) * (115 + 0.5) * (66 + 0.5);
    expect(loose.volume).toBeCloseTo(85 * 119.5 * 70.5 - pocket, 1);
  });

  it("has its two countersunk screw holes through the back wall, still closed all round", async () => {
    const plain = await made(built("battery-holster", withoutScrews));
    const part = await made(built("battery-holster", goldenHolster));
    // Each takes at least its 4.4 mm hole through the 4 mm back wall, and its countersink more.
    const removed = plain.volume - part.volume;
    expect(removed).toBeGreaterThan(2 * holeArea(4.4) * 4);
    expect(removed).toBeLessThan(2 * holeArea(8.4) * 4);
    expect(closedAllRound(part)).toBe(true);
  });

  it("fits the plate, and lists its sizes with their sources, the assumed one to check", () => {
    const build = built("battery-holster", goldenHolster);
    expect(build.print?.fits).toBe(true);
    expect(build.print?.sizes.map(({ name, says, source }) => [name, says, source?.kind])).toEqual([
      ["Battery width", "76 mm", "assumed"],
      ["Battery depth", "115 mm", "measured"],
      ["Battery height", "66 mm", "measured"],
      ["Walls", "4 mm", undefined],
      ["Screw holes", "2 × 4 mm, countersunk", "specified"],
    ]);
    expect(build.findings).toEqual([{ kind: "assumed", sizes: ["Battery width"] }]);
  });

  it("is printed, tried and fixed, with the filament and its screws to buy", () => {
    const build = built("battery-holster", goldenHolster);
    expect(build.steps.map((step) => step.title)).toEqual([
      "Print it",
      "Try the battery in it",
      "Fix it",
    ]);
    expect(build.buyList.lines.map(({ item, needed }) => [item, needed])).toEqual([
      ["PLA filament, 1 kg reel", 1],
      ["4 × 30 mm wood screws", 2],
    ]);
  });
});

describe("the golden shim", () => {
  it("is the castor's plate, 10 mm thick, less its four bolt holes with the clearance", async () => {
    const build = built("castor-shim", goldenShim);
    expect(build.size).toEqual({ length: 80, depth: 60, height: 10 });
    const part = await made(build);
    expect(part.size).toEqual({ length: 80, depth: 60, height: 10 });
    expect(part.volume).toBeCloseTo(80 * 60 * 10 - 4 * holeArea(8 + 0.4) * 10, 1);
    expect(closedAllRound(part)).toBe(true);
  });

  it("counts four, and their 16 bolts", () => {
    const build = built("castor-shim", goldenShim);
    expect(build.parts[0]?.count).toBe(4);
    expect(build.buyList.lines.map(({ item, needed }) => [item, needed])).toEqual([
      ["PLA filament, 1 kg reel", 1],
      ["M8 bolts", 16],
    ]);
  });
});

describe("a bracket", () => {
  it("is an L with its screws through each leg, closed all round", async () => {
    const build = built("bracket", {
      width: 40,
      flat: 50,
      upright: 50,
      thickness: 5,
      screws: {
        screw: {
          name: "4 mm screws",
          diameter: { value: 4, unit: "mm", source: { kind: "assumed" } },
        },
        count: 2,
      },
      fillet: 3,
    });
    expect(build.findings.map((finding) => finding.kind)).toEqual(["assumed", "tools-missing"]);
    const part = await made(build);
    expect(part.size).toEqual({ length: 40, depth: 50, height: 50 });
    expect(closedAllRound(part)).toBe(true);
  });
});

describe("the files to print", () => {
  it("are a 3MF, a zip with the model in it, and a binary STL with every triangle", async () => {
    const part = await made(built("castor-shim", goldenShim));
    const threeMf = to3mf(part, "Shim");
    const text = Array.from(threeMf, (byte) => String.fromCharCode(byte)).join("");
    expect(text.slice(0, 2)).toBe("PK");
    expect(text).toContain("3D/3dmodel.model");
    expect(text).toContain('unit="millimeter"');
    const stl = toStl(part, "Shim");
    expect(stl.length).toBe(84 + 50 * (part.triangles.length / 3));
  });
});
