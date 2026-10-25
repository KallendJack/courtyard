import type { Scene, SceneMark } from "../scene.ts";
import { baseCloseUp } from "./close-ups.ts";
import { cutScene, markScene } from "./cut-scenes.ts";
import { castorFixingNames } from "./parameters.ts";
import {
  at,
  box,
  nameOf,
  OUT,
  part,
  type SceneSetting,
  soFar,
  tenth,
  toolIf,
  whole,
} from "./scene-pieces.ts";

// Each step's picture (#754; Paper, 2 · Agreed, "Fabrication · At the bench · Fold 933×645"): the
// job as it's done, not the finished bench. The length marked and cut (`cut-scenes.ts`); an end
// frame flat on the floor; a castor base upside down; or the frame as far as it's built. Every
// number drawn on it is the Build's own. The tools are only pictures (a Workmate is about 600
// long and 780 high) and only drawn when they're to hand; where one isn't, its place is still
// marked.

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
    case "stand-on-bases": {
      // At the near leg's foot, as the steps say: one bracket on its face towards the bench's
      // middle, one on its face towards the other leg.
      const x = s.left + s.wide;
      const y = s.front + 2 * s.thick;
      const z = s.foot + 20;
      return [
        {
          kind: "arrow",
          from: at(x + 300, y - s.thick / 2, z + 200),
          to: at(x, y - s.thick / 2, z),
          says: "bracket on the face to the middle",
        },
        {
          kind: "arrow",
          from: at(x - s.wide / 2, y + 250, z + 450),
          to: at(x - s.wide / 2, y, z),
          says: "bracket on the face to the other leg",
        },
      ];
    }
    case "fit-supports": {
      // A bracket in the corner at each end of each support; drawn at its front end.
      const bracketAt = (label: string, says: string): SceneMark[] => {
        const end = setting.parts.find((each) => each.label === label)?.boxes[0];
        if (end === undefined) return [];
        const corner = at(end.x + end.w, end.y, end.z + end.h / 2);
        return [
          {
            kind: "arrow",
            from: at(corner.x + 250, corner.y - 150, corner.z + 250),
            to: corner,
            says,
          },
        ];
      };
      return [
        {
          kind: "size",
          from: at(s.left, s.front - OUT, s.legTop),
          to: at(s.left + s.frameLength / 2, s.front - OUT, s.legTop),
          mm: s.frameLength / 2,
        },
        ...bracketAt("F", "a bracket at each end"),
        ...bracketAt("D", "and at each end of D"),
      ];
    }
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
      return cutScene(setting);
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
