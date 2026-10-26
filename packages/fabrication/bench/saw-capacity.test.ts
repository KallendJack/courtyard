import { describe, expect, it } from "vitest";
import type { Build, BuildSetting, Step } from "../build.ts";
import { capacitiesFrom } from "../capacity.ts";
import { deriveBench } from "../recipe/starters.ts";
import { goldenBench } from "./fixtures/golden.ts";

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

describe("a cut step already started (#777)", () => {
  it("keeps exactly its lines, nothing handed on", () => {
    const before = cutOf(
      built({ tools: theirs, kept: [{ step: "cut-timber", tool: "mitre-saw" }] }),
    );
    const started = cutOf(
      built({
        tools: [...theirs, "Mitre saw"],
        kept: [{ step: "cut-timber", tool: "mitre-saw" }],
      }),
    );

    expect(started.ways.find((way) => way.using)?.tool).toBe("mitre-saw");
    expect(started.actions).toEqual(before.actions);
    expect(said(started)).not.toContain("hand saw for");
  });
});

describe("a saw's capacity as the owner gave it", () => {
  it.each([
    ["120 × 60 mm", { width: 120, depth: 60 }],
    ["120x60", { width: 120, depth: 60 }],
    ["90°: 120 x 60 mm", { width: 120, depth: 60 }],
  ])("reads %s as a width by a depth, said by the owner", (size, { width, depth }) => {
    const capacity = capacitiesFrom([{ name: "Mitre saw", size }])["mitre-saw"];

    expect(capacity?.width).toEqual({ value: width, unit: "mm", source: { kind: "reported" } });
    expect(capacity?.depth).toEqual({ value: depth, unit: "mm", source: { kind: "reported" } });
  });

  it("leaves a lone number, such as the blade's, unknown", () => {
    expect(capacitiesFrom([{ name: "Mitre saw", size: "210 mm blade" }])).toEqual({});
    const cut = cutOf(
      built({
        tools: [...theirs, "Mitre saw"],
        sizes: [{ name: "Mitre saw", size: "210 mm blade" }],
      }),
    );

    expect(said(cut)).toContain("Your mitre saw's cutting capacity isn't known");
  });

  it("reads a circular saw's depth only when it's said as one", () => {
    expect(
      capacitiesFrom([{ name: "Circular saw", size: "54 mm deep" }])["circular-saw"]?.depth.value,
    ).toBe(54);
    expect(capacitiesFrom([{ name: "Circular saw", size: "165 mm blade" }])).toEqual({});
  });
});

describe("the cut step's picture", () => {
  it("draws the saw that cuts the timber shown: the hand saw in the Workmate when it's too big for the mitre saw", () => {
    const cut = cutOf(
      built({
        tools: [...theirs, "Mitre saw"],
        sizes: [{ name: "Mitre saw", size: "90 × 60 mm" }],
      }),
    );

    expect(cut.ways.find((way) => way.using)?.tool).toBe("mitre-saw");
    expect(cut.scene?.title).toBe("In the Workmate");
    expect(
      cut.scene?.pieces.filter((piece) => piece.kind === "tool").map((piece) => piece.name),
    ).not.toContain("Mitre saw");
  });

  it("draws the mitre saw when it takes the timber shown", () => {
    const cut = cutOf(
      built({
        tools: [...theirs, "Mitre saw"],
        sizes: [{ name: "Mitre saw", size: "120 × 60 mm" }],
      }),
    );

    expect(cut.scene?.title).toBe("On the mitre saw");
  });
});
