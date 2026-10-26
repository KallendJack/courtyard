import { bracketArm, bracketBoxes, bracketWidth } from "../close-ups/bracket.ts";
import type { Scene, SceneMark, ScenePiece } from "../scene.ts";
import { castorScene } from "./castor-pictures.ts";
import { cutScene, markScene } from "./cut-scenes.ts";
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

/**
 * The brackets a step fits, drawn as the L-shapes they are, lit (#813): two at each leg's foot
 * as the frame stands on its bases, one on its face towards the bench's middle and one on its
 * face towards the other leg; and one in the corner at each end of each support, where it meets
 * its rail.
 */
const bracketsOf = (setting: SceneSetting, id: string): ScenePiece[] => {
  const s = setting.shape;
  const name = setting.parameters.fixings.brackets.name;
  const arm = bracketArm(name);
  const boxesOf = (label: string) =>
    setting.parts.find((part) => part.label === label)?.boxes ?? [];
  const middle = s.length / 2;
  const back = (s.front + s.back) / 2;
  const boxes =
    id === "stand-on-bases"
      ? boxesOf("A").flatMap((leg) => {
          const towards = leg.x < middle ? 1 : -1;
          const across = leg.y < back ? 1 : -1;
          return [
            ...bracketBoxes({
              at: { x: towards > 0 ? leg.x + leg.w : leg.x, y: leg.y + leg.d / 2, z: leg.z },
              ways: [
                { axis: "z", sign: 1 },
                { axis: "x", sign: towards },
              ],
              along: "y",
              arm,
              width: bracketWidth(arm, leg.d),
            }),
            ...bracketBoxes({
              at: { x: leg.x + leg.w / 2, y: across > 0 ? leg.y + leg.d : leg.y, z: leg.z },
              ways: [
                { axis: "z", sign: 1 },
                { axis: "y", sign: across },
              ],
              along: "x",
              arm,
              width: bracketWidth(arm, leg.w),
            }),
          ];
        })
      : id === "fit-supports"
        ? ["F", "D"].flatMap((label) =>
            boxesOf(label).flatMap((support) =>
              ([1, -1] as const).flatMap((end) =>
                bracketBoxes({
                  at: {
                    x: support.x + support.w,
                    y: end > 0 ? support.y : support.y + support.d,
                    z: support.z + support.h / 2,
                  },
                  ways: [
                    { axis: "y", sign: end },
                    { axis: "x", sign: 1 },
                  ],
                  along: "z",
                  arm,
                  width: bracketWidth(arm, support.h),
                }),
              ),
            ),
          )
        : [];
  return boxes.length === 0 ? [] : [{ kind: "fitted", name, label: null, tone: "lit", boxes }];
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
        pieces: [
          ...soFar(setting, { shown: new Set(step.shown), lit: new Set(step.lit) }),
          ...bracketsOf(setting, step.id),
        ],
        marks: assemblyMarks(setting, step.id),
      };
  }
};
