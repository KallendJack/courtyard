import { bracketArm, bracketCloseUp } from "../close-ups/bracket.ts";
import { overlapCloseUp } from "../close-ups/overlap.ts";
import { legEndOnCloseUp, longSideCloseUp, screwSpotsWalk } from "./close-ups.ts";
import { type Shape, whole } from "./frame.ts";
import type { BenchParameters } from "./parameters.ts";
import { act, type Draft } from "./preparing.ts";
import {
  bracketing,
  drilling,
  drillsFor,
  type Pilots,
  SCREWS_PER_BRACKET,
  SPLIT_TIP,
  screwing,
  wordsWith,
} from "./screws.ts";

// Joining the frame: the two end frames, the long rails between them, and the frame stood on its
// castor bases, with the castors fitted to the bases between (#783). Each joint's screws go where the rail sits on the leg, marked by eye (#789).

/**
 * The brackets holding each leg to its castor base: one on the face towards the bench's middle and
 * one on the face towards the other leg. A single bracket lets a bench pushed on castors work the
 * joint loose; screws up through the base can't go in, as the castor plates cover the legs' feet.
 */
const BRACKETS_PER_LEG = 2;

/** Angle brackets, each with its screws. */
export const bracketed = (p: BenchParameters, count: number) => [
  { name: p.fixings.brackets.name, count, joint: "bracket" as const },
  { name: bracketScrewsOf(p), count: count * SCREWS_PER_BRACKET, joint: "bracket" as const },
];

/** The screws a bracket takes: their own, or the sheet's. */
export const bracketScrewsOf = (p: BenchParameters) =>
  (p.fixings.bracketScrews ?? p.fixings.sheetScrews).name;

/** A rail screwed on a leg: the rail's face as it lies, `rail` wide, on the leg's, `leg` (#813). */
const railOnLeg = (s: Shape, rail: number, leg: number) =>
  overlapCloseUp({
    over: { across: rail, thick: s.thick, name: "rail" },
    under: { across: leg, thick: s.wide, name: "leg" },
  });

export const frameDrafts = (options: {
  parameters: BenchParameters;
  shape: Shape;
  pilots: Pilots;
  /** The castor step, when the bench has castors: after the rails, before standing on the bases. */
  castors: Draft | null;
}): Draft[] => {
  const { parameters: p, shape: s, pilots } = options;
  const frameScrews = {
    name: p.fixings.frameScrews.name,
    count: 16,
    joint: "screwed-overlap" as const,
  };
  const shelfUp = whole(s.shelfHeight);
  /** The frame's screws driven into a rail: its end zone, and the clutch the first time. */
  const driving = {
    type: "driving-screw" as const,
    piece: { wide: s.wide, thick: s.thick, name: "rail" },
    screw: p.fixings.frameScrews.name,
  };
  return [
    {
      id: "end-frames",
      on: true,
      title: "Make the two end frames",
      minutes: 20,
      parts: ["A", "C"],
      tools: ["tape-measure", "pencil", "square", "clamps", ...drilling(pilots.endFrames)],
      safety: ["safety-glasses"],
      drills: drillsFor(pilots.endFrames),
      fixings: [frameScrews],
      batch: "One joint at a time: crosses, screws, then the next. Both frames the same way.",
      // In the board's words (#826): where the screws go and whether to drill first are on the
      // picture, the screw spots' close-up.
      actions: [
        act(
          `Both legs (A) side by side, ends level: mark ${shelfUp} from the floor end across both.`,
          `A × 2: line ${shelfUp} up across both.`,
        ),
        act(
          "Lay them tall and thin on offcuts. Top rail (C) flush with the top ends.",
          `On edge, on offcuts; C flush with the tops, ${whole(s.endRail)} outside.`,
        ),
        act(
          "Bottom rail's lower edge on your line, square to the leg. Mark 2 crosses, clamp beside them.",
          "Bottom C on the line, square; crosses, then clamp.",
        ),
        act(
          "Screw where the clamp isn't. Move the clamp, second screw. Next joint.",
          pilots.endFrames ? "Screw, 3 mm pilots; move the clamp." : "Screw; move the clamp.",
        ),
      ],
      tips: [
        ...(pilots.endFrames
          ? ["The crosses are near the leg's end: drill a 3 mm pilot hole at each first."]
          : [SPLIT_TIP]),
      ],
      // The rail lies across the leg's narrow face, the leg on its edge.
      closeUps: [railOnLeg(s, s.wide, s.thick), legEndOnCloseUp(s)],
      techniques: [
        { type: "measure-mark", piece: { wide: s.wide, thick: s.thick, name: "A" }, at: shelfUp },
        driving,
      ],
      // The first step that screws a rail to a leg shows where its screws can go.
      walkThrough: screwSpotsWalk(),
      check: {
        says: "Measure corner to corner both ways. The same within 2 mm means it's square.",
        photo: "Both end frames, flat, from above.",
      },
      words: wordsWith(pilots.endFrames, "flush", "square"),
    },
    {
      id: "long-rails",
      on: true,
      title: "Join the end frames with the long rails",
      minutes: 30,
      helper: true,
      parts: ["B"],
      tools: ["tape-measure", "clamps", "square", ...drilling(pilots.longRails)],
      safety: ["safety-glasses"],
      drills: drillsFor(pilots.longRails),
      fixings: [frameScrews],
      batch: "One joint at a time: the front's top rail, its bottom rail, then the back the same.",
      actions: [
        act(
          `With a helper, stand both end frames up, rails in, ${whole(s.frameLength)} apart outside.`,
          `Frames ${whole(s.frameLength)} outside, rails in.`,
        ),
        act(
          "Clamp a top long rail (B) across the front, flush with the ends and tops.",
          "Upper B flush with ends and tops.",
        ),
        screwing(
          pilots.longRails,
          "Mark 2 crosses where the rail sits on each leg.",
          "2 crosses a joint.",
        ),
        act(
          `Lower rail ${shelfUp} up at both ends, level with the end rails. Then the back.`,
          `Lower B ${shelfUp} up; back the same.`,
        ),
      ],
      // The rail on the leg's wide face, the frame standing.
      closeUps: [railOnLeg(s, s.wide, s.wide), longSideCloseUp(s)],
      techniques: [driving],
      check: {
        says: "Measure corner to corner across the top, both ways: the same within 2 mm.",
        photo: "The frame standing, from a front corner.",
      },
      words: wordsWith(pilots.longRails, "flush"),
    },
    ...(options.castors ? [options.castors] : []),
    {
      id: "stand-on-bases",
      on: options.castors !== null,
      title: "Stand the frame on its bases",
      minutes: 30,
      helper: true,
      parts: ["E"],
      // The bases went on with their castors; this joins them to the frame.
      adds: [],
      tools: ["square", "clamps", "pencil", ...drilling(pilots.brackets)],
      safety: ["safety-glasses"],
      drills: drillsFor(pilots.brackets),
      fixings: bracketed(p, 4 * BRACKETS_PER_LEG),
      batch: "One leg at a time: square, clamp, both brackets, then the next.",
      actions: [
        act(
          "With a helper, frame on its back. A base (E) across each end's feet, castors out.",
          "Frame on its back; E flush with the outside.",
        ),
        act("Square each leg to its base, then clamp the base to both legs.", "Square, clamp."),
        act(
          "Two angle brackets a leg: one facing the middle, one facing the other leg.",
          `${BRACKETS_PER_LEG} brackets a leg.`,
        ),
        bracketing(pilots.brackets),
      ],
      tips: ["Each base flush with the outside of its legs and the long rails."],
      // A leg's face towards the middle, on its base (#813).
      closeUps: [
        bracketCloseUp({
          upright: { across: s.thick, deep: s.wide, name: "leg" },
          flat: { across: s.wideWidth, thick: s.wideThick, name: "base" },
          arm: bracketArm(p.fixings.brackets.name),
        }),
      ],
      techniques: [
        {
          type: "driving-screw",
          piece: { wide: s.wideWidth, thick: s.wideThick, name: "base" },
          screw: bracketScrewsOf(p),
        },
      ],
      check: {
        says: "Stood up, all four castors touch the floor and the frame doesn't rock.",
        photo: "The frame on its castors.",
      },
      words: wordsWith(pilots.brackets, "flush", "square"),
    },
  ];
};
