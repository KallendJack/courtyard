import type { CutPlan, Fitted, KeptWay, Part, Step, StepTool } from "../build.ts";
import { bitInSets, TOOL_NAMES, type Tool } from "../tools.ts";
import { castorsDraft } from "./castor-steps.ts";
import {
  braceCloseUp,
  endFrameCloseUp,
  longSideCloseUp,
  PILOT,
  SHEET_SCREWS_PER_BRACE,
  sheetCloseUp,
} from "./close-ups.ts";
import { type Shape, whole } from "./frame.ts";
import type { BenchParameters } from "./parameters.ts";
import { act, CUT_STEP, type Draft, preparingSteps, sawInUse } from "./preparing.ts";
import { type SceneSetting, sectionOf } from "./scene-pieces.ts";
import { stepScene } from "./scenes.ts";
import { pilotWalk } from "./walk-throughs.ts";

// The framed bench's steps, in the order it's built, each said twice: "show me how" for a
// beginner and "just the numbers" for someone who knows how. Both come from here, with the
// Build's own numbers, each size to the whole mm; a model writes neither. The parts and cut plan
// don't depend on the tools; how a step is done does (a hand saw on a folding workbench, or a
// circular saw).

/** An angle bracket's screws: two through each of its arms. */
const SCREWS_PER_BRACKET = 4;
/**
 * The brackets holding each leg to its castor base: one on the face towards the bench's middle and
 * one on the face towards the other leg. A single bracket lets a bench pushed on castors work the
 * joint loose; screws up through the base can't go in, as the castor plates cover the legs' feet.
 */
const BRACKETS_PER_LEG = 2;

/** The bench's steps, numbered, with each tool set against the tools to hand. */
export const benchSteps = (options: {
  parameters: BenchParameters;
  shape: Shape;
  cutPlan: CutPlan;
  /** The castor bolts' length to use: the parameters', or the length to use when theirs are short. */
  boltLength: number;
  /** What each step's picture draws (#754). */
  parts: readonly Part[];
  fitted: readonly Fitted[];
  /** The tools to hand: the owner's, from Your tools, or else the parameters' own (#777). */
  toHand: ReadonlySet<Tool>;
  /** The tools to hand only as something else the owner has, by its name (#763). */
  standIns: ReadonlyMap<Tool, string>;
  /** The sizes the owner's drill bit sets are kept with. */
  bitSets: readonly string[];
  /** The ways the steps already started were done, which they keep. */
  kept: readonly KeptWay[];
}): Step[] => {
  const { parameters: p, shape: s, cutPlan, toHand, kept } = options;
  const castors = p.castors;
  const saw = sawInUse(toHand, kept);
  // The saw the Build's own tools would cut with: a change from it is said, until cutting starts.
  const planned = sawInUse(new Set(p.tools));
  const sawChanged =
    saw === planned || kept.some((way) => way.step === CUT_STEP)
      ? null
      : { was: TOOL_NAMES[planned], now: TOOL_NAMES[saw] };
  const setting: SceneSetting = { ...options, saw };
  const frameScrews = p.fixings.frameScrews.name;
  const sheetScrews = p.fixings.sheetScrews.name;
  const brackets = p.fixings.brackets.name;
  const bracketScrews = (p.fixings.bracketScrews ?? p.fixings.sheetScrews).name;
  const pilot = "Drill a 3 mm pilot hole where each dot is, then drive the screws.";
  const bracketing = act(
    "Hold each bracket tight into its corner and mark through its holes. Drill a 3 mm pilot hole at each mark, then drive a screw into each hole.",
    `3 mm pilots, ${SCREWS_PER_BRACKET} screws a bracket.`,
  );
  const braces = (p.braces.ends ? 2 : 0) + (p.braces.rear ? 1 : 0);
  const shelfCloseUp = sheetCloseUp({
    title: "The shelf, from above",
    label: "H",
    length: s.shelfLength,
    width: s.frameDepth,
    along: [s.thick / 2, s.frameDepth - s.thick / 2],
    across: [s.shelfLength / 2],
    note: `${whole(s.shelfLength)} long: 2 mm to spare at each end frame.`,
  });
  const topCloseUp = sheetCloseUp({
    title: "The top, from above",
    label: "G",
    length: s.length,
    width: s.depth,
    along: [s.front + s.thick / 2, s.back - s.thick / 2],
    across: [s.left + s.wide + s.thick / 2, s.length / 2, s.right - s.wide - s.thick / 2],
    note: `${whole(s.overhang)} over the frame on every side.`,
  });
  const fixing = (name: string, count: number) => ({ name, count });
  /** Angle brackets, each with its screws. */
  const bracketed = (count: number) => [
    fixing(brackets, count),
    fixing(bracketScrews, count * SCREWS_PER_BRACKET),
  ];
  const shelfUp = whole(s.shelfHeight);
  const middle = whole(s.frameLength / 2);
  const rearInset = whole((s.frameLength - s.endRail) / 2);

  const drafts: Draft[] = [
    ...preparingSteps({ cutPlan, toHand, saw, sectionOf: (stock) => sectionOf(setting, stock) }),
    ...(castors ? [castorsDraft({ castors, shape: s, boltLength: options.boltLength })] : []),
    {
      id: "end-frames",
      on: true,
      title: "Make the two end frames",
      minutes: 20,
      parts: ["A", "C"],
      tools: ["tape-measure", "pencil", "square", "clamps", "drill-driver", "drill-bits"],
      safety: ["safety-glasses"],
      fixings: [fixing(frameScrews, 16)],
      actions: [
        act(
          `Lay two legs (A) flat, ${whole(s.endRail)} apart outside to outside.`,
          `A × 2, ${whole(s.endRail)} outside.`,
        ),
        act("Put an end rail (C) across them, flush with the tops.", "C flush with the tops."),
        act("Clamp it, then check the corner with your square.", "Clamp, square."),
        act(pilot, "3 mm pilots, 2 screws a joint."),
        act(
          `Measure ${shelfUp} up from the floor end of each leg and square a pencil line across.`,
          `Lines ${shelfUp} up.`,
        ),
        act(
          "Fit the bottom rail the same way, its underside on the lines.",
          "Bottom C on the lines.",
        ),
      ],
      closeUp: endFrameCloseUp(s),
      // The first step that drills a pilot hole shows how deep it goes.
      walkThrough: pilotWalk(s, frameScrews),
      check: {
        says: "Measure corner to corner both ways. The same within 2 mm means it's square.",
        photo: "Both end frames, flat, from above.",
      },
      words: ["flush", "square", "pilot hole"],
    },
    {
      id: "long-rails",
      on: true,
      title: "Join the end frames with the long rails",
      minutes: 30,
      helper: true,
      parts: ["B"],
      tools: ["tape-measure", "clamps", "square", "drill-driver", "drill-bits"],
      safety: ["safety-glasses"],
      fixings: [fixing(frameScrews, 16)],
      actions: [
        act(
          `With a helper, stand both end frames up, rails facing in, ${whole(s.frameLength)} apart outside to outside.`,
          `Frames ${whole(s.frameLength)} outside, rails in.`,
        ),
        act(
          "Clamp an upper long rail (B) across the front, flush with the frames' ends and the leg tops.",
          "Upper B flush with ends and tops.",
        ),
        act(pilot, "3 mm pilots, 2 screws a joint."),
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
      words: ["flush", "pilot hole"],
    },
    ...(castors
      ? [
          {
            id: "stand-on-bases",
            on: true,
            title: "Stand the frame on its bases",
            minutes: 30,
            helper: true,
            parts: ["E"],
            // The bases went on with their castors; this joins them to the frame.
            adds: [],
            tools: ["square", "clamps", "pencil", "drill-driver", "drill-bits"],
            safety: ["safety-glasses"],
            fixings: bracketed(4 * BRACKETS_PER_LEG),
            actions: [
              act("With a helper, lay the frame on its back.", "Frame on its back."),
              act(
                "Set a base (E) across the foot of each end frame, castors out, flush with the outside of the legs and the long rails.",
                "E flush with the outside.",
              ),
              act(
                "Check each leg is square to its base with your square, then clamp the base to both legs.",
                "Square, clamp.",
              ),
              act(
                "Fix each leg to its base with two angle brackets in the corner where they meet: one on the leg's face towards the bench's middle, one on its face towards the other leg.",
                `${BRACKETS_PER_LEG} brackets a leg.`,
              ),
              bracketing,
            ],
            check: {
              says: "Stood up, all four castors touch the floor and the frame doesn't rock.",
              photo: "The frame on its castors.",
            },
            words: ["flush", "square", "pilot hole"],
          } satisfies Draft,
        ]
      : []),
    {
      id: "fit-supports",
      on: true,
      title: "Fit the supports",
      minutes: 20,
      parts: p.shelf.on ? ["F", "D"] : ["F"],
      tools: ["tape-measure", "pencil", "drill-driver", "drill-bits"],
      safety: ["safety-glasses"],
      fixings: bracketed(p.shelf.on ? 4 : 2),
      actions: [
        act(
          `Mark the middle of each upper long rail, ${middle} from its end.`,
          `Middle: ${middle}.`,
        ),
        act(
          "Fit the top support (F) between them there, its top flush with the rails, with an angle bracket in the corner at each end.",
          "F flush, a bracket each end.",
        ),
        ...(p.shelf.on
          ? [act("Same for the shelf support (D) between the lower rails.", "D the same, below.")]
          : []),
        bracketing,
      ],
      check: {
        says: "Each support's top flush with its rails: run a hand across.",
        photo: "The supports in.",
      },
      words: ["flush", "pilot hole"],
    },
    {
      id: "fit-shelf",
      on: p.shelf.on,
      title: "Fit the shelf",
      minutes: 15,
      parts: ["H"],
      tools: ["drill-driver", "drill-bits"],
      safety: ["safety-glasses"],
      fixings: [fixing(sheetScrews, shelfCloseUp.fixings.length)],
      actions: [
        act(
          "Drop the shelf (H) in between the end frames, onto the lower rails. It has 2 mm to spare at each end.",
          "H onto the lower rails.",
        ),
        act(
          `${pilot} Screw into the rails and the shelf support.`,
          `${shelfCloseUp.fixings.length} screws.`,
        ),
      ],
      closeUp: shelfCloseUp,
      check: { says: "The shelf lies flat and doesn't rock.", photo: "The shelf in." },
      words: ["pilot hole"],
    },
    {
      id: "fit-braces",
      on: braces > 0,
      title: "Fit the braces",
      minutes: 20,
      parts: ["J"],
      tools: p.braces.rear
        ? ["tape-measure", "clamps", "drill-driver", "drill-bits"]
        : ["clamps", "drill-driver", "drill-bits"],
      safety: ["safety-glasses"],
      fixings: [fixing(sheetScrews, braces * SHEET_SCREWS_PER_BRACE)],
      actions: [
        ...(p.braces.ends
          ? [
              act(
                "Clamp an end brace (J) on the outside of each end frame, its top edge flush with the leg tops.",
                "J on each end, flush with the tops.",
              ),
            ]
          : []),
        ...(p.braces.rear
          ? [
              act(
                `Clamp the rear brace (J) on the back rails, ${rearInset} from each end: measure it at both ends.`,
                `Rear J ${rearInset} from each end.`,
              ),
            ]
          : []),
        act(`${pilot} Two into each leg or rail, top and bottom.`, "4 screws a brace."),
      ],
      closeUp: braceCloseUp(s),
      check: {
        says: "Push a top corner sideways: the frame doesn't sway.",
        photo: "The bench from a back corner.",
      },
      words: ["flush", "pilot hole"],
    },
    {
      id: "fit-top",
      on: true,
      title: "Fit the top",
      minutes: 30,
      parts: ["G"],
      tools: ["tape-measure", "clamps", "drill-driver", "drill-bits", "countersink-bit"],
      safety: ["safety-glasses"],
      fixings: [fixing(sheetScrews, topCloseUp.fixings.length)],
      actions: [
        act(
          `Lay the top (G) on with ${whole(s.overhang)} over the frame on every side, and clamp it so it can't move.`,
          `G, ${whole(s.overhang)} over all round.`,
        ),
        act(
          "Drill a 3 mm pilot hole where each dot is, down into the rails and the top support.",
          "3 mm pilots at the dots.",
        ),
        act(
          "Countersink each hole with the countersink bit, a little at a time, until a screw's head sits flush with the top.",
          "Countersink each hole.",
        ),
        act(
          "Drive the screws, each head flush or just below the top, so nothing catches on it.",
          `${topCloseUp.fixings.length} screws, heads flush.`,
        ),
      ],
      closeUp: topCloseUp,
      check: {
        says: "The overhang the same all round, within 2 mm, and every screw head flush.",
        photo: "The top, from above.",
      },
      words: ["pilot hole", "countersink", "flush"],
    },
    {
      id: "check-bench",
      on: true,
      title: "Check the bench",
      minutes: 10,
      parts: [],
      tools: ["spirit-level", "tape-measure"],
      actions: [
        act("Put the level on the top, along it and across it.", "Level both ways."),
        act(
          `Measure the height to the top: it should be ${whole(s.height)}.`,
          `${whole(s.height)} high.`,
        ),
      ],
      check: {
        says: castors
          ? "Level both ways, and it rolls without rocking."
          : "Level both ways, and it doesn't rock.",
        photo: "The finished bench.",
      },
    },
  ];

  const stepTool =
    (draft: Draft) =>
    (tool: Tool): StepTool => {
      const standIn = options.standIns.get(tool);
      const bits =
        tool === "drill-bits"
          ? (draft.bits ?? [{ mm: PILOT, for: "pilot holes" }]).map((bit) => {
              const have = bitInSets(options.bitSets, bit.mm);
              return have === undefined ? bit : { ...bit, have };
            })
          : undefined;
      return {
        tool,
        name: TOOL_NAMES[tool],
        toHand: toHand.has(tool),
        ...(standIn === undefined ? {} : { standIn }),
        ...(bits === undefined ? {} : { bits }),
      };
    };
  const on = drafts.filter((draft) => draft.on);
  return on.map((draft, at) => ({
    id: draft.id,
    number: at + 1,
    title: draft.title,
    minutes: draft.minutes,
    helper: draft.helper ?? false,
    parts: draft.parts,
    adds: draft.adds ?? draft.parts,
    ways: draft.ways ?? [],
    wayChanged: draft.id === CUT_STEP ? sawChanged : null,
    tools: draft.tools.map(stepTool(draft)),
    safety: (draft.safety ?? []).map(stepTool(draft)),
    fixings: draft.fixings ?? [],
    actions: draft.actions,
    closeUp: draft.closeUp ?? null,
    walkThrough: draft.walkThrough ?? [],
    scene: stepScene(setting, {
      id: draft.id,
      shown: on.slice(0, at + 1).flatMap((each) => each.adds ?? each.parts),
      lit: draft.parts,
    }),
    check: draft.check,
    words: draft.words ?? [],
  }));
};
