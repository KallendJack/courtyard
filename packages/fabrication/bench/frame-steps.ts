import { endFrameCloseUp, longSideCloseUp } from "./close-ups.ts";
import { type Shape, whole } from "./frame.ts";
import type { BenchParameters } from "./parameters.ts";
import { act, type Draft } from "./preparing.ts";
import {
  bracketing,
  drilling,
  type Pilots,
  SCREWS_PER_BRACKET,
  screwing,
  wordsWith,
} from "./screws.ts";
import { screwSpotsWalk } from "./walk-throughs.ts";

// Joining the frame: the two end frames, the long rails between them, and the frame stood on its
// castor bases. Each joint's screws go where the rail sits on the leg, marked by eye (#789).

/**
 * The brackets holding each leg to its castor base: one on the face towards the bench's middle and
 * one on the face towards the other leg. A single bracket lets a bench pushed on castors work the
 * joint loose; screws up through the base can't go in, as the castor plates cover the legs' feet.
 */
const BRACKETS_PER_LEG = 2;

/** Angle brackets, each with its screws. */
export const bracketed = (p: BenchParameters, count: number) => [
  { name: p.fixings.brackets.name, count },
  {
    name: (p.fixings.bracketScrews ?? p.fixings.sheetScrews).name,
    count: count * SCREWS_PER_BRACKET,
  },
];

export const frameDrafts = (options: {
  parameters: BenchParameters;
  shape: Shape;
  pilots: Pilots;
}): Draft[] => {
  const { parameters: p, shape: s, pilots } = options;
  const frameScrews = { name: p.fixings.frameScrews.name, count: 16 };
  const shelfUp = whole(s.shelfHeight);
  return [
    {
      id: "end-frames",
      on: true,
      title: "Make the two end frames",
      minutes: 20,
      parts: ["A", "C"],
      tools: ["tape-measure", "pencil", "square", "clamps", ...drilling(pilots.endFrames)],
      safety: ["safety-glasses"],
      fixings: [frameScrews],
      batch: "One joint at a time: crosses, screws, then the next. Both frames the same way.",
      actions: [
        act(
          `Lay both legs (A) side by side, ends level. Measure ${shelfUp} up from the floor end and square one line across both.`,
          `A × 2: line ${shelfUp} up across both.`,
        ),
        act(
          `Spread them ${whole(s.endRail)} apart outside to outside. Clamp an end rail (C) across, flush with the tops, and check the corner with your square.`,
          `${whole(s.endRail)} outside; C flush with the tops; clamp, square.`,
        ),
        screwing(
          pilots.endFrames,
          "Mark 2 crosses where the rail sits on the leg (below), by eye.",
          "2 crosses a joint.",
        ),
        act(
          "Fit the bottom rail the same way, its underside on your lines.",
          "Bottom C on the lines.",
        ),
      ],
      closeUp: endFrameCloseUp(s),
      // The first step that screws a rail to a leg shows where its screws can go.
      walkThrough: screwSpotsWalk(s),
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
      fixings: [frameScrews],
      batch: "One joint at a time: the front's top rail, its bottom rail, then the back the same.",
      actions: [
        act(
          `With a helper, stand both end frames up, rails facing in, ${whole(s.frameLength)} apart outside to outside.`,
          `Frames ${whole(s.frameLength)} outside, rails in.`,
        ),
        act(
          "Clamp an upper long rail (B) across the front, flush with the frames' ends and the leg tops.",
          "Upper B flush with ends and tops.",
        ),
        screwing(
          pilots.longRails,
          "Mark 2 crosses where the rail sits on the leg, by eye, as on the end frames.",
          "2 crosses a joint.",
        ),
        act(
          `Then the lower rail, its underside level with the bottom end rails' undersides, ${shelfUp} up: measure it at both ends. The same on the back.`,
          `Lower B ${shelfUp} up; back the same.`,
        ),
      ],
      closeUp: longSideCloseUp(s),
      check: {
        says: "Measure corner to corner across the top, both ways: the same within 2 mm.",
        photo: "The frame standing, from a front corner.",
      },
      words: wordsWith(pilots.longRails, "flush"),
    },
    {
      id: "stand-on-bases",
      on: p.castors !== null,
      title: "Stand the frame on its bases",
      minutes: 30,
      helper: true,
      parts: ["E"],
      // The bases went on with their castors; this joins them to the frame.
      adds: [],
      tools: ["square", "clamps", "pencil", ...drilling(pilots.brackets)],
      safety: ["safety-glasses"],
      fixings: bracketed(p, 4 * BRACKETS_PER_LEG),
      batch: "One leg at a time: square, clamp, both brackets, then the next.",
      actions: [
        act(
          "With a helper, lay the frame on its back. Set a base (E) across the foot of each end frame, castors out, flush with the outside of the legs and the long rails.",
          "Frame on its back; E flush with the outside.",
        ),
        act(
          "Check each leg is square to its base with your square, then clamp the base to both legs.",
          "Square, clamp.",
        ),
        act(
          "Fix each leg to its base with two angle brackets in the corner where they meet: one on the leg's face towards the bench's middle, one on its face towards the other leg.",
          `${BRACKETS_PER_LEG} brackets a leg.`,
        ),
        bracketing(pilots.brackets),
      ],
      check: {
        says: "Stood up, all four castors touch the floor and the frame doesn't rock.",
        photo: "The frame on its castors.",
      },
      words: wordsWith(pilots.brackets, "flush", "square"),
    },
  ];
};
