import type { Scene, SceneMark, ScenePiece } from "../build.ts";
import { baseCloseUp } from "./close-ups.ts";
import { castorFixingNames } from "./parameters.ts";
import { markedLengths, sawInUse, ticksOf } from "./preparing.ts";
import {
  at,
  box,
  CLEAR,
  JAWS,
  nameOf,
  OUT,
  part,
  type SceneSetting,
  SUPPORT_IN,
  sectionOf,
  soFar,
  tenth,
  toolIf,
  whole,
  workmate,
} from "./scene-pieces.ts";

// Each step's picture (#754; Paper, 2 · Agreed, "Fabrication · At the bench · Fold 933×645"): the
// job as it's done, not the finished bench. The length in the Workmate's jaws with its line, the
// saw and the waste side; an end frame flat on the floor; a castor base upside down; or the frame
// as far as it's built. Every number drawn on it is the Build's own. The tools are only pictures
// (a Workmate is about 600 long and 780 high) and only drawn when they're to hand; where one
// isn't, its place is still marked.

/** The first length marked, flat on the Workmate: the tape hooked on its end, a tick at each piece. */
const markScene = (setting: SceneSetting): Scene => {
  const length = markedLengths(setting.cutPlan)[0];
  const first = length?.cuts[0];
  if (length === undefined || first === undefined) return whole(setting, []);
  const { wide, thick } = sectionOf(setting, length.stock);
  const top = JAWS.top;
  const ticks = ticksOf(length);
  const last = ticks.at(-1)?.at ?? 0;
  const square = ticks[0]?.at ?? 0;
  const benched = setting.toHand.has("folding-workbench");
  return {
    title: benched ? "On the Workmate" : "On something flat",
    // Along the length from its checked end, as the board has it, so it fills the picture.
    view: { turn: -50, tilt: 45 },
    pieces: [
      part(first.label, nameOf(setting, first.label), "lit", [
        box(0, 0, top - thick, length.stockLength, wide, thick),
      ]),
      ...toolIf(
        setting.toHand,
        "folding-workbench",
        workmate((length.stockLength - JAWS.length) / 2, wide),
      ),
      ...toolIf(setting.toHand, "tape-measure", [
        box(-3, 0, top - thick, 3, 25, thick + 3),
        box(last + 40, 10, top, 70, 70, 35),
      ]),
      ...toolIf(setting.toHand, "square", [
        box(square, -20, top - 30, 150, 20, 35),
        box(square, 0, top, 25, 200, 2),
      ]),
    ],
    marks: [
      ...ticks.map(
        (tick): SceneMark => ({
          kind: "line",
          from: at(tick.at, 0, top),
          to: at(tick.at, wide, top),
          says: `${tick.label} ${tick.length}`,
        }),
      ),
      ...ticks.map(
        (tick, index): SceneMark => ({
          kind: "size",
          from: at(0, -OUT * (index + 1), top),
          to: at(tick.at, -OUT * (index + 1), top),
          mm: tick.at,
        }),
      ),
      { kind: "note", at: at(0, wide / 2, top), says: "check this end is square", tone: "check" },
    ],
  };
};

/**
 * The first cut of the first length: the piece held in the Workmate's jaws (or clamped to a bench
 * for a circular saw) with the line just past them, the long end on a support, the offcut beyond.
 */
const cutScene = (setting: SceneSetting, circular: boolean): Scene => {
  const plan = setting.cutPlan.timber[0];
  const cut = plan?.lengths[0]?.cuts[0];
  if (plan === undefined || cut === undefined) return whole(setting, []);
  const { wide, thick } = sectionOf(setting, plan.stock);
  const top = JAWS.top;
  const line = cut.length;
  const total = plan.stockLength;
  const saw = line + setting.cutPlan.kerf / 2;
  const held = line - CLEAR - JAWS.length;
  // The longer side sags as the cut goes through, so the support goes under it.
  const support = line >= total - line ? SUPPORT_IN - 50 : total - SUPPORT_IN - 50;
  const benched = !circular && setting.toHand.has("folding-workbench");
  return {
    title: circular ? "Clamped to the bench" : benched ? "In the Workmate" : "Cutting the length",
    // From the side and above, along the length, as the board has it.
    view: { turn: -50, tilt: 30 },
    pieces: [
      part(cut.label, nameOf(setting, cut.label), "lit", [
        box(0, 0, top - thick, line, wide, thick),
      ]),
      {
        kind: "offcut",
        name: "Offcut",
        label: null,
        tone: "plain",
        boxes: [box(line, 0, top - thick, total - line, wide, thick)],
      },
      ...(circular
        ? [
            {
              kind: "tool",
              name: "Bench",
              label: null,
              tone: "plain",
              boxes: [box(line - CLEAR - 900, -300, 0, 900, wide + 600, top - thick)],
            } satisfies ScenePiece,
          ]
        : toolIf(setting.toHand, "folding-workbench", workmate(held, wide))),
      ...toolIf(setting.toHand, "long-end-support", [
        box(support, -200, 0, 100, wide + 400, top - thick),
      ]),
      ...(circular
        ? toolIf(setting.toHand, "circular-saw", [box(line - 230, -30, top, 240, wide + 60, 90)])
        : toolIf(setting.toHand, "hand-saw", [box(saw - 1, -60, top, 2, wide + 120, 110)])),
    ],
    // Each mark's words apart from the others': the size above the piece, the saw's arrow higher
    // still, the clamp's at the Workmate's legs and the waste side's at the offcut's far end.
    marks: [
      { kind: "size", from: at(0, 0, top + 200), to: at(line, 0, top + 200), mm: cut.length },
      { kind: "line", from: at(line, 0, top), to: at(line, wide, top), says: `cut at ${line}` },
      {
        kind: "arrow",
        from: at(saw, wide / 2, top + 450),
        to: at(saw, wide / 2, top),
        says: "saw here, just past the line",
      },
      {
        kind: "note",
        at: at(support + 50, wide / 2, (top - thick) / 2),
        says: "support the long end here",
        tone: "plain",
      },
      {
        kind: "note",
        at: circular
          ? at(line - 200, wide / 2, top)
          : at(held + JAWS.length / 2, -JAWS.width, top / 2),
        says: circular ? "clamp here" : "clamped in the jaws",
        tone: "plain",
      },
      {
        kind: "note",
        at: at(total - SUPPORT_IN, wide / 2, top),
        says: "offcut · waste side",
        tone: "waste",
      },
    ],
  };
};

/** One castor base upside down on the floor, its castors on it and a bolt through each hole. */
const castorScene = (setting: SceneSetting): Scene => {
  const castors = setting.parameters.castors;
  const s = setting.shape;
  if (!castors) return whole(setting, []);
  const closeUp = baseCloseUp(s, castors);
  const plates = closeUp.pieces.filter((piece) => piece.label === "castor");
  const plate = castors.plate.thickness.value;
  const bolt = castors.bolt.diameter.value;
  const head = plate + castors.washer.thickness.value + 4;
  // The arrow at the far castor's last hole, its words clear of the near castor's note.
  const hole = closeUp.fixings.at(-1);
  const near = plates[0];
  return {
    title: "A castor base, upside down",
    view: { turn: -25, tilt: 45 },
    pieces: [
      part("E", nameOf(setting, "E"), "lit", [
        box(0, 0, 0, s.frameDepth, s.wideWidth, s.wideThick),
      ]),
      {
        kind: "fitted",
        name: castors.name,
        label: null,
        tone: "plain",
        // Each castor's plate on the base, and its wheel's housing standing up from the plate.
        boxes: plates.flatMap((each) => [
          box(each.x, each.y, s.wideThick, each.w, each.h, plate),
          box(
            each.x + each.w / 4,
            each.y + each.h / 4,
            s.wideThick + plate,
            each.w / 2,
            each.h / 2,
            s.castor - plate,
          ),
        ]),
      },
      {
        kind: "fitted",
        name: castorFixingNames(castors, setting.boltLength).bolts,
        label: null,
        tone: "plain",
        boxes: closeUp.fixings.map((each) =>
          box(each.x - bolt / 2, each.y - bolt / 2, 0, bolt, bolt, s.wideThick + head),
        ),
      },
    ],
    marks: [
      {
        kind: "size",
        from: at(0, -OUT, s.wideThick),
        to: at(s.frameDepth, -OUT, s.wideThick),
        mm: s.frameDepth,
      },
      {
        kind: "size",
        from: at(0, s.wideWidth + OUT, s.wideThick),
        to: at(near?.x ?? 0, s.wideWidth + OUT, s.wideThick),
        mm: near?.x ?? 0,
      },
      ...(hole === undefined
        ? []
        : [
            {
              kind: "arrow",
              from: at(hole.x, hole.y, s.wideThick + 250),
              to: at(hole.x, hole.y, s.wideThick + head),
              says: "bolt down through the plate and the base",
            } satisfies SceneMark,
          ]),
      {
        kind: "note",
        at: at((near?.x ?? 0) + (near?.w ?? 0) / 2, s.wideWidth / 2, s.wideThick + s.castor + 60),
        says: "washer, plate, base, washer, nut",
        tone: "plain",
      },
    ],
  };
};

/** One end frame flat on the floor, outside down: two legs, the rails across them, a square. */
const endFrameScene = (setting: SceneSetting): Scene => {
  const s = setting.shape;
  const top = s.wide + s.thick;
  const lower = s.leg - s.shelfHeight - s.wide;
  const diagonal = tenth(Math.hypot(s.endRail, s.leg));
  return {
    title: "One end frame, flat on the floor",
    view: { turn: -20, tilt: 60 },
    pieces: [
      part(
        "A",
        nameOf(setting, "A"),
        "lit",
        [0, s.endRail - s.thick].map((x) => box(x, 0, 0, s.thick, s.leg, s.wide)),
      ),
      part(
        "C",
        nameOf(setting, "C"),
        "lit",
        [0, lower].map((y) => box(0, y, s.wide, s.endRail, s.wide, s.thick)),
      ),
      ...toolIf(setting.toHand, "square", [
        box(-20, 0, top - 30, 20, 250, 35),
        box(0, 0, top, 200, 25, 2),
      ]),
    ],
    marks: [
      { kind: "check", from: at(0, 0, top), to: at(s.endRail, s.leg, top), mm: diagonal },
      { kind: "check", from: at(s.endRail, 0, top), to: at(0, s.leg, top), mm: diagonal },
      { kind: "size", from: at(0, -OUT, top), to: at(s.endRail, -OUT, top), mm: s.endRail },
      {
        kind: "size",
        from: at(s.endRail + OUT, s.leg - s.shelfHeight, top),
        to: at(s.endRail + OUT, s.leg, top),
        mm: s.shelfHeight,
      },
      {
        kind: "arrow",
        from: at(s.thick / 2, s.wide / 2, top + 200),
        to: at(s.thick / 2, s.wide / 2, top),
        says: "2 screws a joint",
      },
      { kind: "note", at: at(s.endRail / 2, s.leg, 0), says: "floor end", tone: "plain" },
    ],
  };
};

/** What an assembly step marks on the frame so far, from the shape's own numbers. */
const assemblyMarks = (setting: SceneSetting, id: string): SceneMark[] => {
  const s = setting.shape;
  switch (id) {
    case "long-rails": {
      const diagonal = tenth(Math.hypot(s.frameLength, s.frameDepth));
      return [
        {
          kind: "check",
          from: at(s.left, s.front, s.legTop),
          to: at(s.right, s.back, s.legTop),
          mm: diagonal,
        },
        {
          kind: "check",
          from: at(s.right, s.front, s.legTop),
          to: at(s.left, s.back, s.legTop),
          mm: diagonal,
        },
      ];
    }
    case "fit-supports":
      return [
        {
          kind: "size",
          from: at(s.left, s.front - OUT, s.legTop),
          to: at(s.left + s.frameLength / 2, s.front - OUT, s.legTop),
          mm: s.frameLength / 2,
        },
      ];
    case "fit-top":
      return [
        { kind: "size", from: at(0, 0, s.height), to: at(s.left, 0, s.height), mm: s.overhang },
      ];
    default:
      return [];
  }
};

/** Where an assembly step opens from: low for the bases, from the back for the braces, above for the top. */
const ASSEMBLY_VIEWS: Readonly<Record<string, Scene["view"]>> = {
  "stand-on-bases": { turn: -35, tilt: 15 },
  "fit-supports": { turn: -35, tilt: 40 },
  "fit-shelf": { turn: -35, tilt: 35 },
  "fit-braces": { turn: 145, tilt: 25 },
  "fit-top": { turn: -35, tilt: 45 },
};

/**
 * A step's scene, by its ID: the parts shown so far (this step's included) and its own parts,
 * lit, for an assembly step.
 */
export const stepScene = (
  setting: SceneSetting,
  step: { id: string; shown: readonly string[]; lit: readonly string[] },
): Scene => {
  switch (step.id) {
    case "check-delivery":
      return whole(setting, []);
    case "mark-lengths":
      return markScene(setting);
    case "cut-timber":
      return cutScene(setting, sawInUse(setting.toHand) === "circular-saw");
    case "fit-castors":
      return castorScene(setting);
    case "end-frames":
      return endFrameScene(setting);
    case "check-bench": {
      const s = setting.shape;
      return whole(setting, [
        { kind: "size", from: at(0, 0, 0), to: at(0, 0, s.height), mm: s.height },
      ]);
    }
    default:
      return {
        title: "The bench so far",
        view: ASSEMBLY_VIEWS[step.id] ?? { turn: -35, tilt: 25 },
        pieces: soFar(setting, { shown: new Set(step.shown), lit: new Set(step.lit) }),
        marks: assemblyMarks(setting, step.id),
      };
  }
};
