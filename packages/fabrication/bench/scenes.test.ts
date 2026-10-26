import { describe, expect, it } from "vitest";
import type { Build } from "../build.ts";
import type { Scene, SceneMark } from "../scene.ts";
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

  it("gives a hand-saw owner the Workmate's jaws, and clamps a circular saw's length on it", () => {
    expect(tools(sceneOf(built(goldenBench), "cut-timber"))).toEqual([
      "Folding workbench",
      "Hand saw",
    ]);
    const circular = sceneOf(built(withTools("circular-saw")), "cut-timber");
    expect(circular.title).toBe("Clamped on the Workmate");
    expect(tools(circular)).toEqual(["Folding workbench", "Circular saw"]);
  });

  it("draws no tool the owner doesn't have, not even a bench for a circular saw (#777)", () => {
    const owned = goldenBench.tools.filter((tool) => tool !== "folding-workbench");
    const circular = sceneOf(
      built({ ...goldenBench, tools: [...owned, "circular-saw"] }),
      "cut-timber",
    );

    expect(circular.title).toBe("Clamped down");
    expect(tools(circular)).toEqual(["Circular saw"]);
    // Where it's held is still marked.
    expect(marks(circular, "note").map((note) => note.says)).toContain("clamp here");
  });

  it("lays the length on a mitre saw's bed against its fence, the blade on the waste side", () => {
    const scene = sceneOf(built(withTools("mitre-saw")), "cut-timber");

    expect(scene.title).toBe("On the mitre saw");
    expect(tools(scene)).toEqual(["Folding workbench", "Mitre saw"]);
    const [saw] = marks(scene, "arrow");
    expect(saw?.says).toBe("blade on the waste side of the line");
    expect(saw?.to.x).toBe(1451.5);
    expect(marks(scene, "line")[0]?.says).toBe("cut at 1450");
  });

  it("draws only the tools the owner has", () => {
    const { tools: _tools, ...rest } = goldenBench;
    const scene = sceneOf(built({ ...rest, tools: [] }), "cut-timber");

    expect(tools(scene)).toEqual([]);
    expect(scene.title).toBe("Cutting the length");
  });

  it("says jaws only when there's a Workmate to have them", () => {
    const owned = goldenBench.tools.filter((tool) => tool !== "folding-workbench");
    const says = (parameters: unknown) =>
      marks(sceneOf(built(parameters), "cut-timber"), "note").map((note) => note.says);

    expect(says(goldenBench)).toContain("clamped in the jaws");
    const without = says({ ...goldenBench, tools: owned });
    expect(without).not.toContain("clamped in the jaws");
    expect(without).toContain("clamped down, line past the edge");
  });
});

describe("the marking step", () => {
  it("lays the length on the Workmate with the tape and square, the first piece's line from the end", () => {
    const scene = sceneOf(built(goldenBench), "mark-lengths");

    expect(scene.title).toBe("On the Workmate");
    expect(tools(scene)).toEqual(["Folding workbench", "Tape measure", "Square"]);
    expect(pieces(scene)[0]).toBe("part B lit ×1");
    // Only B's 1450: A is measured from the fresh end B's cut leaves, with no running total (#789).
    expect(marks(scene, "line").map((line) => [line.says, line.from.x])).toEqual([
      ["B 1450", 1450],
    ]);
    expect(marks(scene, "size").map((size) => size.mm)).toEqual([1450]);
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
    expect(lengths[0]?.numbers).toBe("4 × 45 × 95 C16: B 1450, then A 750");
  });
});

describe("show me how (#777)", () => {
  const walkOf = (id: string) =>
    built(goldenBench).steps.find((step) => step.id === id)?.walkThrough ?? [];

  it("walks through marking: the tape, the tick, the square, the line, drawn by measure and mark", () => {
    const walk = walkOf("mark-lengths");

    expect(walk.map((move) => move.title)).toEqual(["Tape", "Tick", "Square", "Line"]);
    // The tick at B's 1450, the first piece marked.
    expect(walk[1]?.says).toContain("At 1450");
    // The moves are drawn once, by the step's measure and mark close-up (#813).
    expect(walk.map((move) => move.closeUp)).toEqual([null, null, null, null]);
  });

  it("walks through a joint's screw spots the first time a rail is screwed to a leg (#789)", () => {
    expect(walkOf("end-frames").map((move) => move.title)).toEqual([
      "The leg's edge",
      "Two crosses",
      "A fingertip in",
    ]);
    expect(walkOf("long-rails")).toEqual([]);
  });

  it("has nothing to walk through on the castors: the step opens on its four lines (#783)", () => {
    expect(walkOf("fit-castors")).toEqual([]);
  });
});

describe("the castors' close-ups (#783)", () => {
  const closeUpsOf = () =>
    built(goldenBench).steps.find((step) => step.id === "fit-castors")?.closeUps ?? [];

  it("tighten with the head held against the castor and the nut turned clockwise, then one bolt apart", () => {
    const [close, apart] = closeUpsOf();

    expect([close?.title, apart?.title]).toEqual(["Tighten", "One bolt, apart"]);
    expect(close?.labels?.map((label) => label.says)).toEqual([
      "On top: hold the head",
      "castor",
      "handle rests on the castor",
      "Under: turn the nut",
      // The golden bench has no spanner to hand: not "your".
      "a 10 mm spanner, clockwise",
    ]);
    expect(close?.notes).toEqual(["Stop when the washer bites."]);
    // A spanner's shape on the head, its handle reaching the castor's body; the nut turned
    // clockwise underneath. No tool is a bar.
    const [onHead, head, onNut, nut, turn] = close?.shapes ?? [];
    const body = close?.pieces.find((piece) => piece.label === "castor");
    expect([onHead?.kind, head?.kind, onNut?.kind, nut?.kind, turn?.kind]).toEqual([
      "open-spanner",
      "hex",
      "open-spanner",
      "hex",
      "clockwise",
    ]);
    const reach = onHead !== undefined && "length" in onHead ? onHead.x + onHead.length : 0;
    expect(reach).toBe(body?.x);
    expect(head?.kind === "hex" && head.across).toBe(10);
    expect(close?.pieces.map((piece) => piece.label)).toEqual(["castor"]);
  });

  it("draw the castor as one, its plate on the base with its swivel and wheel above", () => {
    const [, apart] = closeUpsOf();
    const castor = apart?.shapes?.find((shape) => shape.kind === "castor");
    const base = apart?.pieces.find((piece) => piece.label === "E");

    expect(castor).toMatchObject({ x: 0, w: 80, plate: 4 });
    expect(castor !== undefined && "plate" in castor && castor.y + castor.plate).toBeLessThan(
      base?.y ?? 0,
    );
  });
});

describe("where the brackets go (#777, drawn as L-shapes #813)", () => {
  const bracketsIn = (scene: Scene) =>
    scene.pieces.find((piece) => piece.name === "40 mm angle brackets");

  it("draws two at each leg's foot as the frame stands on its bases, lit, in place of arrows", () => {
    const build = built(goldenBench);
    const scene = sceneOf(build, "stand-on-bases");
    const brackets = bracketsIn(scene);
    const legs = build.parts.find((part) => part.label === "A")?.boxes ?? [];
    const [leg] = legs;

    expect(brackets?.tone).toBe("lit");
    // Two plates a bracket, two brackets a leg.
    expect(brackets?.boxes).toHaveLength(2 * 2 * legs.length);
    // The first leg's: one up its face towards the middle, one up its face towards the back leg,
    // each standing on the base at the leg's foot and 40 mm up it.
    const [middleUp, , otherUp] = brackets?.boxes ?? [];
    expect(middleUp).toMatchObject({ x: (leg?.x ?? 0) + (leg?.w ?? 0), z: leg?.z, h: 40 });
    expect(otherUp).toMatchObject({ y: (leg?.y ?? 0) + (leg?.d ?? 0), z: leg?.z, h: 40 });
    expect(marks(scene, "arrow")).toEqual([]);
  });

  it("draws one in the corner at each end of each support", () => {
    const build = built(goldenBench);
    const scene = sceneOf(build, "fit-supports");
    const supports = build.parts.filter((part) => part.label === "F" || part.label === "D");
    const top = supports.find((part) => part.label === "F")?.boxes[0];

    expect(bracketsIn(scene)?.boxes).toHaveLength(2 * 2 * supports.length);
    // F's front end: along its side from the rail, and along the rail from its side.
    const [alongSide, alongRail] = bracketsIn(scene)?.boxes ?? [];
    expect(alongSide).toMatchObject({ x: (top?.x ?? 0) + (top?.w ?? 0), y: top?.y, d: 40 });
    expect(alongRail).toMatchObject({ x: (top?.x ?? 0) + (top?.w ?? 0), y: top?.y, w: 40 });
    expect(marks(scene, "arrow")).toEqual([]);
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
  it("holds a base in the Workmate's jaws, castor end out: one bolt in and the drill in the next hole (#783)", () => {
    const scene = sceneOf(built(goldenBench), "fit-castors");

    expect(scene.title).toBe("In your Workmate");
    expect(pieces(scene)).toEqual([
      "part E lit ×1",
      "tool Folding workbench plain ×4",
      // The castor's plate, its swivel and its wheel.
      "fitted Wheelwright TD60 castors plain ×3",
      "fitted M6 × 60 bolts plain ×1",
      // A drill, not a block: the bit, the chuck, the body, the grip and the battery.
      "tool Drill driver plain ×5",
    ]);
    // Its words are callouts, off the model with a leader, as the board has them: the owner's
    // tools and where things go in their colour, the next thing to do in green. Nothing else.
    expect(scene.marks.every((mark) => mark.kind === "callout")).toBe(true);
    expect(marks(scene, "callout").map(({ says, more, tone }) => [says, more, tone])).toEqual([
      ["your drill, 7 mm bit", "straight down through the plate's hole", "yours"],
      ["1 bolt in", "then drill the next hole", "next"],
      ["your Workmate's jaws", "hold the base, castor end out", "yours"],
    ]);
  });

  it("draws the drill straight down, its bit's tip on the plate and its body above", () => {
    const scene = sceneOf(built(goldenBench), "fit-castors");
    const [bit, chuck, body] =
      scene.pieces.find((piece) => piece.kind === "tool" && piece.name === "Drill driver")?.boxes ??
      [];
    const plate = scene.pieces.find((piece) => piece.name === "Wheelwright TD60 castors")?.boxes[0];

    expect(bit?.w).toBe(7);
    expect(bit?.z).toBe((plate?.z ?? 0) + (plate?.h ?? 0));
    expect(chuck?.z).toBe((bit?.z ?? 0) + (bit?.h ?? 0));
    expect(body?.z).toBe((chuck?.z ?? 0) + (chuck?.h ?? 0));
  });

  it("lays the base on two offcuts with no Workmate, and draws no drill that isn't to hand", () => {
    const scene = sceneOf(built({ ...goldenBench, tools: ["drill-bits"] }), "fit-castors");

    expect(scene.title).toBe("On two offcuts");
    expect(tools(scene)).toEqual([]);
    expect(pieces(scene)).toContain("offcut Offcuts plain ×2");
    expect(marks(scene, "callout").map((callout) => callout.says)).toEqual([
      "drill 7 mm here",
      "1 bolt in",
      "two offcuts",
    ]);
  });
});

describe("an assembly step's scene", () => {
  it("is the frame so far, this step's parts lit and nothing not yet fitted", () => {
    const build = built(goldenBench);

    expect(pieces(sceneOf(build, "long-rails"))).toEqual([
      "part A built ×4",
      "part B lit ×4",
      "part C built ×4",
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
