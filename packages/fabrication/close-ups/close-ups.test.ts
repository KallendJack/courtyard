import { describe, expect, it } from "vitest";
import { goldenBench } from "../bench/fixtures/golden.ts";
import type { Box, Build, BuildSetting } from "../build.ts";
import { FIXING_TYPES } from "../close-up.ts";
import { deriveBench } from "../recipe/starters.ts";
import { bracketCloseUp, bracketModel } from "./bracket.ts";
import { drivingCloseUp, drivingModel } from "./driving.ts";
import { markCloseUp, markModel } from "./measure.ts";
import { overlapCloseUp, overlapModel } from "./overlap.ts";

// The close-ups by type (#813): each drawn from the pieces it joins and their sizes, so any
// Build's corner, overlap or length gets its own, whatever its template.

/** Whether `inner` sits within `outer` along an axis. */
const within = (inner: Box, outer: Box, axis: "x" | "y" | "z") => {
  const size = { x: "w", y: "d", z: "h" } as const;
  return (
    inner[axis] >= outer[axis] - 1e-9 &&
    inner[axis] + inner[size[axis]] <= outer[axis] + outer[size[axis]] + 1e-9
  );
};

const built = (parameters: unknown, setting?: BuildSetting): Build => {
  const derived = deriveBench(parameters, setting);
  if (!derived.ok) throw new Error(derived.error.join("\n"));
  return derived.value;
};

/** The golden bench, and one with each choice that changes its steps the other way. */
const benches = () => [
  built(goldenBench),
  built({ ...goldenBench, castors: null }),
  built({
    ...goldenBench,
    shelf: { ...goldenBench.shelf, on: !goldenBench.shelf.on },
    braces: { ...goldenBench.braces, ends: true, rear: true },
  }),
];

describe("the guard (#813)", () => {
  it("draws every fixing a bench step makes with its type's close-up, on that step", () => {
    for (const build of benches()) {
      for (const step of build.steps) {
        for (const fixing of step.fixings) {
          expect(FIXING_TYPES, `${step.id}: ${fixing.name}`).toContain(fixing.joint);
          expect(
            step.closeUps.map((closeUp) => closeUp.type),
            `${step.id}: ${fixing.name}`,
          ).toContain(fixing.joint);
        }
      }
    }
  });

  it("keeps every picture label to 3 words", () => {
    for (const build of benches()) {
      for (const step of build.steps) {
        const closeUps = [
          ...step.closeUps,
          ...step.techniques.map((technique) => technique.closeUp),
        ];
        for (const pill of closeUps.flatMap((closeUp) => closeUp.pills ?? [])) {
          expect(pill.says.split(/\s+/).length, `${step.id}: ${pill.says}`).toBeLessThanOrEqual(3);
        }
      }
    }
  });
});

describe("on the bench (#813)", () => {
  const stepOf = (build: Build, id: string) => {
    const step = build.steps.find((each) => each.id === id);
    if (step === undefined) throw new Error(`No step ${id}.`);
    return step;
  };
  const techniques = (build: Build, id: string) =>
    stepOf(build, id).techniques.map(
      (technique) => `${technique.closeUp.type} ${technique.first ? "full" : "how?"}`,
    );

  it("shows measure and mark in full on the marking step, then as a how? tap", () => {
    const build = built(goldenBench);

    expect(techniques(build, "mark-lengths")).toEqual(["measure-mark full"]);
    expect(techniques(build, "end-frames")).toContain("measure-mark how?");
    // Ticked at the first piece marked, B's 1450.
    const mark = stepOf(build, "mark-lengths").techniques[0]?.closeUp;
    expect(mark?.pills?.map((pill) => pill.says)).toContain("Tick 1450");
  });

  it("shows driving a screw, the clutch with it, the first time a long screw goes in", () => {
    const build = built(goldenBench);
    const driving = (id: string) =>
      stepOf(build, id).techniques.find((each) => each.closeUp.type === "driving-screw");

    expect(techniques(build, "end-frames")).toContain("driving-screw full");
    expect(driving("end-frames")?.closeUp.pills?.map((pill) => pill.says)).toContain("Clutch ring");
    expect(techniques(build, "long-rails")).toEqual(["driving-screw how?"]);
    expect(driving("long-rails")?.closeUp.pills?.map((pill) => pill.says)).not.toContain(
      "Clutch ring",
    );
  });

  it("draws the end frames' and long rails' joints as a screwed overlap, the rail on the leg", () => {
    const build = built(goldenBench);

    for (const id of ["end-frames", "long-rails"]) {
      expect(stepOf(build, id).closeUps[0]?.type).toBe("screwed-overlap");
    }
  });

  it("draws the user's own square: a speed square in Your tools is a speed square", () => {
    const tools = ["Tape measure", "Pencil", "Speed square", "Hand saw", "Workmate"];
    const mark = stepOf(built(goldenBench, { tools }), "mark-lengths").techniques[0]?.closeUp;

    expect(mark?.notes[0]).toBe("Your tape, pencil and speed square.");
  });

  it("shows the bracket close-up, sized to the leg, where the brackets go on", () => {
    const build = built(goldenBench);

    for (const id of ["stand-on-bases", "fit-supports"]) {
      expect(stepOf(build, id).closeUps.map((closeUp) => closeUp.type)).toEqual(["bracket"]);
    }
  });
});

describe("driving a screw", () => {
  const piece = { wide: 95, thick: 45, name: "rail" };

  it("shades the end zone at each end, the pilot rule's 25 mm, a spot to drill first inside it", () => {
    const model = drivingModel({ piece, zone: 25 });

    expect(model.zones.map((zone) => [zone.x, zone.w])).toEqual([
      [0, 25],
      [model.piece.w - 25, 25],
    ]);
    expect(model.drillFirst.x).toBeLessThan(25);
    expect(model.justScrew.x).toBeGreaterThan(25);
    expect(model.justScrew.x).toBeLessThan(model.piece.w - 25);
  });

  it("reads Drill first and Just screw, and shows the clutch ring only when asked", () => {
    const says = (clutch: boolean) =>
      (drivingCloseUp({ piece, zone: 25, yours: true, clutch }).pills ?? []).map((pill) => [
        pill.says,
        pill.tone,
      ]);

    expect(says(false)).toEqual([
      ["Drill first", "warn"],
      ["Just screw", "fine"],
    ]);
    expect(says(true)).toContainEqual(["Clutch ring", undefined]);
    const ring = drivingCloseUp({ piece, zone: 25, yours: true, clutch: true }).faces?.filter(
      (face) => face.fill === "ring",
    );
    expect(ring).toHaveLength(1);
    expect(drivingCloseUp({ piece, zone: 25, yours: true, clutch: false }).type).toBe(
      "driving-screw",
    );
  });
});

describe("measuring and marking a length", () => {
  const length = { wide: 95, thick: 45, name: "B" };

  it("hooks the tape over the end, ticks the step's number and squares a line right across", () => {
    const model = markModel({ piece: length, at: 1450, square: "speed" });

    expect([model.piece.d, model.piece.h]).toEqual([95, 45]);
    expect(model.hook.x + model.hook.w).toBe(model.piece.x);
    expect(model.line.from.y).toBe(0);
    expect(model.line.to.y).toBe(95);
    expect(model.line.from.x).toBe(model.tick.from.x);
    // The offcut's X on the far side of the line.
    expect(model.cross.x).toBeGreaterThan(model.line.from.x);
  });

  it("draws the user's own square: a speed square's triangle, or an L-square's blade and stock", () => {
    const triangles = (square: "speed" | "l-square" | undefined) =>
      markCloseUp({ piece: length, at: 1450, square, yours: true }).faces?.filter(
        (face) => face.fill === "tool" && face.points.length === 3,
      ).length;

    expect(triangles("speed")).toBeGreaterThan(0);
    expect(triangles("l-square")).toBe(0);
    expect(triangles(undefined)).toBe(0);
  });

  it("reads in 4 pills, the tick at the step's own number", () => {
    const drawn = markCloseUp({ piece: length, at: 450, square: "speed", yours: true });
    const read = [...(drawn.pills ?? [])].sort((a, b) => (a.badge ?? 0) - (b.badge ?? 0));

    expect(drawn.type).toBe("measure-mark");
    expect(read.map((pill) => pill.says)).toEqual([
      "Hook the end",
      "Tick 450",
      "Square a line",
      "X the offcut",
    ]);
    expect(drawn.notes[0]).toBe("Your tape, pencil and speed square.");
    expect(markCloseUp({ piece: length, at: 450, square: undefined, yours: false }).notes[0]).toBe(
      "A tape, pencil and square.",
    );
  });
});

describe("a screwed overlap", () => {
  const overlap = {
    over: { across: 95, thick: 45, name: "rail" },
    under: { across: 45, thick: 95, name: "leg" },
  };

  it("greens where one piece sits on the other, its 2 crosses inside on a diagonal", () => {
    const model = overlapModel(overlap);

    expect([model.green.w, model.green.d]).toEqual([45, 95]);
    expect(model.green.z).toBe(45 + 95);
    const [first, second] = model.crosses;
    for (const cross of model.crosses) {
      expect(cross.x).toBeGreaterThan(model.green.x);
      expect(cross.x).toBeLessThan(model.green.x + model.green.w);
      expect(cross.y).toBeGreaterThan(model.green.y);
      expect(cross.y).toBeLessThan(model.green.y + model.green.d);
    }
    // Not on one grain line: apart both ways.
    expect(first?.x).not.toBe(second?.x);
    expect(first?.y).not.toBe(second?.y);
  });

  it("follows a sheet on a rail: the strip as wide as the rail", () => {
    const model = overlapModel({
      over: { across: 180, thick: 18, name: "top" },
      under: { across: 38, thick: 89, name: "rail" },
    });

    expect([model.green.w, model.green.z]).toEqual([38, 89 + 18]);
  });

  it("reads: only in the green, 2 crosses, by eye", () => {
    const drawn = overlapCloseUp(overlap);

    expect(drawn.type).toBe("screwed-overlap");
    expect(drawn.title).toBe("Mark your screw spots");
    expect(drawn.pills?.map((pill) => pill.says).sort()).toEqual(["2 crosses", "Only in green"]);
    expect(drawn.fixings).toHaveLength(2);
    expect(drawn.notes.join(" ")).toMatch(/by eye/i);
  });
});

describe("an angle bracket in a corner", () => {
  const corner = {
    upright: { across: 70, deep: 70, name: "post" },
    flat: { across: 70, thick: 70, name: "beam" },
    arm: 40,
  };

  it("is sized to a made-up 70 × 70 corner: its arms the bracket's, its width inside the face", () => {
    const model = bracketModel(corner);
    const [upright, flat] = [model.upright, model.flat];

    expect([upright.w, upright.d]).toEqual([70, 70]);
    expect([flat.d, flat.h]).toEqual([70, 70]);
    expect(upright.z).toBe(flat.z + flat.h);
    const [standing, lying] = model.plates;
    // One arm up the upright's face, one along the flat piece's top, each the bracket's 40.
    expect(standing?.h).toBe(40);
    expect(lying?.w).toBe(40);
    expect(standing?.x).toBe(upright.x + upright.w);
    expect(lying?.z).toBe(flat.z + flat.h);
    for (const plate of model.plates) expect(within(plate, upright, "y")).toBe(true);
  });

  it("narrows to a narrower face, and puts 2 screws into each piece", () => {
    const narrow = bracketModel({ ...corner, upright: { ...corner.upright, across: 30 } });

    expect(narrow.plates[0]?.d).toBeLessThan(30);
    expect(within(narrow.plates[0] as Box, narrow.upright, "y")).toBe(true);
    expect(
      narrow.holes.filter((hole) => hole.x === narrow.upright.x + narrow.upright.w),
    ).toHaveLength(2);
    expect(narrow.holes.filter((hole) => hole.z === narrow.flat.z + narrow.flat.h)).toHaveLength(2);
  });

  it("reads in pills: tight in the corner, mark the holes, 2 screws each, by eye", () => {
    const drawn = bracketCloseUp(corner);

    expect(drawn.type).toBe("bracket");
    // In badge order; on the drawing each sits level with what it points at.
    const read = [...(drawn.pills ?? [])].sort((a, b) => (a.badge ?? 0) - (b.badge ?? 0));
    expect(read.map((pill) => [pill.badge, pill.says])).toEqual([
      [1, "Tight in corner"],
      [2, "Mark the holes"],
      [3, "2 screws each"],
    ]);
    expect(drawn.notes.join(" ")).toMatch(/by eye/i);
    // Everything drawn sits inside the drawing.
    for (const face of drawn.faces ?? []) {
      for (const point of face.points) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(drawn.width);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(drawn.height);
      }
    }
  });
});
