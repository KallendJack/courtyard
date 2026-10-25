import { describe, expect, it } from "vitest";
import type { Build, BuildSetting, Step } from "../build.ts";
import { toolsFrom } from "../tools.ts";
import { goldenBench } from "./fixtures/golden.ts";
import { deriveBench } from "./index.ts";

// The steps follow Your tools (#707, #777), never fixed at the Build's start: a new saw changes
// the steps it does better and their pictures, and a step already done stays as it was done.

const built = (setting?: BuildSetting): Build => {
  const derived = deriveBench(goldenBench, setting);
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

/** The golden bench's tools as Your tools saves them: by the tiles' names, or the owner's own. */
const theirs = [
  "Tape, pencil",
  "Square",
  "Hand saw",
  "Workmate",
  "Clamps",
  "Drill / driver",
  "Drill bits",
  "Safety glasses",
];

const stepOf = (build: Build, id: string): Step | undefined =>
  build.steps.find((step) => step.id === id);

const sawOf = (build: Build) => stepOf(build, "cut-timber")?.ways.find((way) => way.using)?.tool;

describe("a Build's steps with Your tools", () => {
  it("are the Build's own tools' steps when Your tools have the same", () => {
    expect(built({ tools: theirs }).steps).toEqual(built().steps);
  });

  it("follow Your tools rather than the Build's own", () => {
    const tools = theirs.filter((tool) => tool !== "Hand saw");
    expect(sawOf(built({ tools: [...tools, "Circular saw"] }))).toBe("circular-saw");
  });

  it("change only the steps a new tool does better, and their pictures", () => {
    const before = built({ tools: theirs });
    const after = built({ tools: [...theirs, "Mitre saw"] });

    const changed = after.steps
      .filter((step) => JSON.stringify(step) !== JSON.stringify(stepOf(before, step.id)))
      .map((step) => step.id);
    expect(changed).toEqual(["cut-timber"]);
    expect(sawOf(after)).toBe("mitre-saw");
    const cut = stepOf(after, "cut-timber");
    expect(cut?.scene?.title).toBe("On the mitre saw");
    expect(cut?.scene?.pieces.filter((piece) => piece.kind === "tool").map((p) => p.name)).toEqual([
      "Folding workbench",
      "Mitre saw",
    ]);
  });

  it("say in one line what changed, on the step it changed", () => {
    const after = built({ tools: [...theirs, "Mitre saw"] });

    expect(stepOf(after, "cut-timber")?.wayChanged).toEqual({ was: "Hand saw", now: "Mitre saw" });
    expect(after.steps.filter((step) => step.wayChanged !== null)).toHaveLength(1);
    expect(stepOf(built({ tools: theirs }), "cut-timber")?.wayChanged).toBeNull();
  });

  it("find each tool by the words in its name, several in one, and the kit no tile has", () => {
    expect(toolsFrom(["Electric drill and drill bits"])).toEqual(["drill-driver", "drill-bits"]);
    expect(toolsFrom(["Drill bits"])).toEqual(["drill-bits"]);
    expect(toolsFrom(["Tape, pencil", "Workmate", "Sawhorses", "Drill / driver"])).toEqual([
      "tape-measure",
      "pencil",
      "folding-workbench",
      "long-end-support",
      "drill-driver",
    ]);
    expect(
      toolsFrom(["Countersink", "Socket set", "Safety specs", "Ear muffs", "Step stool"]),
    ).toEqual([
      "long-end-support",
      "countersink-bit",
      "spanner",
      "safety-glasses",
      "ear-defenders",
    ]);
    // Tools the steps don't name are none of theirs.
    expect(toolsFrom(["Masking tape", "Hammer", "Jigsaw", "Screwdriver bits"])).toEqual([]);
  });

  it("need nothing more once the owner has said the kit the steps use", () => {
    const missing = (tools: readonly string[]) =>
      built({ tools }).findings.find((finding) => finding.kind === "tools-missing");
    const all = [...theirs, "Countersink", "Spanner", "Ear defenders", "Sawhorses", "Spirit level"];

    expect(missing(theirs)).toBeDefined();
    expect(missing(all)).toBeUndefined();
  });

  it("keep a step already done as it was done", () => {
    const after = built({
      tools: [...theirs, "Mitre saw"],
      kept: [{ step: "cut-timber", tool: "hand-saw" }],
    });

    expect(sawOf(after)).toBe("hand-saw");
    expect(stepOf(after, "cut-timber")?.wayChanged).toBeNull();
    // Its actions, tools and picture as they were; only the mitre saw is to hand now.
    const before = stepOf(built({ tools: theirs }), "cut-timber");
    const { ways: _after, ...done } = stepOf(after, "cut-timber") ?? {};
    const { ways: _before, ...was } = before ?? {};
    expect(done).toEqual(was);
  });
});
