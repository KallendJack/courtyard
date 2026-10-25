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

describe("show me how (#777)", () => {
  const walkOf = (id: string) =>
    built(goldenBench).steps.find((step) => step.id === id)?.walkThrough ?? [];

  it("walks through marking: the tape, the tick, the square, the line, with two close-ups", () => {
    const walk = walkOf("mark-lengths");

    expect(walk.map((move) => move.title)).toEqual(["Tape", "Tick", "Square", "Line"]);
    expect(walk.map((move) => move.closeUp?.title ?? null)).toEqual([
      "The tape's hook over the end",
      null,
      "The square's stock against the edge",
      null,
    ]);
    // The tick at B's 1450, the first piece marked.
    expect(walk[1]?.says).toContain("At 1450");
    // The line drawn across B's 95 mm face, along the square's blade.
    const [across] = walk[2]?.closeUp?.dimensions ?? [];
    expect(across?.mm).toBe(95);
    // The hook over the end of the 45 mm length.
    const [length, ...tape] = walk[0]?.closeUp?.pieces ?? [];
    expect(length).toMatchObject({ label: "B", x: 0, h: 45 });
    expect(tape.every((piece) => piece.label === "tape" && piece.x < 0)).toBe(true);
  });

  it("shows how deep a pilot hole goes the first time one's drilled: a mark on the bit at the screw's length", () => {
    const [pilot] = walkOf("end-frames");

    expect(pilot?.says).toContain("3 mm bit 80 mm from its tip");
    expect(pilot?.closeUp?.dimensions.map((line) => line.mm)).toEqual([80]);
    const pieces = pilot?.closeUp?.pieces ?? [];
    expect(pieces.map((piece) => piece.label)).toEqual(["C", "A", "bit", "bit"]);
    // The mark sits where the bit meets the rail's face.
    const [rail, , , mark] = pieces;
    expect((mark?.y ?? 0) + (mark?.h ?? 0)).toBe(rail?.y);
    expect(walkOf("long-rails")).toEqual([]);
  });

  it("drills a castor's holes through its plate's own, then tightens with the head held against the castor (#783)", () => {
    const [drill, tighten] = walkOf("fit-castors");

    expect([drill?.title, tighten?.title]).toEqual(["Drill through the plate", "Tighten"]);
    expect(drill?.says).toContain("turn the collar behind the chuck to the drill symbol");
    expect(drill?.says).toContain("or turn the plate 90° and drill fresh holes through it");
    // The 7 mm bit down through the 4 mm plate and the 45 mm base.
    const drilled = drill?.closeUp?.pieces ?? [];
    expect(drilled.map((piece) => piece.label)).toEqual(["castor", "E", "bit"]);
    expect(drilled[2]?.w).toBe(7);
    expect(drill?.closeUp?.dimensions.map((line) => line.mm)).toEqual([49]);

    expect(tighten?.says).toContain("Start each nut by hand.");
    expect(tighten?.says).toContain("Lock nuts are stiff all the way");
    const close = tighten?.closeUp;
    expect(close?.title).toBe("Tighten");
    expect(close?.labels?.map((label) => label.says)).toEqual([
      "On top",
      "rests on castor",
      "Underneath",
      "turn the nut",
    ]);
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
});

describe("where the brackets go (#777)", () => {
  it("points to both faces of a leg's foot when the frame stands on its bases", () => {
    const build = built(goldenBench);
    const arrows = marks(sceneOf(build, "stand-on-bases"), "arrow");
    const leg = build.parts.find((part) => part.label === "A")?.boxes[0];

    expect(arrows.map((arrow) => arrow.says)).toEqual([
      "bracket on the face to the middle",
      "bracket on the face to the other leg",
    ]);
    // At the leg's foot, on its face towards the middle and its face towards the back leg.
    expect(arrows[0]?.to.x).toBe((leg?.x ?? 0) + (leg?.w ?? 0));
    expect(arrows[1]?.to.y).toBe((leg?.y ?? 0) + (leg?.d ?? 0));
    for (const arrow of arrows) expect(arrow.to.z).toBeGreaterThan(leg?.z ?? 0);
  });

  it("points to the end of each support when they're fitted", () => {
    const build = built(goldenBench);
    const arrows = marks(sceneOf(build, "fit-supports"), "arrow");
    const end = (label: string) => {
      const box = build.parts.find((part) => part.label === label)?.boxes[0];
      return box && { x: box.x + box.w, y: box.y };
    };

    expect(arrows.map((arrow) => arrow.says)).toEqual([
      "a bracket at each end",
      "and at each end of D",
    ]);
    expect(arrows.map((arrow) => ({ x: arrow.to.x, y: arrow.to.y }))).toEqual([end("F"), end("D")]);
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
      // The castor's plate and its wheel's housing.
      "fitted Wheelwright TD60 castors plain ×2",
      "fitted M6 × 60 bolts plain ×1",
      // The bit through the plate's hole, and the drill's body.
      "tool Drill driver plain ×2",
    ]);
    // The same gap both sides and a fingernail from the end: no sums.
    expect(marks(scene, "line").map((line) => line.says)).toEqual(["=", "=", "1 cm"]);
    expect(marks(scene, "size")).toEqual([]);
    expect(marks(scene, "arrow").map((arrow) => arrow.says)).toEqual(["through the plate's hole"]);
    expect(marks(scene, "note").map((note) => note.says)).toEqual([
      "first bolt, loose",
      "the Workmate's jaws",
    ]);
  });

  it("lays the base on two offcuts with no Workmate, and draws no drill that isn't to hand", () => {
    const scene = sceneOf(built({ ...goldenBench, tools: ["drill-bits"] }), "fit-castors");

    expect(scene.title).toBe("On two offcuts");
    expect(tools(scene)).toEqual([]);
    expect(pieces(scene)).toContain("offcut Offcuts plain ×2");
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
