import { describe, expect, it } from "vitest";
import type { Build, BuildSetting, Step } from "../build.ts";
import { goldenBench } from "./fixtures/golden.ts";
import { deriveBench } from "./index.ts";

// A saw cuts only what fits it (#780): a 210 mm mitre saw cuts about 120 mm wide, so the golden
// bench's 95 mm rails go on it and its 145 mm castor bases and top support go back to the hand
// saw in the Workmate.

const built = (setting: BuildSetting): Build => {
  const derived = deriveBench(goldenBench, setting);
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

const theirs = ["Tape, pencil", "Square", "Hand saw", "Workmate", "Clamps", "Safety glasses"];

const cutOf = (build: Build): Step => {
  const step = build.steps.find((each) => each.id === "cut-timber");
  if (step === undefined) throw new Error("No cutting step.");
  return step;
};

const said = (step: Step) => step.actions.map((action) => action.howTo).join("\n");

describe("a saw's cutting capacity", () => {
  it("takes the cuts that fit it and gives the rest back to the hand saw, saying why", () => {
    const cut = cutOf(
      built({
        tools: [...theirs, "Mitre saw"],
        sizes: [{ name: "Mitre saw", size: "120 × 60 mm" }],
      }),
    );

    expect(cut.ways.find((way) => way.using)?.tool).toBe("mitre-saw");
    expect(said(cut)).toContain(
      "The 145 castor bases and top support are too wide for your mitre saw: hand saw for these.",
    );
    expect(said(cut)).not.toContain("legs");
    expect(cut.tools.map((tool) => tool.tool)).toEqual(
      expect.arrayContaining(["mitre-saw", "hand-saw", "folding-workbench"]),
    );
  });

  it("takes every cut when they all fit", () => {
    const cut = cutOf(
      built({
        tools: [...theirs, "Mitre saw"],
        sizes: [{ name: "Mitre saw", size: "305 × 90 mm" }],
      }),
    );

    expect(said(cut)).not.toContain("hand saw for these");
    expect(cut.tools.map((tool) => tool.tool)).not.toContain("hand-saw");
  });

  it("gives a cut too deep for the saw back too", () => {
    const cut = cutOf(
      built({
        tools: [...theirs, "Mitre saw"],
        sizes: [{ name: "Mitre saw", size: "305 × 40 mm" }],
      }),
    );

    expect(said(cut)).toContain("too deep for your mitre saw: hand saw for these.");
  });

  it("assumes a saw whose capacity isn't known cuts 100 mm wide, and says so", () => {
    const cut = cutOf(built({ tools: [...theirs, "Mitre saw"] }));

    expect(cut.ways.find((way) => way.using)?.tool).toBe("mitre-saw");
    expect(said(cut)).toContain(
      "Your mitre saw's cutting capacity isn't known, so it's assumed to cut 100 mm wide: hand saw for the 145 castor bases and top support.",
    );
  });

  it("sends a cut too wide for the mitre saw to the circular saw when there is one", () => {
    const cut = cutOf(
      built({
        tools: [...theirs, "Mitre saw", "Circular saw"],
        sizes: [{ name: "Mitre saw", size: "120 × 60 mm" }],
      }),
    );

    expect(said(cut)).toContain(
      "The 145 castor bases and top support are too wide for your mitre saw: circular saw for these.",
    );
  });
});
