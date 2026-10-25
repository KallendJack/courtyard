import type { CutPlan, Step } from "../build.ts";
import { TOOL_NAMES, type Tool } from "../tools.ts";
import {
  baseCloseUp,
  braceCloseUp,
  endFrameCloseUp,
  longSideCloseUp,
  SHEET_SCREWS_PER_BRACE,
  sheetCloseUp,
} from "./close-ups.ts";
import type { Shape } from "./frame.ts";
import { type BenchParameters, castorFixingNames } from "./parameters.ts";
import { act, type Draft, preparingSteps } from "./preparing.ts";

// The framed bench's steps, in the order it's built, each said twice: "show me how" for a
// beginner and "just the numbers" for someone who knows how. Both come from here, with the
// Build's own numbers; a model writes neither. The parts and cut plan don't depend on the tools;
// how a step is done does (a hand saw on a folding workbench, or a circular saw).

/** The bench's steps, numbered, with each tool set against the tools to hand. */
export const benchSteps = (options: {
  parameters: BenchParameters;
  shape: Shape;
  cutPlan: CutPlan;
}): Step[] => {
  const { parameters: p, shape: s, cutPlan } = options;
  const castors = p.castors;
  const toHand = new Set(p.tools);
  const frameScrews = p.fixings.frameScrews.name;
  const sheetScrews = p.fixings.sheetScrews.name;
  const brackets = p.fixings.brackets.name;
  const pilot = "Drill a 3 mm pilot hole where each dot is, then drive the screws.";
  const braces = (p.braces.ends ? 2 : 0) + (p.braces.rear ? 1 : 0);
  const shelfCloseUp = sheetCloseUp({
    title: "The shelf, from above",
    label: "H",
    length: s.shelfLength,
    width: s.frameDepth,
    along: [s.thick / 2, s.frameDepth - s.thick / 2],
    across: [s.shelfLength / 2],
    note: `${s.shelfLength} long: 2 mm to spare at each end frame.`,
  });
  const topCloseUp = sheetCloseUp({
    title: "The top, from above",
    label: "G",
    length: s.length,
    width: s.depth,
    along: [s.front + s.thick / 2, s.back - s.thick / 2],
    across: [s.left + s.wide + s.thick / 2, s.length / 2, s.right - s.wide - s.thick / 2],
    note: `${s.overhang} over the frame on every side.`,
  });
  const fixing = (name: string, count: number) => ({ name, count });

  const drafts: Draft[] = [
    ...preparingSteps(cutPlan, toHand),
    ...(castors
      ? [
          {
            on: true,
            title: "Fit the castors to the bases",
            minutes: 30,
            parts: ["E"],
            tools: ["tape-measure", "pencil", "drill-driver", "drill-bits", "spanner"],
            safety: ["safety-glasses"],
            fixings: [
              fixing(castorFixingNames(castors).bolts, 4 * castors.boltsEach),
              fixing(
                castorFixingNames(castors).washers,
                4 * castors.boltsEach * castors.washer.perBolt,
              ),
              fixing(castorFixingNames(castors).nuts, 4 * castors.boltsEach),
            ],
            actions: [
              act(
                "Set a castor on the base 10 mm in from each end, centred across it, and mark its holes.",
                "10 from each end, centred.",
              ),
              act(
                `Drill a ${castors.bolt.diameter.value + 1} mm clearance hole straight through at each mark.`,
                `${castors.bolt.diameter.value + 1} mm through.`,
              ),
              act(
                "Push each bolt up through a washer, the castor plate and the base, then add a washer and a lock nut, and tighten with the spanner.",
                "Washer, plate, base, washer, nut.",
              ),
            ],
            closeUp: baseCloseUp(s, castors),
            check: {
              says: "Each castor turns and swivels freely, and every nut is tight.",
              photo: "Both bases from below, castors on.",
            },
            words: ["clearance hole", "lock nut"],
          } satisfies Draft,
        ]
      : []),
    {
      on: true,
      title: "Make the two end frames",
      minutes: 20,
      parts: ["A", "C"],
      tools: ["square", "clamps", "drill-driver", "drill-bits"],
      safety: ["safety-glasses"],
      fixings: [fixing(frameScrews, 16)],
      actions: [
        act(
          `Lay two legs (A) flat, ${s.endRail} apart outside to outside.`,
          `A × 2, ${s.endRail} outside.`,
        ),
        act("Put an end rail (C) across them, flush with the tops.", "C flush with the tops."),
        act("Clamp it, then check the corner with your square.", "Clamp, square."),
        act(pilot, "3 mm pilots, 2 screws a joint."),
        act(
          `Same again for the bottom rail, its underside ${s.shelfHeight} up from the floor end.`,
          `Bottom C ${s.shelfHeight} up.`,
        ),
      ],
      closeUp: endFrameCloseUp(s),
      check: {
        says: "Measure corner to corner both ways. The same within 2 mm means it's square.",
        photo: "Both end frames, flat, from above.",
      },
      words: ["flush", "square", "pilot hole"],
    },
    {
      on: true,
      title: "Join the end frames with the long rails",
      minutes: 30,
      helper: true,
      parts: ["B"],
      tools: ["clamps", "square", "drill-driver", "drill-bits"],
      safety: ["safety-glasses"],
      fixings: [fixing(frameScrews, 16)],
      actions: [
        act(
          `With a helper, stand both end frames up, rails facing in, ${s.frameLength} apart outside to outside.`,
          `Frames ${s.frameLength} outside, rails in.`,
        ),
        act(
          "Clamp an upper long rail (B) across the front, flush with the frames' ends and the leg tops.",
          "Upper B flush with ends and tops.",
        ),
        act(pilot, "3 mm pilots, 2 screws a joint."),
        act(
          `Then the lower rail, its underside ${s.shelfHeight} up, and the same on the back.`,
          `Lower B ${s.shelfHeight} up; back the same.`,
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
            on: true,
            title: "Stand the frame on its bases",
            minutes: 20,
            helper: true,
            parts: ["E"],
            // The bases went on with their castors; this joins them to the frame.
            adds: [],
            tools: ["drill-driver", "drill-bits", "square"],
            safety: ["safety-glasses"],
            fixings: [fixing(brackets, 4)],
            actions: [
              act("With a helper, lay the frame on its back.", "Frame on its back."),
              act(
                "Set a base (E) across the foot of each end frame, castors out, flush with the outside of the legs and the long rails.",
                "E flush with the outside.",
              ),
              act(
                "Fix each leg to its base with an angle bracket on the inside.",
                "1 bracket a leg.",
              ),
            ],
            check: {
              says: "Stood up, all four castors touch the floor and the frame doesn't rock.",
              photo: "The frame on its castors.",
            },
            words: ["flush"],
          } satisfies Draft,
        ]
      : []),
    {
      on: true,
      title: "Fit the supports",
      minutes: 15,
      parts: p.shelf.on ? ["F", "D"] : ["F"],
      tools: ["tape-measure", "pencil", "drill-driver", "drill-bits"],
      safety: ["safety-glasses"],
      fixings: [fixing(brackets, p.shelf.on ? 4 : 2)],
      actions: [
        act(
          `Mark the middle of each upper long rail, ${s.frameLength / 2} from its end.`,
          `Middle: ${s.frameLength / 2}.`,
        ),
        act(
          "Fit the top support (F) between them there, its top flush with the rails, with an angle bracket at each end.",
          "F flush, a bracket each end.",
        ),
        ...(p.shelf.on
          ? [act("Same for the shelf support (D) between the lower rails.", "D the same, below.")]
          : []),
      ],
      check: {
        says: "Each support's top flush with its rails: run a hand across.",
        photo: "The supports in.",
      },
      words: ["flush"],
    },
    {
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
      on: braces > 0,
      title: "Fit the braces",
      minutes: 20,
      parts: ["J"],
      tools: ["clamps", "drill-driver", "drill-bits"],
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
                `Clamp the rear brace (J) on the back rails, ${(s.frameLength - s.endRail) / 2} from each end.`,
                `Rear J ${(s.frameLength - s.endRail) / 2} from each end.`,
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
      on: true,
      title: "Fit the top",
      minutes: 20,
      parts: ["G"],
      tools: ["tape-measure", "drill-driver", "drill-bits"],
      safety: ["safety-glasses"],
      fixings: [fixing(sheetScrews, topCloseUp.fixings.length)],
      actions: [
        act(
          `Lay the top (G) on with ${s.overhang} over the frame on every side.`,
          `G, ${s.overhang} over all round.`,
        ),
        act(
          `${pilot} Screw into the rails and the top support.`,
          `${topCloseUp.fixings.length} screws.`,
        ),
      ],
      closeUp: topCloseUp,
      check: {
        says: "The overhang the same all round, within 2 mm.",
        photo: "The top, from above.",
      },
      words: ["pilot hole"],
    },
    {
      on: true,
      title: "Check the bench",
      minutes: 10,
      parts: [],
      tools: ["spirit-level", "tape-measure"],
      actions: [
        act("Put the level on the top, along it and across it.", "Level both ways."),
        act(`Measure the height to the top: it should be ${s.height}.`, `${s.height} high.`),
      ],
      check: {
        says: castors
          ? "Level both ways, and it rolls without rocking."
          : "Level both ways, and it doesn't rock.",
        photo: "The finished bench.",
      },
    },
  ];

  const stepTool = (tool: Tool) => ({ tool, name: TOOL_NAMES[tool], toHand: toHand.has(tool) });
  return drafts
    .filter((draft) => draft.on)
    .map((draft, at) => ({
      number: at + 1,
      title: draft.title,
      minutes: draft.minutes,
      helper: draft.helper ?? false,
      parts: draft.parts,
      adds: draft.adds ?? draft.parts,
      ways: draft.ways ?? [],
      tools: draft.tools.map(stepTool),
      safety: (draft.safety ?? []).map(stepTool),
      fixings: draft.fixings ?? [],
      actions: draft.actions,
      closeUp: draft.closeUp ?? null,
      check: draft.check,
      words: draft.words ?? [],
    }));
};
