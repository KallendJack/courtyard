import type { Box } from "../build.ts";
import { bracketArm, bracketBoxes, bracketWidth } from "../close-ups/bracket.ts";
import type { At, Scene, SceneMark, ScenePiece } from "../scene.ts";
import { castorScene } from "./castor-pictures.ts";
import { cutScene, markScene } from "./cut-scenes.ts";
import { castorNuts, legBrackets } from "./frame.ts";
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

/**
 * One end frame on the floor (Paper, 2 · Agreed, "Fabrication · End frames in 3D, your kit · Fold
 * (#785, #788)"): the legs tall and thin on offcuts, the rails across them, the clamps and the
 * square at the far leg's top joint; the length marked from the floor end in gold beside that
 * leg, and the bottom rail's screw spots, red where they're drilled first. Framed on the frame,
 * so it fills the picture as the board's does.
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
  const legs = legsAt.map((x) => box(x, 0, lift, s.thick, s.leg, s.wide));
  const rails = [0, lower].map((y) => box(0, y, legTop, s.endRail, s.wide, s.thick));
  return {
    title: "On the floor, on offcuts",
    // As the board looks: the floor ends bottom left, the top rail and its clamp top right.
    view: { turn: -135, tilt: 35 },
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
      part("A", nameOf(setting, "A"), "lit", legs),
      part("C", nameOf(setting, "C"), "lit", rails),
      // A clamp beside the top joint's crosses, on the far leg: its bar, and a jaw each side.
      ...toolIf(setting.toHand, "clamps", [
        box(far + s.thick + 10, s.wide - 25, 5, 20, 20, top + 60),
        box(far - 30, s.wide - 30, top, s.thick + 60, 30, 20),
        box(far - 30, s.wide - 30, 5, s.thick + 60, 30, lift - 10),
      ]),
      // The square in that corner: its stock along the leg's outside, its blade on the rail.
      ...toolIf(setting.toHand, "square", [
        box(s.endRail, 0, top - 30, 20, 250, 35),
        box(s.endRail - 200, 0, top, 200, 25, 2),
      ]),
    ],
    marks: [
      {
        kind: "size",
        from: at(s.endRail + OUT / 2, s.leg - s.shelfHeight, legTop),
        to: at(s.endRail + OUT / 2, s.leg, legTop),
        mm: s.shelfHeight,
      },
      // Two crosses where the bottom rail sits on each leg, on a diagonal in the green, as the
      // screw spots' close-up draws them: one rail, as the board has it.
      ...legsAt.flatMap((x) =>
        [
          at(x + s.thick / 3, lower + s.wide / 4, top),
          at(x + (2 * s.thick) / 3, lower + (3 * s.wide) / 4, top),
        ].map((spot): SceneMark => ({ kind: "spot", at: spot, first })),
      ),
    ],
    framed: [...legs, ...rails],
    goes: "The two ends",
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
      // As the board places them: beside the length's floor end, outside the top rail's end, on
      // the bottom rail, and at the clamp.
      return [
        at(s.endRail + 2 * OUT, s.leg - s.shelfHeight / 5, legTop),
        at(s.endRail + 2 * OUT, s.wide * 2, legTop),
        at(s.endRail / 2, lower + s.wide / 2, top),
        at(s.endRail - s.thick / 2, s.wide / 2, top + 160),
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
 * face towards the base's end, clear of the castor's nuts (#835); and one in the corner at each
 * end of each support, where it meets its rail.
 */
const bracketsOf = (setting: SceneSetting, id: string): ScenePiece[] => {
  const name = setting.parameters.fixings.brackets.name;
  const arm = bracketArm(name);
  const boxesOf = (label: string) =>
    setting.parts.find((part) => part.label === label)?.boxes ?? [];
  const boxes =
    id === "stand-on-bases"
      ? legBrackets(setting.parameters, setting.shape)
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

/**
 * What the castors' bolts leave on the bases' tops once they're on (#835): each nut and its
 * bolt's end, drawn at their size, so a leg standing on them would show before anyone drills.
 */
const nutsOf = (setting: SceneSetting, shown: readonly string[]): ScenePiece[] => {
  const castors = setting.parameters.castors;
  if (!castors || !shown.includes("E")) return [];
  return [
    {
      kind: "fitted",
      name: `${castorFixingNames(castors, setting.boltLength).nuts} and bolt ends`,
      label: null,
      tone: "built",
      boxes: castorNuts(setting.parameters, setting.shape, setting.fitted, setting.boltLength),
    },
  ];
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
          ...nutsOf(setting, step.shown),
          ...bracketsOf(setting, step.id),
        ],
        marks: assemblyMarks(setting, step.id),
      };
  }
};
