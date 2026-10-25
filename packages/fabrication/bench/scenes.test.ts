import { describe, expect, it } from "vitest";
import type { Build, Scene, SceneMark } from "../build.ts";
import { goldenBench } from "./fixtures/golden.ts";
import { deriveBench } from "./index.ts";

// Each step's picture (#754): the job as it's done, worked out from the Build and the tools to
// hand, with every number drawn on it the Build's own.

const built = (parameters: unknown): Build => {
  const derived = deriveBench(parameters);
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

const sceneOf = (build: Build, id: string): Scene => {
  const step = build.steps.find((each) => each.id === id);
  if (step?.scene == null) throw new Error(`No step ${id} with a scene.`);
  return step.scene;
};

const withTools = (...tools: string[]) => ({
  ...goldenBench,
  tools: [...goldenBench.tools, ...tools],
});

/** Each piece as "kind name tone ×boxes", so a scene reads at a glance. */
const pieces = (scene: Scene) =>
  scene.pieces.map(
    (piece) => `${piece.kind} ${piece.label ?? piece.name} ${piece.tone} ×${piece.boxes.length}`,
  );

const tools = (scene: Scene) =>
  scene.pieces.filter((piece) => piece.kind === "tool").map((piece) => piece.name);

const marks = <K extends SceneMark["kind"]>(scene: Scene, kind: K) =>
  scene.marks.filter((mark): mark is Extract<SceneMark, { kind: K }> => mark.kind === kind);

describe("the cut step's scene", () => {
  it("holds the first length in the Workmate's jaws, the piece lit and the offcut on the waste side", () => {
    const scene = sceneOf(built(goldenBench), "cut-timber");

    expect(scene.title).toBe("In the Workmate");
    expect(pieces(scene)).toEqual([
      "part B lit ×1",
      "offcut Offcut plain ×1",
      "tool Folding workbench plain ×4",
      "tool Hand saw plain ×1",
    ]);
    const [piece, offcut] = scene.pieces;
    expect(piece?.boxes[0]?.w).toBe(1450);
    expect(offcut?.boxes[0]).toMatchObject({ x: 1450, w: 950 });
  });

  it("puts the pencil line and the dimension at the cut length, the part's own", () => {
    const build = built(goldenBench);
    const scene = sceneOf(build, "cut-timber");
    const rails = build.parts.find((part) => part.label === "B");

    expect(marks(scene, "size").map((mark) => mark.mm)).toEqual([rails?.length]);
    expect(marks(scene, "line")).toEqual([
      expect.objectContaining({ says: "cut at 1450", from: expect.objectContaining({ x: 1450 }) }),
    ]);
    const [saw] = marks(scene, "arrow");
    expect(saw?.says).toBe("saw here, just past the line");
    // On the waste side: past the line by half the saw's cut.
    expect(saw?.to.x).toBe(1451.5);
  });

  it("marks where the long end's support and the clamp go, and draws the support once it's to hand", () => {
    const notes = (scene: Scene) => marks(scene, "note").map((note) => [note.says, note.tone]);

    expect(notes(sceneOf(built(goldenBench), "cut-timber"))).toEqual([
      ["support the long end here", "plain"],
      ["clamped in the jaws", "plain"],
      ["offcut · waste side", "waste"],
    ]);
    const supported = sceneOf(built(withTools("long-end-support")), "cut-timber");
    expect(tools(supported)).toContain("Support for the long end");
    // Under the long end, the 1450 piece, not the 950 offcut.
    const support = supported.pieces.find((piece) => piece.name === "Support for the long end");
    expect(support?.boxes[0]?.x).toBeLessThan(1450);
  });

  it("gives a hand-saw owner the Workmate, and a circular-saw owner the bench", () => {
    expect(tools(sceneOf(built(goldenBench), "cut-timber"))).toEqual([
      "Folding workbench",
      "Hand saw",
    ]);
    const circular = sceneOf(built(withTools("circular-saw")), "cut-timber");
    expect(circular.title).toBe("Clamped to the bench");
    expect(tools(circular)).toEqual(["Bench", "Circular saw"]);
  });

  it("draws only the tools the owner has", () => {
    const { tools: _tools, ...rest } = goldenBench;
    const scene = sceneOf(built({ ...rest, tools: [] }), "cut-timber");

    expect(tools(scene)).toEqual([]);
    expect(scene.title).toBe("Cutting the length");
  });
});

describe("the marking step", () => {
  it("lays the length on the Workmate with the tape and square, a pencil line at each piece's end", () => {
    const scene = sceneOf(built(goldenBench), "mark-lengths");

    expect(scene.title).toBe("On the Workmate");
    expect(tools(scene)).toEqual(["Folding workbench", "Tape measure", "Square"]);
    expect(pieces(scene)[0]).toBe("part B lit ×1");
    // B's end at 1450; A's after the 3 mm kerf and its 750.
    expect(marks(scene, "line").map((line) => [line.says, line.from.x])).toEqual([
      ["B 1450", 1450],
      ["A 750", 2203],
    ]);
    expect(marks(scene, "size").map((size) => size.mm)).toEqual([1450, 2203]);
    expect(marks(scene, "note")).toContainEqual(
      expect.objectContaining({ says: "check this end is square", tone: "check" }),
    );
  });

  it("leaves out the square when it isn't to hand", () => {
    const scene = sceneOf(
      built({ ...goldenBench, tools: goldenBench.tools.filter((tool) => tool !== "square") }),
      "mark-lengths",
    );

    expect(tools(scene)).toEqual(["Folding workbench", "Tape measure"]);
  });

  it("checks the end is square first, then one line per length, each with its marks", () => {
    const step = built(goldenBench).steps.find((each) => each.id === "mark-lengths");
    const [first, ...lengths] = step?.actions ?? [];

    expect(first?.howTo).toContain("check the end is square");
    expect(first?.length).toBeUndefined();
    expect(lengths.map((action) => action.length)).toEqual([
      {
        stock: "45 × 95 C16",
        stockLength: 2400,
        count: 4,
        kerf: 3,
        cuts: [
          { label: "B", length: 1450 },
          { label: "A", length: 750 },
        ],
        offcut: 197,
      },
      expect.objectContaining({ count: 1, offcut: 88 }),
      expect.objectContaining({ stock: "45 × 145 C16", count: 1, offcut: 834 }),
    ]);
    // Show me how walks through the tape, the tick, the square and the line, in that order.
    const said = lengths[0]?.howTo ?? "";
    const order = ["tape", "tick", "square", "line"].map((word) => said.indexOf(word));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(lengths[0]?.numbers).toBe("4 × 45 × 95 C16: ticks at 1450, 2203");
  });
});

describe("the end frames' scene", () => {
  it("lays two legs flat with the rails across them, a square in the corner and the diagonals to check", () => {
    const scene = sceneOf(built(goldenBench), "end-frames");

    expect(pieces(scene)).toEqual(["part A lit ×2", "part C lit ×2", "tool Square plain ×2"]);
    const diagonal = Math.round(Math.hypot(460, 750) * 10) / 10;
    expect(marks(scene, "check").map((check) => check.mm)).toEqual([diagonal, diagonal]);
    expect(marks(scene, "size").map((size) => size.mm)).toEqual([460, 250]);
    expect(scene.view.tilt).toBe(60);
  });
});

describe("the castors' scene", () => {
  it("is a base upside down, its castors' plates and every bolt through them", () => {
    const scene = sceneOf(built(goldenBench), "fit-castors");

    expect(pieces(scene)).toEqual([
      "part E lit ×1",
      // Each castor's plate and its wheel's housing.
      "fitted Wheelwright TD60 castors plain ×4",
      "fitted M6 × 60 bolts plain ×8",
    ]);
    expect(marks(scene, "size").map((size) => size.mm)).toEqual([550, 10]);
    expect(marks(scene, "arrow")[0]?.says).toBe("bolt down through the plate and the base");
  });
});

describe("an assembly step's scene", () => {
  it("is the frame so far, this step's parts lit and nothing not yet fitted", () => {
    const build = built(goldenBench);

    expect(pieces(sceneOf(build, "long-rails"))).toEqual([
      "part A built ×4",
      "part B lit ×4",
      "part C built ×4",
      "part E built ×2",
      "fitted Wheelwright TD60 castors built ×4",
    ]);
    const top = pieces(sceneOf(build, "fit-top"));
    expect(top).toContain("part G lit ×1");
    expect(top.filter((piece) => piece.includes(" lit "))).toEqual(["part G lit ×1"]);
    expect(top).toHaveLength(build.parts.length + build.fitted.length);
  });

  it("checks the frame's diagonals once it's joined, and gives the support's place and the overhang", () => {
    const build = built(goldenBench);

    const [one, other] = marks(sceneOf(build, "long-rails"), "check");
    expect(one?.mm).toBe(other?.mm);
    expect(marks(sceneOf(build, "fit-supports"), "size").map((size) => size.mm)).toEqual([725]);
    expect(marks(sceneOf(build, "fit-top"), "size").map((size) => size.mm)).toEqual([25]);
  });

  it("shows the whole bench, nothing lit, when checking what's arrived and the bench at the end", () => {
    const build = built(goldenBench);

    for (const id of ["check-delivery", "check-bench"]) {
      const scene = sceneOf(build, id);
      expect(scene.pieces.every((piece) => piece.tone === "plain")).toBe(true);
      expect(scene.pieces.filter((piece) => piece.kind === "part")).toHaveLength(
        build.parts.length,
      );
    }
    expect(marks(sceneOf(build, "check-bench"), "size").map((size) => size.mm)).toEqual([899.6]);
  });
});

describe("every step's scene", () => {
  it("is there, and opens between 15° and 60° above level", () => {
    const build = built(goldenBench);
    for (const step of build.steps) {
      const { tilt } = sceneOf(build, step.id).view;
      expect(tilt).toBeGreaterThanOrEqual(15);
      expect(tilt).toBeLessThanOrEqual(60);
    }
  });
});
