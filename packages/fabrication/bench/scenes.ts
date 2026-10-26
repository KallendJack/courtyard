import type { Box } from "../build.ts";
import { bracketArm, bracketBoxes, bracketWidth } from "../close-ups/bracket.ts";
import type { At, Scene, SceneMark, ScenePiece } from "../scene.ts";
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

/**
 * One end frame on the floor (Paper, 2 · Agreed, "Fabrication · End frames in 3D, your kit · Fold
 * (#785, #788)"): the legs tall and thin on offcuts, the rails across them, the clamps at a joint
 * and the square in the corner; the length marked from the floor end in gold, and each joint's
 * two screw spots, red where they're drilled first.
 */
const endFrameScene = (setting: SceneSetting, first: boolean): Scene => {
  const s = setting.shape;
  // The legs on offcuts as thick as the timber, so a clamp's jaw fits under.
  const lift = s.thick;
  const legTop = lift + s.wide;
  const top = legTop + s.thick;
  const lower = s.leg - s.shelfHeight - s.wide;
  const legsAt = [0, s.endRail - s.thick];
  const far = s.endRail - s.thick;
  return {
    title: "On the floor, on offcuts",
    // From the floor end, as the board looks: the legs run away to the right, the clamps far off.
    view: { turn: -145, tilt: 35 },
    pieces: [
      {
        kind: "support",
        name: "Offcuts",
        label: null,
        tone: "plain",
        boxes: legsAt.flatMap((x) =>
          [0.2, 0.75].map((along) => box(x - 25, s.leg * along, 0, s.thick + 50, s.wide, lift)),
        ),
      },
      part(
        "A",
        nameOf(setting, "A"),
        "lit",
        legsAt.map((x) => box(x, 0, lift, s.thick, s.leg, s.wide)),
      ),
      part(
        "C",
        nameOf(setting, "C"),
        "lit",
        [0, lower].map((y) => box(0, y, legTop, s.endRail, s.wide, s.thick)),
      ),
      // A clamp beside the top joint's crosses, on the far leg: its bar, and a jaw each side.
      ...toolIf(setting.toHand, "clamps", [
        box(far + s.thick + 10, s.wide - 25, 5, 20, 20, top + 60),
        box(far - 30, s.wide - 30, top, s.thick + 60, 30, 20),
        box(far - 30, s.wide - 30, 5, s.thick + 60, 30, lift - 10),
      ]),
      ...toolIf(setting.toHand, "square", [
        box(-20, 0, top - 30, 20, 250, 35),
        box(0, 0, top, 200, 25, 2),
      ]),
    ],
    marks: [
      {
        kind: "size",
        from: at(-OUT / 2, s.leg - s.shelfHeight, legTop),
        to: at(-OUT / 2, s.leg, legTop),
        mm: s.shelfHeight,
      },
      // Two crosses a joint, on a diagonal in the green, as the screw spots' close-up draws them.
      ...legsAt.flatMap((x) =>
        [0, lower].flatMap((y) =>
          [
            at(x + s.thick / 3, y + s.wide / 4, top),
            at(x + (2 * s.thick) / 3, y + (3 * s.wide) / 4, top),
          ].map((spot): SceneMark => ({ kind: "spot", at: spot, first })),
        ),
      ),
    ],
  };
};

/**
 * Where each of a step's lines is done, for its badge (#826), in its scene's mm: what the line
 * acts on, as its board places them. A step with none given has its badges on its lit pieces in
 * turn, each on its top.
 */
const lineSpots = (setting: SceneSetting, id: string, scene: Scene): At[] => {
  const s = setting.shape;
  const topOf = (b: Box) => at(b.x + b.w / 2, b.y + b.d / 2, b.z + b.h);
  switch (id) {
    case "end-frames": {
      const legTop = s.thick + s.wide;
      const top = legTop + s.thick;
      const lower = s.leg - s.shelfHeight - s.wide;
      return [
        at(0, s.leg - s.shelfHeight / 2, legTop),
        at(s.endRail - s.thick / 2, s.wide / 2, top + 120),
        at(s.endRail / 2, lower + s.wide / 2, top),
        at(s.endRail, s.wide / 2, top + 220),
      ];
    }
    default: {
      const lit = scene.pieces.filter((piece) => piece.tone === "lit").flatMap((p) => p.boxes);
      const shown = lit.length > 0 ? lit : scene.pieces.flatMap((piece) => piece.boxes);
      return shown.map(topOf);
    }
  }
};

/** A scene with the badge of each of its step's `lines` lines, at what each acts on (#826). */
const withBadges = (setting: SceneSetting, id: string, scene: Scene, lines: number): Scene => {
  const spots = lineSpots(setting, id, scene);
  const badges = Array.from({ length: lines }, (_, line): SceneMark[] => {
    const spot = spots[line % spots.length];
    if (spot === undefined) return [];
    // A line past the spots given goes on one again, a little higher so the two don't sit as one.
    const up = Math.floor(line / spots.length) * 120;
    return [{ kind: "badge", at: { ...spot, z: spot.z + up }, line: line + 1 }];
  }).flat();
  return { ...scene, marks: [...scene.marks, ...badges] };
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
 * lit, for an assembly step; with a badge for each of its `lines` (#826).
 */
export const stepScene = (
  setting: SceneSetting,
  step: {
    id: string;
    shown: readonly string[];
    lit: readonly string[];
    lines: number;
    /** Whether its screw spots are drilled first. */
    first: boolean;
  },
): Scene => withBadges(setting, step.id, sceneOf(setting, step), step.lines);

const sceneOf = (
  setting: SceneSetting,
  step: { id: string; shown: readonly string[]; lit: readonly string[]; first: boolean },
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
      return endFrameScene(setting, step.first);
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
