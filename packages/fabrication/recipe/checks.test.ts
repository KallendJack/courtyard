import { BuildRecipe } from "@courtyard/contract";
import { describe, expect, it } from "vitest";
import type { Build, Finding } from "../build.ts";
import { rack, shelfBox } from "./fixtures/invented.ts";
import { workOutRecipe } from "./work-out.ts";

// The checks any recipe gets (#771): sag from a shelf's span, its sheet and the load said in plain
// words; tipping from its height against its feet; racking from a frame with no brace; and screws
// long enough for what they pass through, never out the far side.

const worked = (recipe: unknown): Build => {
  const derived = workOutRecipe(BuildRecipe.parse(recipe));
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

const found = <K extends Finding["kind"]>(build: Build, kind: K) =>
  build.findings.filter(
    (finding): finding is Extract<Finding, { kind: K }> => finding.kind === kind,
  );

const measured = (value: number) => ({ value, unit: "mm", source: { kind: "measured" } }) as const;
const specified = (value: number) =>
  ({ value, unit: "mm", source: { kind: "specified", reference: "Panel Cutters' page" } }) as const;

const twelveMil = {
  ...shelfBox.stock[0],
  id: "12-mm-plywood",
  name: "12 mm plywood",
  thickness: specified(12),
};

/** A box of 12 mm ply 1248 wide: 1200 between the shelf's cleats. */
const wideBox = (load: string) => ({
  ...shelfBox,
  size: { ...shelfBox.size, length: measured(1248) },
  stock: [twelveMil, shelfBox.stock[1]],
  groups: [
    { ...shelfBox.groups[0], stock: "12-mm-plywood" },
    { ...shelfBox.groups[1], stock: "12-mm-plywood" },
  ],
  load,
});

describe("sag", () => {
  it("flags a 1200 mm span of 12 mm ply under paint tins, with a centre support", () => {
    const [shelf] = found(worked(wideBox("paint tins")), "sags").filter(
      (finding) => finding.name === "Lower shelf",
    );
    expect(shelf).toMatchObject({
      span: 1200,
      thickness: 12,
      load: { class: "very heavy", said: "paint tins", matched: "paint" },
    });
    // 1200 / 600 is the 2 mm a shelf may sag; 12 mm ply under the tins takes 335 mm.
    expect(shelf).toMatchObject({ allowed: 2, most: 335 });
    expect(shelf?.sag).toBeGreaterThan(2);
    expect(shelf?.fixes).toEqual(["Add a centre support and use 25 mm"]);
  });

  it("reads the load in plain words as its class", () => {
    const classOf = (load: string) =>
      found(worked(wideBox(load)), "sags").find((finding) => finding.name === "Lower shelf")?.load;
    expect(classOf("4 storage boxes of tools")).toMatchObject({ class: "heavy", matched: "tool" });
    expect(classOf("a 3D printer")).toMatchObject({ class: "medium", matched: "printer" });
  });

  it("checks a shelf said nothing about as the heaviest", () => {
    const { load: _load, ...unsaid } = wideBox("paint tins");
    const [shelf] = found(worked(unsaid), "sags");
    expect(shelf?.load).toMatchObject({ class: "very heavy", said: null, matched: null });
  });

  it("passes the rack's short shelf and top", () => {
    expect(found(worked(rack), "sags")).toEqual([]);
  });
});

describe("tipping", () => {
  it("flags a tall narrow rack, with wider feet and the wall as advice", () => {
    const tall = {
      ...rack,
      size: { ...rack.size, depth: measured(300), height: measured(1800) },
    };
    expect(found(worked(tall), "tips")).toEqual([
      {
        kind: "tips",
        height: 1800,
        feet: 184,
        way: "front to back",
        fixes: ["Widen its feet to 450 mm front to back"],
        advice: "Or fix it to the wall with a bracket at the top.",
      },
    ]);
  });

  it("passes the rack as it is", () => {
    expect(found(worked(rack), "tips")).toEqual([]);
  });
});

describe("racking", () => {
  it("flags a frame with no brace, with a brace or a back panel", () => {
    const unbraced = {
      ...rack,
      groups: rack.groups.filter((group) => group.kind !== "brace"),
      joints: rack.joints.filter((joint) => !(joint.joins as readonly string[]).includes("brace")),
    };
    expect(found(worked(unbraced), "racks")).toEqual([
      { kind: "racks", frame: "legs", fixes: ["Add a brace or a back panel"] },
    ]);
  });

  it("passes a braced frame and a box", () => {
    expect(found(worked(rack), "racks")).toEqual([]);
    expect(found(worked(shelfBox), "racks")).toEqual([]);
  });
});

describe("screw length", () => {
  it("flags sheet screws too short to grip, with the length to use", () => {
    expect(found(worked(rack), "screw-length")).toEqual([
      {
        kind: "screw-length",
        screws: "4 × 40 screws",
        joint: "shelf to long rails",
        problem: "too short",
        through: 18,
        into: 22,
        least: 24,
        room: 89,
        fixes: ["Use 4 × 45 screws"],
      },
      expect.objectContaining({ joint: "brace to long rails", problem: "too short" }),
      expect.objectContaining({ joint: "top to long rails", problem: "too short" }),
    ]);
  });

  it("flags screws long enough to come out the far side: a cleat's into its side", () => {
    expect(found(worked(shelfBox), "screw-length")).toEqual([
      expect.objectContaining({ joint: "the cupboard's panels", problem: "too short" }),
      {
        kind: "screw-length",
        screws: "4 × 40 screws",
        joint: "the cupboard's panels",
        problem: "too long",
        through: 18,
        into: 22,
        least: 24,
        room: 18,
        fixes: ["Use 4 × 35 screws"],
      },
    ]);
  });

  it("passes screws that grip and stay in", () => {
    const frameScrews = found(worked(rack), "screw-length").filter(
      (finding) => finding.screws === "5 × 70 screws",
    );
    expect(frameScrews).toEqual([]);
  });
});
